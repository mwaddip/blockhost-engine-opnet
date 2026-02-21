/**
 * Event handlers for BlockhostSubscriptions contract events.
 *
 * SubscriptionCreated: thin dispatch to pipeline (runner handles all stages).
 * SubscriptionExtended/Cancelled: inline operations (DB update + provisioner call).
 */

import { spawn } from "child_process";
import { getCommand } from "../provisioner";
import { pipeline } from "../monitor";

const WORKING_DIR = "/var/lib/blockhost";

export interface SubscriptionCreatedEvent {
  subscriptionId: bigint;
  planId: bigint;
  subscriber: string;         // 0x + 64 hex (32-byte OPNet address)
  expiresAt: bigint;
  paidAmount: bigint;
  userEncrypted: string;      // Hex-encoded ECIES ciphertext
}

export interface SubscriptionExtendedEvent {
  subscriptionId: bigint;
  planId: bigint;
  extendedBy: string;
  newExpiresAt: bigint;
  paidAmount: bigint;
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
 */
const BLOCKS_PER_DAY = 144n;

function calculateExpiryDays(expiresAtBlock: bigint, currentBlock?: bigint): number {
  const now = currentBlock ?? 0n;
  if (expiresAtBlock <= now) return 1;
  const blocksRemaining = expiresAtBlock - now;
  const days = Number(blocksRemaining / BLOCKS_PER_DAY);
  return Math.max(1, days);
}

/**
 * Run a command and return a promise.
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd: WORKING_DIR });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function handleSubscriptionCreated(event: SubscriptionCreatedEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);
  const expiryDays = calculateExpiryDays(event.expiresAt);

  // Validate subscriber address format before enqueuing
  if (!/^0x[0-9a-fA-F]{64}$/.test(event.subscriber)) {
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
  console.log(`Enqueuing to pipeline: ${vmName} (${expiryDays} days)`);

  pipeline.enqueue({
    subscriptionId: Number(event.subscriptionId),
    vmName,
    ownerWallet: event.subscriber,
    expiryDays,
    userEncrypted: event.userEncrypted,
  });

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

  const additionalDays = calculateExpiryDays(event.newExpiresAt);

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

  const result = await runCommand(getCommand("destroy"), [vmName]);

  if (result.code === 0) {
    console.log(`[OK] ${(result.stdout || result.stderr).trim()}`);
  } else {
    console.error(`[ERROR] Failed to destroy VM: ${(result.stderr || result.stdout).trim()}`);
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
