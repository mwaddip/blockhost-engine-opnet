/**
 * Admin command dispatcher — HMAC-authenticated OP_RETURN protocol.
 *
 * Protocol:
 *   OP_RETURN payload = message_bytes + hmac_suffix(16 bytes)
 *   message = "{nonce} {command text}" (UTF-8)
 *   hmac_suffix = HMAC-SHA256(shared_key, message_bytes)[:16]
 *
 * Shared key: shake256(adminSchnorrSignature, {dkLen: 32}) — stored during
 * initial admin setup in blockhost.yaml under admin.shared_key.
 *
 * NOTE: This relies on the OPNet provider returning raw Bitcoin transaction
 * data (including non-OPNet OP_RETURN transactions). If the provider only
 * indexes Interaction transactions, a Bitcoin JSON-RPC fallback will be needed.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { JSONRpcProvider } from 'opnet';
import type { AdminCommand, AdminConfig, CommandResult, CommandDatabase } from "./types";
import { loadCommandDatabase } from "./config";
import { isNonceUsed, markNonceUsed, pruneOldNonces, loadNonces } from "./nonces";
import { executeKnock, closeAllKnocks } from "./handlers/knock";

// ── Helpers ──────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time comparison of two Uint8Arrays.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// ── Action Handlers ──────────────────────────────────────────────────

const ACTION_HANDLERS: Record<string, (params: Record<string, unknown>, config: Record<string, unknown>, txHash: string) => Promise<CommandResult>> = {
  knock: async (params, config, txHash) => executeKnock(params as any, config as any, txHash),
};

// ── OP_RETURN Parsing ────────────────────────────────────────────────

/**
 * Extract data bytes from an OP_RETURN scriptPubKey hex string.
 *
 * Script format: 6a <push_opcode> <data>
 *   - 0x01-0x4b: direct push (1-75 bytes)
 *   - 0x4c: OP_PUSHDATA1 (next byte is length)
 *   - 0x4d: OP_PUSHDATA2 (next 2 bytes LE are length)
 */
function extractOpReturnData(scriptHex: string): Uint8Array | null {
  const hex = scriptHex.startsWith('0x') ? scriptHex.slice(2) : scriptHex;

  // Must start with 6a (OP_RETURN)
  if (!hex.startsWith('6a') || hex.length < 4) return null;

  let offset = 2; // past OP_RETURN
  const pushByte = parseInt(hex.substring(offset, offset + 2), 16);
  offset += 2;

  let dataLen: number;
  if (pushByte <= 0x4b) {
    dataLen = pushByte;
  } else if (pushByte === 0x4c) {
    if (offset + 2 > hex.length) return null;
    dataLen = parseInt(hex.substring(offset, offset + 2), 16);
    offset += 2;
  } else if (pushByte === 0x4d) {
    if (offset + 4 > hex.length) return null;
    const lo = parseInt(hex.substring(offset, offset + 2), 16);
    const hi = parseInt(hex.substring(offset + 2, offset + 4), 16);
    dataLen = (hi << 8) | lo;
    offset += 4;
  } else {
    return null;
  }

  const dataHex = hex.substring(offset, offset + dataLen * 2);
  if (dataHex.length !== dataLen * 2) return null;

  return hexToBytes('0x' + dataHex);
}

/**
 * Parse and verify an OP_RETURN payload as an HMAC-authenticated admin command.
 *
 * @param payload  - Raw OP_RETURN data bytes (after opcode + push)
 * @param sharedKey - 32-byte shared key (hex, no prefix)
 * @returns Parsed command or null if HMAC verification fails
 */
export function parseOpReturnCommand(payload: Uint8Array, sharedKey: string): AdminCommand | null {
  // Minimum: 1 (nonce) + 1 (space) + 1 (command) + 16 (hmac) = 19 bytes
  if (payload.length < 19) return null;

  const message = payload.slice(0, payload.length - 16);
  const hmacSuffix = payload.slice(payload.length - 16);

  // Verify HMAC-SHA256 truncated to 16 bytes (128-bit)
  const keyBytes = hexToBytes(sharedKey);
  const expectedHmac = hmac(sha256, keyBytes, message).slice(0, 16);

  if (!timingSafeEqual(hmacSuffix, expectedHmac)) {
    return null; // HMAC mismatch — not an admin command
  }

  // Parse message: "{nonce} {command}"
  const messageStr = new TextDecoder().decode(message);
  const spaceIdx = messageStr.indexOf(' ');
  if (spaceIdx < 1) return null;

  const nonce = messageStr.slice(0, spaceIdx);
  const command = messageStr.slice(spaceIdx + 1).trim();

  if (!nonce || !command) return null;

  return { command, nonce };
}

