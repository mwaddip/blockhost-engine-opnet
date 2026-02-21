/**
 * Fund manager configuration loading with defaults (OPNet)
 *
 * All monetary thresholds use base units:
 *   - BTC thresholds: satoshis
 *   - Token thresholds: token base units (e.g. 8 decimals for most OP20s)
 */

import * as fs from "fs";
import * as yaml from "js-yaml";
import type { FundManagerConfig, RevenueShareConfig } from "./types";

const BLOCKHOST_CONFIG_PATH = "/etc/blockhost/blockhost.yaml";
const REVENUE_SHARE_PATH = "/etc/blockhost/revenue-share.json";

const DEFAULTS: FundManagerConfig = {
  fund_cycle_interval_hours: 24,
  gas_check_interval_minutes: 30,
  min_withdrawal_sats: 50_000n,           // 0.0005 BTC or 50k token base units
  gas_low_threshold_sats: 10_000n,        // 0.0001 BTC — triggers gas swap warning
  gas_swap_amount_sats: 50_000n,          // 0.0005 BTC — target swap amount
  server_stablecoin_buffer_sats: 5_000_000n,  // stablecoin buffer in token base units
  hot_wallet_gas_sats: 100_000n,          // 0.001 BTC — target hot wallet BTC balance
};

/**
 * Load fund manager configuration from blockhost.yaml
 */
export function loadFundManagerConfig(): FundManagerConfig {
  try {
    if (!fs.existsSync(BLOCKHOST_CONFIG_PATH)) {
      return { ...DEFAULTS };
    }

    const config = yaml.load(
      fs.readFileSync(BLOCKHOST_CONFIG_PATH, "utf8")
    ) as Record<string, unknown>;

    const fm = config.fund_manager as Record<string, unknown> | undefined;
    if (!fm) {
      return { ...DEFAULTS };
    }

    return {
      fund_cycle_interval_hours:
        (fm.fund_cycle_interval_hours as number) || DEFAULTS.fund_cycle_interval_hours,
      gas_check_interval_minutes:
        (fm.gas_check_interval_minutes as number) || DEFAULTS.gas_check_interval_minutes,
      min_withdrawal_sats:
        fm.min_withdrawal_sats ? BigInt(fm.min_withdrawal_sats as number) : DEFAULTS.min_withdrawal_sats,
      gas_low_threshold_sats:
        fm.gas_low_threshold_sats ? BigInt(fm.gas_low_threshold_sats as number) : DEFAULTS.gas_low_threshold_sats,
      gas_swap_amount_sats:
        fm.gas_swap_amount_sats ? BigInt(fm.gas_swap_amount_sats as number) : DEFAULTS.gas_swap_amount_sats,
      server_stablecoin_buffer_sats:
        fm.server_stablecoin_buffer_sats ? BigInt(fm.server_stablecoin_buffer_sats as number) : DEFAULTS.server_stablecoin_buffer_sats,
      hot_wallet_gas_sats:
        fm.hot_wallet_gas_sats ? BigInt(fm.hot_wallet_gas_sats as number) : DEFAULTS.hot_wallet_gas_sats,
    };
  } catch (err) {
    console.error(`[FUND] Error loading config: ${err}`);
    return { ...DEFAULTS };
  }
}

/**
 * Load revenue share configuration from /etc/blockhost/revenue-share.json
 */
export function loadRevenueShareConfig(): RevenueShareConfig {
  const disabled: RevenueShareConfig = {
    enabled: false,
    total_bps: 0,
    recipients: [],
  };

  try {
    if (!fs.existsSync(REVENUE_SHARE_PATH)) {
      return disabled;
    }

    const data = fs.readFileSync(REVENUE_SHARE_PATH, "utf8");
    const raw = JSON.parse(data) as Record<string, unknown>;

    if (!raw.enabled) {
      return disabled;
    }

    const recipients = raw.recipients as Array<Record<string, unknown>> | undefined;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return disabled;
    }

    // Support both new bps format and legacy percent format
    const totalBps = raw.total_bps as number | undefined
      ?? (raw.total_percent ? Math.round((raw.total_percent as number) * 100) : 0);

    if (totalBps <= 0) {
      return disabled;
    }

    return {
      enabled: true,
      total_bps: totalBps,
      total_percent: raw.total_percent as number | undefined,
      recipients: recipients.map(r => ({
        role: r.role as string,
        bps: (r.bps as number | undefined) ?? (r.percent ? Math.round((r.percent as number) * 100) : 0),
        percent: r.percent as number | undefined,
      })),
    };
  } catch (err) {
    console.error(`[FUND] Error loading revenue share config: ${err}`);
    return disabled;
  }
}
