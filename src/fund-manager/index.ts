/**
 * Fund Manager Module (OPNet)
 *
 * Periodic tasks integrated into the monitor polling loop:
 *  - Fund cycle (every 24h): withdraw from contract → distribute to stakeholders
 *  - Gas check (every 30min): ensure server + hot wallets have enough BTC
 *
 * Follows the same pattern as src/reconcile/index.ts
 */

import { getContract, type JSONRpcProvider } from "opnet";
import type { Network } from "@btc-vision/bitcoin";
import { loadFundManagerConfig, loadRevenueShareConfig } from "./config";
import { loadAddressbook, ensureHotWallet } from "./addressbook";
import { loadState, updateState } from "./state";
import { loadWeb3Config } from "./web3-config";
import {
  BLOCKHOST_SUBSCRIPTIONS_ABI,
  type IBlockhostSubscriptions,
} from "./contract-abis";
import { withdrawFromContract } from "./withdrawal";
import {
  topUpHotWalletGas,
  topUpServerStablecoinBuffer,
  distributeRevenueShares,
  sendRemainderToAdmin,
} from "./distribution";
import { checkAndSwapGas } from "./gas-manager";
import {
  type PaymentTokenContext,
  ZERO_ADDRESS,
  getTokenMetadata,
} from "./token-utils";

/**
 * Fetch the payment token's address + metadata once per cycle.
 *
 * Returns null if no payment token is configured on the contract. Step
 * functions short-circuit on null rather than each re-querying getPaymentToken.
 */
async function loadPaymentTokenContext(
  contract: IBlockhostSubscriptions,
  provider: JSONRpcProvider,
  network: Network,
): Promise<PaymentTokenContext | null> {
  try {
    const tokenResult = await contract.getPaymentToken();
    if ('error' in tokenResult) return null;
    const address = tokenResult.properties.token.toString();
    if (address === ZERO_ADDRESS) return null;
    const meta = await getTokenMetadata(address, provider, network);
    return { address, decimals: meta.decimals, symbol: meta.symbol };
  } catch (err) {
    console.error(`[FUND] Could not load payment token context: ${err}`);
    return null;
  }
}

let fundCycleInProgress = false;
let gasCheckInProgress = false;

const config = loadFundManagerConfig();
const fundCycleIntervalMs = config.fund_cycle_interval_hours * 60 * 60 * 1000;
const gasCheckIntervalMs = config.gas_check_interval_minutes * 60 * 1000;

/**
 * Check if the fund cycle should run.
 *
 * Prefers block-based scheduling (per facts §4 and the project's "block height
 * over timestamps" principle). Falls back to wall-clock if `_blocks` config is
 * absent. Block-based mode triggers on first run (no `last_fund_cycle_block`
 * yet) so the first cycle establishes the baseline.
 */
export function shouldRunFundCycle(currentBlock: bigint): boolean {
  const state = loadState();

  if (config.fund_cycle_interval_blocks !== undefined) {
    if (state.last_fund_cycle_block === undefined) return true;
    return Number(currentBlock) - state.last_fund_cycle_block >= config.fund_cycle_interval_blocks;
  }

  return Date.now() - state.last_fund_cycle >= fundCycleIntervalMs;
}

/**
 * Check if the gas check should run. See shouldRunFundCycle for semantics.
 */
export function shouldRunGasCheck(currentBlock: bigint): boolean {
  const state = loadState();

  if (config.gas_check_interval_blocks !== undefined) {
    if (state.last_gas_check_block === undefined) return true;
    return Number(currentBlock) - state.last_gas_check_block >= config.gas_check_interval_blocks;
  }

  return Date.now() - state.last_gas_check >= gasCheckIntervalMs;
}

/**
 * Display string for the configured fund cycle interval (used in startup log).
 */
export function getFundCycleInterval(): string {
  if (config.fund_cycle_interval_blocks !== undefined) {
    return `${config.fund_cycle_interval_blocks} blocks`;
  }
  return `${config.fund_cycle_interval_hours}h`;
}

/**
 * Display string for the configured gas check interval (used in startup log).
 */
export function getGasCheckInterval(): string {
  if (config.gas_check_interval_blocks !== undefined) {
    return `${config.gas_check_interval_blocks} blocks`;
  }
  return `${config.gas_check_interval_minutes}min`;
}