// ── Validation & Dispatch ────────────────────────────────────────────

/**
 * Validate command nonce (anti-replay)
 */
export function validateCommand(cmd: AdminCommand): { valid: boolean; reason?: string } {
  if (isNonceUsed(cmd.nonce)) {
    return { valid: false, reason: `Nonce already used (replay attack prevented)` };
  }
  return { valid: true };
}

/**
 * Dispatch a validated command to its handler
 */
export async function dispatchCommand(
  cmd: AdminCommand,
  txHash: string,
  commandDb: CommandDatabase
): Promise<CommandResult> {
  const cmdDef = commandDb.commands[cmd.command];
  if (!cmdDef) {
    return { success: false, message: `Unknown command: ${cmd.command}` };
  }

  const handler = ACTION_HANDLERS[cmdDef.action];
  if (!handler) {
    return { success: false, message: `Unknown action type: ${cmdDef.action}` };
  }

  console.log(`[ADMIN] Dispatching action '${cmdDef.action}' for command '${cmd.command}'`);
  return handler(cmdDef.params, cmdDef.params, txHash);
}

// ── Block Processing ─────────────────────────────────────────────────

/**
 * Process admin commands from OP_RETURN outputs in a block range.
 */
export async function processAdminCommands(
  provider: JSONRpcProvider,
  adminConfig: AdminConfig,
  fromBlock: bigint,
  toBlock: bigint
): Promise<void> {
  const commandDb = loadCommandDatabase();
  if (!commandDb) return;

  pruneOldNonces(adminConfig.max_command_age || 300);

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
    try {
      const block = await provider.getBlock(blockNum, true);
      if (!block) continue;

      // Scan transactions for OP_RETURN outputs
      const txs = (block as any).transactions ?? [];
      for (const tx of txs) {
        await processTransaction(tx, adminConfig, commandDb);
      }
    } catch (err) {
      console.error(`[ADMIN] Error processing block ${blockNum}: ${err}`);
    }
  }
}

/**
 * Process a single transaction for potential admin OP_RETURN commands.
 *
 * OPNet transaction fields:
 *   tx.from — Address object (use .toHex() for string)
 *   tx.outputs — TransactionOutput[]
 *   tx.outputs[].scriptPubKey.hex — raw script hex (string)
 *   tx.hash — transaction hash (string)
 */
async function processTransaction(
  tx: any,
  adminConfig: AdminConfig,
  commandDb: CommandDatabase
): Promise<void> {
  // Check sender matches admin wallet (tx.from is an Address object)
  const sender = (tx.from?.toHex?.() ?? tx.from?.toString() ?? '').toLowerCase();
  if (sender !== adminConfig.wallet_address) return;

  // Scan outputs for OP_RETURN
  const outputs = tx.outputs ?? [];
  for (const output of outputs) {
    const scriptHex: string = output.scriptPubKey?.hex ?? '';

    // OP_RETURN starts with 6a
    const cleanHex = scriptHex.startsWith('0x') ? scriptHex.slice(2) : scriptHex;
    if (!cleanHex.startsWith('6a')) continue;

    const payload = extractOpReturnData(cleanHex);
    if (!payload || payload.length === 0) continue;

    const cmd = parseOpReturnCommand(payload, adminConfig.shared_key);
    if (!cmd) continue; // HMAC failed — not an admin command

    const txHash: string = tx.hash ?? tx.id ?? 'unknown';
    console.log(`[ADMIN] Verified admin command from tx: ${txHash}`);

    const validation = validateCommand(cmd);
    if (!validation.valid) {
      console.warn(`[ADMIN] Command validation failed: ${validation.reason} (tx: ${txHash})`);
      continue;
    }

    markNonceUsed(cmd.nonce);
    console.log(`[ADMIN] Executing command '${cmd.command}' from tx: ${txHash}`);

    const result = await dispatchCommand(cmd, txHash, commandDb);
    if (result.success) {
      console.log(`[ADMIN] Command succeeded: ${result.message}`);
    } else {
      console.error(`[ADMIN] Command failed: ${result.message}`);
    }
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────

/**
 * Initialize admin command system
 */
export function initAdminCommands(): void {
  loadNonces();
  console.log(`[ADMIN] Admin command system initialized (HMAC OP_RETURN)`);
}

/**
 * Cleanup on shutdown
 */
export async function shutdownAdminCommands(): Promise<void> {
  await closeAllKnocks();
  console.log(`[ADMIN] Admin command system shutdown`);
}

// Re-export only what external consumers need
export { loadAdminConfig } from "./config";
export type { AdminConfig } from "./types";
