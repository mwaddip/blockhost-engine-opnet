/**
 * Type definitions for fund-manager and bw CLI (OPNet)
 */

export interface AddressbookEntry {
    /** 0x-prefixed 32-byte internal address (what Address.fromString consumes) */
    address: string;
    /** Path to mnemonic keyfile for signing roles */
    keyfile?: string;
}

export type Addressbook = Record<string, AddressbookEntry>;

export interface RevenueShareRecipient {
    role: string;
    /** Recipient's share in basis points (100 = 1%). Integer only. */
    bps: number;
    /** @deprecated Use bps instead. Kept for config migration. */
    percent?: number;
}

export interface RevenueShareConfig {
    enabled: boolean;
    /** Total revenue share in basis points (100 = 1%). Integer only. */
    total_bps: number;
    /** @deprecated Use total_bps instead. Kept for config migration. */
    total_percent?: number;
    recipients: RevenueShareRecipient[];
}

export interface FundManagerConfig {
    /** Wall-clock interval (hours). Legacy — superseded by fund_cycle_interval_blocks if set. */
    fund_cycle_interval_hours: number;
    /** Wall-clock interval (minutes). Legacy — superseded by gas_check_interval_blocks if set. */
    gas_check_interval_minutes: number;
    /** Block-height interval (preferred per facts §4 and the project's "block height over timestamps" principle). */
    fund_cycle_interval_blocks?: number;
    /** Block-height interval (preferred per facts §4). */
    gas_check_interval_blocks?: number;
    min_withdrawal_sats: bigint;
    gas_low_threshold_sats: bigint;
    gas_swap_amount_sats: bigint;
    server_stablecoin_buffer_sats: bigint;
    hot_wallet_gas_sats: bigint;
}

export interface FundManagerState {
    /** Unix ms of last fund cycle (legacy time-based mode). */
    last_fund_cycle: number;
    /** Unix ms of last gas check (legacy time-based mode). */
    last_gas_check: number;
    /** Block height of last fund cycle (preferred; written when fund_cycle_interval_blocks is set). */
    last_fund_cycle_block?: number;
    /** Block height of last gas check (preferred; written when gas_check_interval_blocks is set). */
    last_gas_check_block?: number;
    hot_wallet_generated: boolean;
}

