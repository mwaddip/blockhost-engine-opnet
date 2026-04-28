/**
 * NFT Ownership Reconciliation Module
 *
 * Periodically checks that local NFT ownership (vms.json) matches on-chain state.
 * Detects NFT transfers and updates VM GECOS fields accordingly.
 */

import { getContract, type JSONRpcProvider } from "opnet";
import type { Network } from "@btc-vision/bitcoin";
import { spawnSync } from "child_process";
import * as fs from "fs";
import { getCommand } from "../provisioner";
import { loadWeb3Config } from "../fund-manager/web3-config";
import {
  ACCESS_CREDENTIAL_NFT_ABI,
  type IAccessCredentialNFT,
} from "../fund-manager/contract-abis";

const VMS_JSON_PATH = "/var/lib/blockhost/vms.json";
const STATE_DIR = "/var/lib/blockhost";
const STATE_FILE = `${STATE_DIR}/reconcile-state.json`;
const PROVISIONING_LOCK = "/run/blockhost/provisioning.lock";
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — engine-defined per facts §3
const RPC_THROTTLE_MS = 15_000; // 15s between ownerOf queries

interface VmEntry {
  vm_name: string;
  owner_wallet: string;
  nft_token_id?: number;
  nft_minted?: boolean;
  status: string;
  gecos_synced?: boolean;
}

interface VmsDatabase {
  vms: Record<string, VmEntry>;
  allocated_ips: string[];
}

interface ReconcileState {
  last_reconcile: number; // Unix ms of last completed (non-deferred) cycle
}

function loadReconcileState(): ReconcileState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Record<string, unknown>;
      const last = typeof raw.last_reconcile === "number" ? raw.last_reconcile : 0;
      return { last_reconcile: last };
    }
  } catch (err) {
    console.error(`[RECONCILE] Error loading state: ${err}`);
  }
  return { last_reconcile: 0 };
}

function saveReconcileState(state: ReconcileState): void {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error(`[RECONCILE] Error saving state: ${err}`);
  }
}

let lastReconcileTime = loadReconcileState().last_reconcile;
let reconcileInProgress = false;

/**
 * Whether a VM-provisioning operation is currently in flight.
 *
 * The provisioner (proxmox/libvirt) writes /run/blockhost/provisioning.lock at
 * the start of its `create` flow and removes it on exit (success or failure).
 * Presence of the file is the sole signal — pgrep was removed because matching
 * the create-command name in argv produced false positives (log tails, etc.)
 * that delayed reconciliation for spurious reasons.
 */
export function isProvisioningInProgress(): boolean {
  return fs.existsSync(PROVISIONING_LOCK);
}

/**
 * Load NFT contract address from web3-defaults.yaml
 */
function loadNftContractAddress(): string | null {
  try {
    const config = loadWeb3Config();
    return config.nftContract;
  } catch (err) {
    console.error(`[RECONCILE] Error loading NFT contract address: ${err}`);
    return null;
  }
}

/**
 * Load the local VMs database
 */
function loadVmsDatabase(): VmsDatabase | null {
  try {
    if (!fs.existsSync(VMS_JSON_PATH)) {
      return null;
    }
    const data = fs.readFileSync(VMS_JSON_PATH, "utf8");
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed !== "object" || parsed === null ||
      !("vms" in parsed) || typeof (parsed as Record<string, unknown>).vms !== "object"
    ) {
      console.error(`[RECONCILE] Invalid vms.json: missing or malformed 'vms' key`);
      return null;
    }
    return parsed as VmsDatabase;
  } catch (err) {
    console.error(`[RECONCILE] Error loading vms.json: ${err}`);
    return null;
  }
}

/**
 * Save the VMs database
 */
function saveVmsDatabase(db: VmsDatabase): boolean {
  try {
    fs.writeFileSync(VMS_JSON_PATH, JSON.stringify(db, null, 2));
    return true;
  } catch (err) {
    console.error(`[RECONCILE] Error saving vms.json: ${err}`);
    return false;
  }
}

/**
 * Call the provisioner's update-gecos command to update a VM's GECOS field.
 * Returns true if the command succeeded (exit 0), false otherwise.
 */
function updateGecos(vmName: string, walletAddress: string, nftTokenId: number): boolean {
  try {
    const cmd = getCommand("update-gecos");
    const result = spawnSync(cmd, [vmName, walletAddress, "--nft-id", nftTokenId.toString()], {
      encoding: "utf8",
      timeout: 30000,
      cwd: "/var/lib/blockhost",
    });
    if (result.status === 0) {
      return true;
    }
    const errMsg = (result.stderr || result.stdout || "").trim();
    console.warn(`[RECONCILE] update-gecos failed for ${vmName}: ${errMsg || `exit ${result.status}`}`);
    return false;
  } catch (err) {
    console.warn(`[RECONCILE] update-gecos error for ${vmName}: ${err}`);
    return false;
  }
}

