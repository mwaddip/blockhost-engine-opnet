/**
 * Gas (BTC) monitoring (OPNet)
 *
 * On OPNet, "gas" is BTC satoshis used for transaction fees.
 * Periodically checks the server wallet's BTC balance and, if low,
 * swaps stablecoin for BTC via NativeSwap (OP20 → BTC).
 *
 * BTC balances come from `provider.getBalance` directly; stablecoin balances
 * use `getTokenBalanceOnly` with a pre-fetched `PaymentTokenContext` (so
 * decimals/symbol/address aren't re-queried per call).
 */

import type { JSONRpcProvider } from "opnet";
import type { Network } from "@btc-vision/bitcoin";
import type { Addressbook, FundManagerConfig } from "./types";
import type { IBlockhostSubscriptions } from "./contract-abis";
import { executeSwap } from "../bw/commands/swap";
import { formatBtc } from "../bw/cli-utils";
import { type PaymentTokenContext, formatUnits, getTokenBalanceOnly } from "./token-utils";

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
  tokenCtx: PaymentTokenContext | null,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!book.server?.address || !book.server?.keyfile) {
    console.error("[GAS] Cannot check gas: server wallet not available");
    return;
  }

  const serverBtcBalance = await provider.getBalance(book.server.address, true);

  if (serverBtcBalance >= config.gas_low_threshold_sats) {
    return; // Gas sufficient
  }

  console.warn(
    `[GAS] Server BTC low: ${formatBtc(serverBtcBalance)}, threshold: ${formatBtc(config.gas_low_threshold_sats)}`
  );

  if (!tokenCtx) {
    console.warn("[GAS] No payment token configured — cannot swap for BTC");
    return;
  }

  // Check if server has stablecoin to swap
  const serverStableBalance = await getTokenBalanceOnly(tokenCtx.address, book.server.address, provider, network);
  if (serverStableBalance === 0n) {
    console.warn("[GAS] No stablecoin available for swap — top up server wallet manually");
    return;
  }

  // Determine swap amount: use configured gas_swap_amount_sats, capped at balance
  const swapAmount = serverStableBalance < config.gas_swap_amount_sats
    ? serverStableBalance
    : config.gas_swap_amount_sats;

  const amountStr = formatUnits(swapAmount, tokenCtx.decimals);

  console.log(`[GAS] Swapping ${amountStr} ${tokenCtx.symbol} → BTC via NativeSwap`);

  try {
    await executeSwap(amountStr, "stable", "btc", "server", book, provider, contract, network);
    console.log("[GAS] Swap listed on NativeSwap — BTC will arrive as listing is filled");
  } catch (err) {
    console.error(`[GAS] Swap failed: ${err}`);
    console.warn("[GAS] Top up server BTC manually");
  }
}
