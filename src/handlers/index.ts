/**
 * Event handlers for BlockhostSubscriptions contract events
 * Calls blockhost-provisioner-proxmox scripts to provision/manage VMs
 */

import { spawn } from "child_process";
import { getCommand } from "../provisioner";
import { eciesDecrypt, symmetricEncrypt, loadServerPrivateKey } from "../crypto";
import { getContract, JSONRpcProvider } from "opnet";
import { loadWeb3Config } from "../fund-manager/web3-config";
import { ACCESS_CREDENTIAL_NFT_ABI, type IAccessCredentialNFT } from "../fund-manager/contract-abis";

// Paths on the server
const WORKING_DIR = "/var/lib/blockhost";

export interface SubscriptionCreatedEvent {
  subscriptionId: bigint;
  planId: bigint;
  subscriber: string;         // 0x + 64 hex (32-byte OPNet address)
  expiresAt: bigint;
  paidAmount: bigint;         // Amount in payment token base units
  userEncrypted: string;      // Hex-encoded ECIES ciphertext
}

export interface SubscriptionExtendedEvent {
  subscriptionId: bigint;
  planId: bigint;
  extendedBy: string;         // 0x + 64 hex (32-byte OPNet address)
  newExpiresAt: bigint;
  paidAmount: bigint;         // Amount in payment token base units
}

export interface SubscriptionCancelledEvent {
  subscriptionId: bigint;
  planId: bigint;
  subscriber: string;
}

export interface PlanCreatedEvent {
  planId: bigint;
  name: string;
  pricePerDayUsdCents: bigint;
}

export interface PlanUpdatedEvent {
  planId: bigint;
  name: string;
  pricePerDayUsdCents: bigint;
  active: boolean;
}

/**
 * Format subscription ID as VM name: blockhost-001, blockhost-042, etc.
 */
function formatVmName(subscriptionId: bigint): string {
  return `blockhost-${subscriptionId.toString().padStart(3, "0")}`;
}

/**
 * Calculate days from expiry block height.
 * expiresAt is a block height (not timestamp). We estimate days
 * from the difference in blocks using BLOCKS_PER_DAY = 144.
 * currentBlock is passed from the monitor; if unavailable, estimate from expiresAt.
 */
const BLOCKS_PER_DAY = 144n;

function calculateExpiryDays(expiresAtBlock: bigint, currentBlock?: bigint): number {
  const now = currentBlock ?? 0n;
  if (expiresAtBlock <= now) return 1; // Already expired, at least 1 day for provisioning
  const blocksRemaining = expiresAtBlock - now;
  const days = Number(blocksRemaining / BLOCKS_PER_DAY);
  return Math.max(1, days);
}

/**
 * Decrypt userEncrypted data using the server's private key (native ECIES).
 * Returns the decrypted user signature, or null if decryption fails.
 *
 * For testing: if the data looks like a raw signature (0x + 130 hex chars), use it directly.
 */
function decryptUserSignature(userEncrypted: string): string | null {
  // Check if it's a raw signature (65 bytes = 130 hex chars + 0x prefix)
  if (userEncrypted.startsWith("0x") && userEncrypted.length === 132) {
    console.log("[INFO] Using raw signature (no decryption needed)");
    return userEncrypted;
  }

  try {
    const privateKey = loadServerPrivateKey();
    return eciesDecrypt(privateKey, userEncrypted);
  } catch (err) {
    console.error(`[ERROR] Failed to decrypt user signature: ${err}`);
    return null;
  }
}

/**
 * Run a command and return a promise
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: WORKING_DIR,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

/** Summary JSON emitted by blockhost-vm-create */
interface VmCreateSummary {
  status: string;
  vm_name: string;
  ip: string;
  ipv6?: string;
  vmid: number;
  nft_token_id: number;
  username: string;
}

/**
 * Parse the JSON summary line from blockhost-vm-create stdout.
 * The summary is the last line starting with '{'.
 */
function parseVmSummary(stdout: string): VmCreateSummary | null {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line) as VmCreateSummary;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Encrypt connection details using the user's signature (native SHAKE256 + AES-GCM).
 * Returns the encrypted hex string, or null on failure.
 */
