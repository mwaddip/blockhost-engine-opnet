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

let fundCycleInProgress = false;
let gasCheckInProgress = false;

const config = loadFundManagerConfig();
const fundCycleIntervalMs = config.fund_cycle_interval_hours * 60 * 60 * 1000;
const gasCheckIntervalMs = config.gas_check_interval_minutes * 60 * 1000;

/**
 * Check if the fund cycle should run (based on interval)
 */
export function shouldRunFundCycle(): boolean {
  const state = loadState();
  const now = Date.now();
  return now - state.last_fund_cycle >= fundCycleIntervalMs;
}

/**
 * Check if the gas check should run (based on interval)
 */
export function shouldRunGasCheck(): boolean {
  const state = loadState();
  const now = Date.now();
  return now - state.last_gas_check >= gasCheckIntervalMs;
}

/**
 * Get fund cycle interval in milliseconds
 */
export function getFundCycleInterval(): number {
  return fundCycleIntervalMs;
}

/**
 * Get gas check interval in milliseconds
 */
export function getGasCheckInterval(): number {
  return gasCheckIntervalMs;
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
export async function runFundCycle(provider: JSONRpcProvider, network: Network): Promise<void> {
  if (fundCycleInProgress) return;
  fundCycleInProgress = true;

  try {
    const web3Config = loadWeb3Config();
    const contractAddress = web3Config.subscriptionsContract;

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

    // Step 1: Withdraw from contract to hot wallet
    await withdrawFromContract(book, config, contract, contractAddress, provider, network);

    // Step 2: Top up hot wallet gas (server → hot)
    await topUpHotWalletGas(book, config, provider, contract, network);

    // Step 3: Top up server stablecoin buffer (hot → server)
    await topUpServerStablecoinBuffer(book, config, provider, contract, network);

    // Step 4: Revenue shares (hot → dev/broker)
    const revenueConfig = loadRevenueShareConfig();
    await distributeRevenueShares(book, revenueConfig, provider, contract, network);

    // Step 5: Remainder to admin (hot → admin)
    await sendRemainderToAdmin(book, provider, contract, network);

    console.log("[FUND] Fund cycle complete");
  } catch (err) {
    console.error(`[FUND] Error during fund cycle: ${err}`);
  } finally {
    updateState({ last_fund_cycle: Date.now() });
    fundCycleInProgress = false;
  }
}

/**
 * Run the gas balance check and swap if needed.
 */
export async function runGasCheck(provider: JSONRpcProvider, network: Network): Promise<void> {
  if (gasCheckInProgress) return;
  gasCheckInProgress = true;

  try {
    const web3Config = loadWeb3Config();
    const contractAddress = web3Config.subscriptionsContract;

    const book = loadAddressbook();
    if (Object.keys(book).length === 0) return;

    const contract = getContract<IBlockhostSubscriptions>(
      contractAddress,
      BLOCKHOST_SUBSCRIPTIONS_ABI,
      provider,
      network,
    );

    // Top up hot wallet BTC from server if low
    if (book.hot) {
      await topUpHotWalletGas(book, config, provider, contract, network);
    }

    // Check server BTC and swap if needed
    await checkAndSwapGas(book, config, provider, contract, network);
  } catch (err) {
    console.error(`[GAS] Error during gas check: ${err}`);
  } finally {
    updateState({ last_gas_check: Date.now() });
    gasCheckInProgress = false;
  }
}
