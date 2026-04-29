/**
 * Event handlers for BlockhostSubscriptions contract events
 * Calls blockhost-provisioner-proxmox scripts to provision/manage VMs
 */

import { spawn, spawnSync } from "child_process";
import { getCommand } from "../provisioner";
import { eciesDecrypt, symmetricEncrypt, loadServerPrivateKey } from "../crypto";
import { isValidInternalAddress } from "../fund-manager/addressbook.js";

// Paths on the server
const WORKING_DIR = "/var/lib/blockhost";
const SSH_PORT = 22;

/**
 * Resolve the subscriber-facing host via the network-hook dispatcher.
 * The dispatcher reads vm-db.network_mode for the VM and forwards to the
 * matching plugin's `public-address` command. No fallback: a missing or
 * empty result aborts the caller (no NFT mint with garbage data).
 */
function getPublicAddress(vmName: string): string | null {
  const result = spawnSync("blockhost-network-hook", ["public-address", vmName], {
    cwd: WORKING_DIR,
    timeout: 60_000,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    console.error(`[ERROR] network-hook public-address failed for ${vmName}: ${err || `exit ${result.status}`}`);
    return null;
  }
  const host = result.stdout.trim();
  return host || null;
}

/**
 * Push mode-specific in-VM config via the network-hook dispatcher.
 * Idempotent. Returns true on success, false on retryable failure.
 */
function pushVmConfig(vmName: string): boolean {
  const result = spawnSync("blockhost-network-hook", ["push-vm-config", vmName], {
    cwd: WORKING_DIR,
    timeout: 60_000,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    console.warn(`[WARN] network-hook push-vm-config failed for ${vmName}: ${err || `exit ${result.status}`}`);
    return false;
  }
  return true;
}

/**
 * Persist `network_config_synced` on the VM record via common's vmdb CLI.
 * The CLI routes through the lockfile; direct writes to vms.json would race
 * with concurrent mutators.
 */
export function setNetworkConfigSynced(vmName: string, synced: boolean): void {
  const fields = JSON.stringify({ network_config_synced: synced });
  const result = spawnSync("blockhost-vmdb", ["update-fields", vmName, "--fields", fields], {
    cwd: WORKING_DIR,
    timeout: 10_000,
  });
  if (result.status !== 0) {
    const errMsg = result.stderr ? result.stderr.toString().trim() : "";
    console.warn(`[WARN] Failed to set network_config_synced=${synced} for ${vmName}${errMsg ? ": " + errMsg : ""}`);
  }
}

/**
 * Release per-VM network resources via the network-hook dispatcher.
 * Called BEFORE vm-destroy so plugins can do guest-side reversal while the
 * VM is still running.
 */
function cleanupNetworkResources(vmName: string): void {
  const result = spawnSync("blockhost-network-hook", ["cleanup", vmName], {
    cwd: WORKING_DIR,
    timeout: 30_000,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    console.warn(`[WARN] network-hook cleanup failed for ${vmName}: ${err || `exit ${result.status}`}`);
  }
}

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
 * Calculate days from expiry block height relative to a reference block.
 * expiresAt is a block height (not timestamp). Days = (expiresAt - currentBlock) / BLOCKS_PER_DAY.
 * Caller MUST pass the block height where the originating event was emitted —
 * that anchors the calculation to "days remaining at the time the user paid."
 */
const BLOCKS_PER_DAY = 144n;

function calculateExpiryDays(expiresAtBlock: bigint, currentBlock: bigint): number {
  if (expiresAtBlock <= currentBlock) return 1; // Already expired, at least 1 day for provisioning
  const blocksRemaining = expiresAtBlock - currentBlock;
  const days = Number(blocksRemaining / BLOCKS_PER_DAY);
  return Math.max(1, days);
}

/**
 * Decrypt userEncrypted data using the server's private key (native ECIES).
 * Returns the decrypted user signature, or null if decryption fails.
 */
function decryptUserSignature(userEncrypted: string): string | null {
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
    port: SSH_PORT,
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
 * Mark an NFT as minted in the VM database (synchronous, checked).
 *
 * Common's CLI takes (vm_name, token_id) — the underlying API is
 * `set_nft_minted(vm_name, token_id)`. The previous inline-script call passed
 * (token_id, owner_wallet), which was wrong both in argument order and types.
 */
function markNftMinted(vmName: string, nftTokenId: number): void {
  const result = spawnSync("blockhost-vmdb", ["mark-nft-minted", vmName, String(nftTokenId)], {
    cwd: WORKING_DIR,
    timeout: 10_000,
  });
  if (result.status !== 0) {
    const errMsg = result.stderr ? result.stderr.toString().trim() : "";
    console.error(`[WARN] Failed to mark NFT ${nftTokenId} for ${vmName} as minted${errMsg ? ": " + errMsg : ""}`);
  }
}

/**
 * Parse the minted token ID from blockhost-mint-nft stdout.
 * The script outputs the integer token ID on stdout.
 */
function parseMintOutput(stdout: string): number | null {
  const trimmed = stdout.trim();
  const id = parseInt(trimmed, 10);
  return isNaN(id) ? null : id;
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

export async function handleSubscriptionCreated(event: SubscriptionCreatedEvent, txHash: string, currentBlock: bigint): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);
  const expiryDays = calculateExpiryDays(event.expiresAt, currentBlock);

  // Validate subscriber address format before using in spawn args
  if (!isValidInternalAddress(event.subscriber)) {
    console.error(`[ERROR] Invalid subscriber address format: ${event.subscriber}`);
    return;
  }

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

  // Step 1: Decrypt user signature (before VM creation — fail fast)
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

  // Step 2: Create VM (no token ID — assigned after mint)
  const createArgs = [
    vmName,
    "--owner-wallet", event.subscriber,
    "--expiry-days", expiryDays.toString(),
    "--apply",
  ];

  console.log("Creating VM...");
  const result = await runCommand(getCommand("create"), createArgs);

  if (result.code !== 0) {
    console.error(`[ERROR] Failed to provision VM ${vmName}`);
    console.error(result.stderr || result.stdout);
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

  console.log(`[INFO] VM summary: ip=${summary.ip}, vmid=${summary.vmid}`);

  // Step 4: Resolve subscriber-facing host via the network-hook dispatcher.
  // The dispatcher reads vm-db.network_mode itself; engine is mode-agnostic.
  const host = getPublicAddress(vmName);
  if (!host) {
    console.error(`[ERROR] Failed to resolve public address for ${vmName} — aborting handler`);
    console.log("==========================================\n");
    return;
  }
  console.log(`[INFO] Connection host: ${host}`);

  // Step 5: Encrypt connection details using user's signature
  let userEncrypted = "0x";

  if (userSignature) {
    const encrypted = encryptConnectionDetails(userSignature, host, summary.username);
    if (encrypted) {
      userEncrypted = encrypted;
      console.log("[OK] Connection details encrypted");
    } else {
      console.warn("[WARN] Failed to encrypt connection details, minting without user data");
    }
  }

  // Step 6: Mint NFT
  const mintArgs = [
    "--owner-wallet", event.subscriber,
  ];
  if (userEncrypted !== "0x") {
    mintArgs.push("--user-encrypted", userEncrypted);
  }

  console.log("Minting NFT...");
  const mintResult = await runCommand("blockhost-mint-nft", mintArgs);

  if (mintResult.code !== 0) {
    // VM exists and is functional, but NFT minting failed
    console.error(`[WARN] NFT minting failed for ${vmName} (VM is still operational)`);
    console.error(mintResult.stderr || mintResult.stdout);
    console.error(`[WARN] Retry manually: blockhost-mint-nft --owner-wallet ${event.subscriber} --user-encrypted <hex>`);
    console.log("==========================================\n");
    return;
  }

  // Step 7: Capture actual token ID from mint stdout
  const actualTokenId = parseMintOutput(mintResult.stdout);
  if (actualTokenId === null) {
    console.error(`[WARN] Could not parse token ID from mint output: ${mintResult.stdout.trim()}`);
    console.log("==========================================\n");
    return;
  }

  console.log(`[OK] NFT minted for ${vmName} (token #${actualTokenId})`);

  // Step 8a: Push mode-specific in-VM config via the dispatcher.
  // Best-effort here — the reconciler retries until network_config_synced=true.
  const pushed = pushVmConfig(vmName);
  setNetworkConfigSynced(vmName, pushed);
  if (pushed) {
    console.log(`[OK] network-hook push-vm-config succeeded for ${vmName}`);
  } else {
    console.warn(`[WARN] network-hook push-vm-config deferred for ${vmName} — reconciler will retry`);
  }

  // Step 8b: Update GECOS with actual token ID
  const updateGecosCmd = getCommand("update-gecos");
  const gecosArgs = [vmName, event.subscriber, "--nft-id", String(actualTokenId)];
  const gecosResult = spawnSync(updateGecosCmd, gecosArgs, { timeout: 30_000, cwd: WORKING_DIR });
  if (gecosResult.status !== 0) {
    const errMsg = gecosResult.stderr ? gecosResult.stderr.toString().trim() : "";
    console.error(`[WARN] update-gecos failed for ${vmName}${errMsg ? ": " + errMsg : ""}`);
    // Not fatal — reconciler will retry
  } else {
    console.log(`[OK] GECOS updated for ${vmName}`);
  }

  // Step 9: Mark NFT minted in database (synchronous)
  markNftMinted(vmName, actualTokenId);

  console.log("==========================================\n");
}

export async function handleSubscriptionExtended(event: SubscriptionExtendedEvent, txHash: string, currentBlock: bigint): Promise<void> {
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

  // Days remaining anchored to the block where the extend event was emitted
  const additionalDays = calculateExpiryDays(event.newExpiresAt, currentBlock);

  // Common's vmdb extend-expiry CLI: stdout line 1 = confirmation, stdout line
  // 2 = "NEEDS_RESUME" if the VM was suspended at extend time.
  const proc = spawn("blockhost-vmdb", ["extend-expiry", vmName, String(additionalDays)], {
    cwd: WORKING_DIR,
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

  // Release per-VM network resources BEFORE destroy so plugins can do
  // guest-side reversal while the VM is still running.
  cleanupNetworkResources(vmName);

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