/**
 * Run the full fund withdrawal and distribution cycle.
 *
 * 1. Withdraw from contract to hot wallet
 * 2. Top up hot wallet gas (server → hot BTC if hot is low)
 * 3. Top up server stablecoin buffer (hot → server tokens)
 * 4. Revenue shares (if enabled)
 * 5. Remainder to admin
 */
export async function runFundCycle(provider: JSONRpcProvider, network: Network, currentBlock: bigint): Promise<void> {
  if (fundCycleInProgress) return;
  fundCycleInProgress = true;

  try {
    const web3Config = loadWeb3Config();
    const contractAddress = web3Config.subscriptionContract;

    console.log("[FUND] Starting fund cycle...");

    // Load addressbook and ensure hot wallet exists
    let book = loadAddressbook();
    if (Object.keys(book).length === 0) {
      console.error("[FUND] Addressbook empty, skipping fund cycle");
      return;
    }
    book = await ensureHotWallet(book);

    const contract = getContract<IBlockhostSubscriptions>(
      contractAddress,
      BLOCKHOST_SUBSCRIPTIONS_ABI,
      provider,
      network,
    );

    // Fetch payment token info once for the whole cycle (saves ~3 RPC per
    // step that previously went through executeBalance("...", "stable", ...))
    const tokenCtx = await loadPaymentTokenContext(contract, provider, network);

    // Step 1: Withdraw from contract to hot wallet
    await withdrawFromContract(book, config, contract, contractAddress, provider, network);

    // Steps 2-5 each wrapped so a single failure doesn't skip the rest
    try {
      // Step 2: Top up hot wallet gas (server → hot, BTC only)
      await topUpHotWalletGas(book, config, provider, contract, network);
    } catch (err) {
      console.error(`[FUND] Step 2 (hot wallet gas) failed: ${err}`);
    }

    try {
      // Step 3: Top up server stablecoin buffer (hot → server)
      await topUpServerStablecoinBuffer(book, config, tokenCtx, provider, contract, network);
    } catch (err) {
      console.error(`[FUND] Step 3 (stablecoin buffer) failed: ${err}`);
    }

    try {
      // Step 4: Revenue shares (hot → dev/broker)
      const revenueConfig = loadRevenueShareConfig();
      await distributeRevenueShares(book, revenueConfig, tokenCtx, provider, contract, network);
    } catch (err) {
      console.error(`[FUND] Step 4 (revenue shares) failed: ${err}`);
    }

    try {
      // Step 5: Remainder to admin (hot → admin)
      await sendRemainderToAdmin(book, tokenCtx, provider, contract, network);
    } catch (err) {
      console.error(`[FUND] Step 5 (remainder to admin) failed: ${err}`);
    }

    console.log("[FUND] Fund cycle complete");
  } catch (err) {
    console.error(`[FUND] Error during fund cycle: ${err}`);
  } finally {
    if (config.fund_cycle_interval_blocks !== undefined) {
      updateState({ last_fund_cycle_block: Number(currentBlock) });
    } else {
      updateState({ last_fund_cycle: Date.now() });
    }
    fundCycleInProgress = false;
  }
}

/**
 * Run the gas balance check and swap if needed.
 */
export async function runGasCheck(provider: JSONRpcProvider, network: Network, currentBlock: bigint): Promise<void> {
  if (gasCheckInProgress) return;
  gasCheckInProgress = true;

  try {
    const web3Config = loadWeb3Config();
    const contractAddress = web3Config.subscriptionContract;

    const book = loadAddressbook();
    if (Object.keys(book).length === 0) return;

    const contract = getContract<IBlockhostSubscriptions>(
      contractAddress,
      BLOCKHOST_SUBSCRIPTIONS_ABI,
      provider,
      network,
    );

    // Top up hot wallet BTC from server if low (BTC only — no tokenCtx needed)
    if (book.hot) {
      await topUpHotWalletGas(book, config, provider, contract, network);
    }

    // Fetch payment token info once for this cycle (used by checkAndSwapGas)
    const tokenCtx = await loadPaymentTokenContext(contract, provider, network);

    // Check server BTC and swap if needed
    await checkAndSwapGas(book, config, tokenCtx, provider, contract, network);
  } catch (err) {
    console.error(`[GAS] Error during gas check: ${err}`);
  } finally {
    if (config.gas_check_interval_blocks !== undefined) {
      updateState({ last_gas_check_block: Number(currentBlock) });
    } else {
      updateState({ last_gas_check: Date.now() });
    }
    gasCheckInProgress = false;
  }
}
