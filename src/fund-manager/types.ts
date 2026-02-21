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
    fund_cycle_interval_hours: number;
    gas_check_interval_minutes: number;
    min_withdrawal_sats: bigint;
    gas_low_threshold_sats: bigint;
    gas_swap_amount_sats: bigint;
    server_stablecoin_buffer_sats: bigint;
    hot_wallet_gas_sats: bigint;
}

export interface FundManagerState {
    last_fund_cycle: number;
    last_gas_check: number;
    hot_wallet_generated: boolean;
}

export interface TokenBalance {
    /** 0x-prefixed 32-byte contract address */
    tokenAddress: string;
    symbol: string;
    /** Balance in base units */
    balance: bigint;
    decimals: number;
}
