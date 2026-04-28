/**
 * Admin command types for HMAC-authenticated OP_RETURN protocol
 */

import type { ChildProcess } from "child_process";

/**
 * Admin command payload (parsed from OP_RETURN)
 *
 * Wire format: "{nonce} {command}" + HMAC-SHA256(sharedKey)[:16 bytes]
 */
export interface AdminCommand {
  command: string;           // Command text (maps to action in command database)
  nonce: string;             // Anti-replay nonce
}

/**
 * Admin configuration from blockhost.yaml
 */
export interface AdminConfig {
  wallet_address: string;           // Admin wallet (0x + 64 hex, OPNet internal format)
  shared_key: string;               // HMAC shared key (32-byte hex, no prefix)
  max_command_age?: number;         // Deprecated: pruning is now block-height based (~1 year). Kept for config compat.
}

/**
 * Command definition in admin-commands.json
 */
export interface CommandDefinition {
  action: string;                   // Action type: 'knock', etc.
  description?: string;             // Admin reference only
  params: Record<string, unknown>;  // Action-specific configuration
}

/**
 * Command database structure (admin-commands.json)
 */
export interface CommandDatabase {
  commands: Record<string, CommandDefinition>;
}

/**
 * Knock action configuration (from admin-commands.json's params field).
 *
 * The wire protocol carries only the command name + nonce; all knock
 * options come from this config object.
 */
export interface KnockActionConfig {
  allowed_ports?: number[];         // Ports that can be opened (default: [22])
  default_duration?: number;        // Default duration if not specified (default: 300)
  ports?: number[];                 // Specific ports to open (defaults to allowed_ports)
  duration?: number;                // Specific duration (defaults to default_duration)
  source?: string;                  // Optional IPv6 source filter
}

/**
 * Result of command execution
 */
export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Active knock state (tracked in memory)
 */
export interface ActiveKnock {
  txHash: string;
  ports: number[];
  source?: string;              // IPv6 source filter (if set, rules are per-source)
  startTime: number;
  duration: number;
  timeoutId: NodeJS.Timeout;
  loginSource?: string;         // IP narrowed to after login detection (phase 2)
  heartbeatInterval?: NodeJS.Timeout;  // Heartbeat file poller
  tailProcess?: ChildProcess;   // auth.log tail handle
}
