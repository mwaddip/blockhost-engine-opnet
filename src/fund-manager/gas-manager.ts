/**
 * Gas (BTC) monitoring (OPNet)
 *
 * On OPNet, "gas" is BTC satoshis used for transaction fees.
 * Periodically checks the server wallet's BTC balance and, if low,
 * swaps stablecoin for BTC via NativeSwap (OP20 → BTC).
 *
 * Uses bw executeBalance() for queries and bw executeSwap() for swaps.
 */

import type { JSONRpcProvider } from "opnet";
import type { Network } from "@btc-vision/bitcoin";
import type { Addressbook, FundManagerConfig } from "./types";
import type { IBlockhostSubscriptions } from "./contract-abis";
import { executeBalance } from "../bw/commands/balance";
import { executeSwap } from "../bw/commands/swap";
import { formatBtc } from "../bw/cli-utils";
import { formatUnits } from "./token-utils";

/**
 * Check server wallet BTC balance and swap stablecoin for BTC if low.
 *
 * Uses NativeSwap's listLiquidity (OP20 → BTC) via bw executeSwap().
 * The swap is asynchronous — tokens are listed for sale and BTC arrives
 * when a buyer fills the listing. This is acceptable for automated gas
 * management since it's not time-critical.
 */
export async function checkAndSwapGas(
  book: Addressbook,
  config: FundManagerConfig,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!book.server?.address || !book.server?.keyfile) {
    console.error("[GAS] Cannot check gas: server wallet not available");
    return;
  }

  const serverBal = await executeBalance("server", undefined, book, provider, contract, network);

  if (serverBal.btcBalance >= config.gas_low_threshold_sats) {
    return; // Gas sufficient
  }

  console.warn(
    `[GAS] Server BTC low: ${formatBtc(serverBal.btcBalance)}, threshold: ${formatBtc(config.gas_low_threshold_sats)}`
  );

  // Check if server has stablecoin to swap
  const stableBal = await executeBalance("server", "stable", book, provider, contract, network);
  if (stableBal.tokenBalance === undefined || stableBal.tokenBalance === 0n) {
    console.warn("[GAS] No stablecoin available for swap — top up server wallet manually");
    return;
  }

  // Determine swap amount: use configured gas_swap_amount_sats worth,
  // but cap at available stablecoin balance
  const swapAmount = stableBal.tokenBalance < config.gas_swap_amount_sats
    ? stableBal.tokenBalance
    : config.gas_swap_amount_sats;

  const decimals = stableBal.tokenDecimals ?? 8;
  const amountStr = formatUnits(swapAmount, decimals);

  console.log(`[GAS] Swapping ${amountStr} ${stableBal.tokenSymbol ?? 'stable'} → BTC via NativeSwap`);

  try {
    await executeSwap(amountStr, "stable", "btc", "server", book, provider, contract, network);
    console.log("[GAS] Swap listed on NativeSwap — BTC will arrive as listing is filled");
  } catch (err) {
    console.error(`[GAS] Swap failed: ${err}`);
    console.warn("[GAS] Top up server BTC manually");
  }
}