function encryptConnectionDetails(
  userSignature: string,
  hostname: string,
  username: string
): string | null {
  const connectionDetails = JSON.stringify({
    hostname,
    port: 22,
    username,
  });

  try {
    return symmetricEncrypt(userSignature, connectionDetails);
  } catch (err) {
    console.error(`[ERROR] Failed to encrypt connection details: ${err}`);
    return null;
  }
}

/**
 * Mark an NFT as minted in the VM database (fire-and-forget).
 */
function markNftMinted(nftTokenId: number, ownerWallet: string): void {
  const script = `
import os
from blockhost.vm_db import get_database
db = get_database()
db.mark_nft_minted(int(os.environ['NFT_TOKEN_ID']), os.environ['OWNER_WALLET'])
`;
  const proc = spawn("python3", ["-c", script], {
    cwd: WORKING_DIR,
    env: { ...process.env, NFT_TOKEN_ID: String(nftTokenId), OWNER_WALLET: ownerWallet },
  });
  proc.on("close", (code) => {
    if (code !== 0) {
      console.error(`[WARN] Failed to mark NFT ${nftTokenId} as minted in database`);
    }
  });
}

/**
 * Reserve an NFT token ID in the VM database before provisioning.
 * Returns true on success.
 */
function reserveNftTokenId(vmName: string, tokenId: number): Promise<boolean> {
  return new Promise((resolve) => {
    const script = `
import os
from blockhost.vm_db import get_database
db = get_database()
db.reserve_nft_token_id(os.environ['VM_NAME'], int(os.environ['TOKEN_ID']))
`;
    const proc = spawn("python3", ["-c", script], {
      cwd: WORKING_DIR,
      env: { ...process.env, VM_NAME: vmName, TOKEN_ID: String(tokenId) },
    });
    proc.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Mark an NFT reservation as failed in the VM database (fire-and-forget).
 */
function markNftFailed(tokenId: number): void {
  const script = `
import os
from blockhost.vm_db import get_database
db = get_database()
db.mark_nft_failed(int(os.environ['TOKEN_ID']))
`;
  const proc = spawn("python3", ["-c", script], {
    cwd: WORKING_DIR,
    env: { ...process.env, TOKEN_ID: String(tokenId) },
  });
  proc.on("close", (code) => {
    if (code !== 0) {
      console.error(`[WARN] Failed to mark NFT ${tokenId} as failed in database`);
    }
  });
}

/**
 * Destroy a VM via the provisioner's destroy command.
 */
async function destroyVm(vmName: string): Promise<{ success: boolean; output: string }> {
  const result = await runCommand(getCommand("destroy"), [vmName]);
  return {
    success: result.code === 0,
    output: (result.code === 0 ? result.stdout : result.stderr || result.stdout).trim(),
  };
}

export async function handleSubscriptionCreated(event: SubscriptionCreatedEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);
  const expiryDays = calculateExpiryDays(event.expiresAt);

  console.log("\n========== SUBSCRIPTION CREATED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Subscription ID: ${event.subscriptionId}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Subscriber: ${event.subscriber}`);
  console.log(`Expires At Block: ${event.expiresAt}`);
  console.log(`Paid Amount: ${Number(event.paidAmount)} sats`);
  console.log(`User Encrypted: ${event.userEncrypted.length > 10 ? event.userEncrypted.slice(0, 10) + "..." : event.userEncrypted}`);
  console.log("------------------------------------------");
  console.log(`Provisioning VM: ${vmName}`);
  console.log(`Expiry: ${expiryDays} days`);

  // Decrypt user signature if provided (needed for connection detail encryption)
  let userSignature: string | null = null;
  if (event.userEncrypted && event.userEncrypted !== "0x") {
    console.log("Decrypting user signature...");
    userSignature = decryptUserSignature(event.userEncrypted);
    if (userSignature) {
      console.log("User signature decrypted successfully");
    } else {
      console.warn("[WARN] Could not decrypt user signature, proceeding without encrypted connection details");
    }
  }

  // Step 1: Reserve NFT token ID (query totalSupply from contract)
  const web3Config = loadWeb3Config();
  const provider = new JSONRpcProvider(web3Config.rpcUrl, web3Config.network);
  const nftContract = getContract<IAccessCredentialNFT>(
    web3Config.nftContract,
    ACCESS_CREDENTIAL_NFT_ABI,
    provider,
    web3Config.network,
  );

  let nftTokenId: number;
  try {
    const supplyResult = await nftContract.totalSupply();
    if ('error' in supplyResult) {
      throw new Error(String(supplyResult.error));
    }
    nftTokenId = Number(supplyResult.properties.totalSupply);
    console.log(`[INFO] Reserving NFT token ID: ${nftTokenId}`);
  } catch (err) {
    console.error(`[ERROR] Failed to query NFT totalSupply: ${err}`);
    console.log("==========================================\n");
    return;
  }

  const reserved = await reserveNftTokenId(vmName, nftTokenId);
  if (!reserved) {
    console.error(`[ERROR] Failed to reserve NFT token ID ${nftTokenId} in database`);
    console.log("==========================================\n");
    return;
  }

  // Step 2: Create VM (provisioner receives token ID and wallet for GECOS)
  const createArgs = [
    vmName,
    "--owner-wallet", event.subscriber,
    "--nft-token-id", nftTokenId.toString(),
    "--expiry-days", expiryDays.toString(),
    "--apply",
  ];

  console.log("Creating VM...");
  const result = await runCommand(getCommand("create"), createArgs);

  if (result.code !== 0) {
    console.error(`[ERROR] Failed to provision VM ${vmName}`);
    console.error(result.stderr || result.stdout);
    markNftFailed(nftTokenId);
    console.log("==========================================\n");
    return;
  }

  console.log(`[OK] VM ${vmName} provisioned successfully`);

  // Step 3: Parse JSON summary from provisioner output
  const summary = parseVmSummary(result.stdout);
  if (!summary) {
    console.log("[INFO] No JSON summary from provisioner");
    console.log(result.stdout);
    console.log("==========================================\n");
    return;
  }

  console.log(`[INFO] VM summary: ip=${summary.ip}, vmid=${summary.vmid}, token=${summary.nft_token_id}`);

  // Step 4: Encrypt connection details using user's signature
  let userEncrypted = "0x";

  if (userSignature) {
    const hostname = summary.ipv6 || summary.ip;
    const encrypted = encryptConnectionDetails(userSignature, hostname, summary.username);
    if (encrypted) {
      userEncrypted = encrypted;
      console.log("[OK] Connection details encrypted");
    } else {
      console.warn("[WARN] Failed to encrypt connection details, minting without user data");
    }
  }

  // Step 5: Mint NFT (separate from VM creation)
  const mintArgs = [
    "--owner-wallet", event.subscriber,
  ];
  if (userEncrypted !== "0x") {
    mintArgs.push("--user-encrypted", userEncrypted);
  }

  console.log("Minting NFT...");
  const mintResult = await runCommand("blockhost-mint-nft", mintArgs);

  if (mintResult.code === 0) {
    console.log(`[OK] NFT minted for ${vmName}`);
    markNftMinted(summary.nft_token_id, event.subscriber);
  } else {
    // VM exists and is functional, but NFT minting failed
    console.error(`[WARN] NFT minting failed for ${vmName} (VM is still operational)`);
    console.error(mintResult.stderr || mintResult.stdout);
    console.error(`[WARN] Retry manually: blockhost-mint-nft --owner-wallet ${event.subscriber} --user-encrypted <hex>`);
  }

  console.log("==========================================\n");
}

export async function handleSubscriptionExtended(event: SubscriptionExtendedEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);
  console.log("\n========== SUBSCRIPTION EXTENDED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Subscription ID: ${event.subscriptionId}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Extended By: ${event.extendedBy}`);
  console.log(`New Expires At Block: ${event.newExpiresAt}`);
  console.log(`Paid Amount: ${Number(event.paidAmount)} sats`);
  console.log("-------------------------------------------");
  console.log(`Updating expiry for VM: ${vmName}`);

  // Calculate additional days from current time to new expiry
  const additionalDays = calculateExpiryDays(event.newExpiresAt);

  // Use Python to update the database and check if VM needs to be resumed
  // Returns "NEEDS_RESUME" if the VM was suspended and should be started
  const script = `
import os
from blockhost.vm_db import get_database

vm_name = os.environ['VM_NAME']
additional_days = int(os.environ['ADDITIONAL_DAYS'])
db = get_database()
vm = db.get_vm(vm_name)
if vm:
    old_status = vm.get('status', 'unknown')
    db.extend_expiry(vm_name, additional_days)
    print(f"Extended {vm['vm_name']} expiry by {additional_days} days")
    if old_status == 'suspended':
        print("NEEDS_RESUME")
else:
    print(f"VM {vm_name} not found in database")
`;

  const proc = spawn("python3", ["-c", script], {
    cwd: WORKING_DIR,
    env: { ...process.env, VM_NAME: vmName, ADDITIONAL_DAYS: String(additionalDays) },
  });

  let output = "";
  proc.stdout.on("data", (data) => { output += data.toString(); });
  proc.stderr.on("data", (data) => { output += data.toString(); });

  const needsResume = await new Promise<boolean>((resolve) => {
    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[OK] ${output.trim().split('\n')[0]}`);
        resolve(output.includes("NEEDS_RESUME"));
      } else {
        console.error(`[ERROR] Failed to extend expiry: ${output}`);
        resolve(false);
      }
    });
  });

  // If VM was suspended, resume it
  if (needsResume) {
    console.log(`Resuming suspended VM: ${vmName}`);

    const resumeProc = spawn(getCommand("resume"), [vmName], { cwd: WORKING_DIR });

    let resumeOutput = "";
    resumeProc.stdout.on("data", (data) => { resumeOutput += data.toString(); });
    resumeProc.stderr.on("data", (data) => { resumeOutput += data.toString(); });

    await new Promise<void>((resolve) => {
      resumeProc.on("close", (code) => {
        if (code === 0) {
          console.log(`[OK] Successfully resumed VM: ${vmName}`);
          if (resumeOutput.trim()) {
            console.log(resumeOutput.trim());
          }
        } else {
          // Don't fail the handler - subscription extension succeeded on-chain
          // Operator can manually resume if needed
          console.error(`[WARN] Failed to resume VM ${vmName} (exit code ${code})`);
          console.error(`[WARN] ${resumeOutput.trim()}`);
          console.error(`[WARN] Operator may need to manually resume the VM`);
        }
        resolve();
      });
    });
  }

  console.log("===========================================\n");
}

export async function handleSubscriptionCancelled(event: SubscriptionCancelledEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);

  console.log("\n========== SUBSCRIPTION CANCELLED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Subscription ID: ${event.subscriptionId}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Subscriber: ${event.subscriber}`);
  console.log("--------------------------------------------");
  console.log(`Destroying VM: ${vmName}`);

  const { success, output } = await destroyVm(vmName);

  if (success) {
    console.log(`[OK] ${output}`);
  } else {
    console.error(`[ERROR] Failed to destroy VM: ${output}`);
  }

  console.log("============================================\n");
}

export async function handlePlanCreated(event: PlanCreatedEvent, txHash: string): Promise<void> {
  console.log("\n========== PLAN CREATED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Name: ${event.name}`);
  console.log(`Price: $${Number(event.pricePerDayUsdCents) / 100}/day`);
  console.log("----------------------------------");
  console.log("[INFO] Plan registered on-chain");
  console.log("==================================\n");
}

export async function handlePlanUpdated(event: PlanUpdatedEvent, txHash: string): Promise<void> {
  console.log("\n========== PLAN UPDATED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Name: ${event.name}`);
  console.log(`Price: $${Number(event.pricePerDayUsdCents) / 100}/day`);
  console.log(`Active: ${event.active}`);
  console.log("----------------------------------");
  console.log("[INFO] Plan updated on-chain");
  console.log("==================================\n");
}