/**
 * Reconcile NFT ownership: detect transfers and update VM GECOS fields.
 */
async function reconcileOwnership(
  nftContract: IAccessCredentialNFT,
  localDb: VmsDatabase,
): Promise<void> {
  let first = true;
  for (const [vmName, vm] of Object.entries(localDb.vms)) {
    // Only check active/suspended VMs with minted NFTs
    if (vm.status === "destroyed") continue;
    if (vm.nft_minted !== true) continue;
    if (vm.nft_token_id === undefined) continue;

    // Throttle RPC calls to avoid rate limiting
    if (!first) {
      await new Promise<void>((r) => setTimeout(r, RPC_THROTTLE_MS));
    }
    first = false;

    let onChainOwner: string;
    try {
      const result = await nftContract.ownerOf(BigInt(vm.nft_token_id));
      if ('error' in result) continue;
      // Address → hex string for comparison
      onChainOwner = result.properties.owner.toString().toLowerCase();
    } catch {
      // Token may have been burned or contract call failed — skip
      continue;
    }

    const localOwner = (vm.owner_wallet || "").toLowerCase();
    if (onChainOwner !== localOwner) {
      // Ownership transfer detected
      console.log(`[RECONCILE] NFT #${vm.nft_token_id} transferred: ${localOwner} → ${onChainOwner}`);

      vm.owner_wallet = onChainOwner;
      vm.gecos_synced = false;
      saveVmsDatabase(localDb);

      if (updateGecos(vm.vm_name, onChainOwner, vm.nft_token_id)) {
        vm.gecos_synced = true;
        saveVmsDatabase(localDb);
        console.log(`[RECONCILE] GECOS updated for ${vmName}`);
      } else {
        console.warn(`[RECONCILE] GECOS update failed for ${vmName}, will retry next cycle`);
      }
    } else if (vm.gecos_synced === false) {
      // Previous GECOS update failed — retry
      console.log(`[RECONCILE] Retrying GECOS update for ${vmName}`);
      if (updateGecos(vm.vm_name, vm.owner_wallet, vm.nft_token_id)) {
        vm.gecos_synced = true;
        saveVmsDatabase(localDb);
        console.log(`[RECONCILE] GECOS retry succeeded for ${vmName}`);
      } else {
        console.warn(`[RECONCILE] GECOS retry failed for ${vmName}, will try again next cycle`);
      }
    }
  }
}

/**
 * Run the ownership reconciliation check.
 *
 * Two early-return paths are *deferrals* (concurrency guard, provisioning in
 * flight) — they leave `lastReconcileTime` untouched so the next polling tick
 * retries promptly. Any other outcome (success, missing config, exception)
 * bumps the timestamp and persists it, so the cycle isn't burned by a missed
 * deferral and the interval survives a monitor restart.
 */
export async function runReconciliation(provider: JSONRpcProvider, network: Network): Promise<void> {
  if (reconcileInProgress) {
    return;
  }

  if (isProvisioningInProgress()) {
    console.log(`[RECONCILE] Skipping - provisioning in progress`);
    return;
  }

  reconcileInProgress = true;

  try {
    const nftAddress = loadNftContractAddress();
    if (!nftAddress) {
      // NFT contract not configured yet, skip silently
      return;
    }

    const localDb = loadVmsDatabase();
    if (!localDb) {
      return;
    }

    const nftContract = getContract<IAccessCredentialNFT>(
      nftAddress,
      ACCESS_CREDENTIAL_NFT_ABI,
      provider,
      network,
    );

    await reconcileOwnership(nftContract, localDb);
  } catch (err) {
    console.error(`[RECONCILE] Error during reconciliation: ${err}`);
  } finally {
    lastReconcileTime = Date.now();
    saveReconcileState({ last_reconcile: lastReconcileTime });
    reconcileInProgress = false;
  }
}

/**
 * Pure check — does NOT mutate state. The mutation lives in runReconciliation's
 * finally so deferred paths (concurrency, provisioning) don't burn a cycle.
 */
export function shouldRunReconciliation(): boolean {
  return Date.now() - lastReconcileTime >= RECONCILE_INTERVAL_MS;
}

/**
 * Get reconciliation interval in milliseconds
 */
export function getReconcileInterval(): number {
  return RECONCILE_INTERVAL_MS;
}
