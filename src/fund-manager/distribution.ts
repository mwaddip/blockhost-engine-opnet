/**
 * Hot wallet distribution logic (OPNet)
 *
 * Steps 2-5 of the fund cycle:
 *  2. Top up hot wallet gas (server → hot BTC if hot is low)
 *  3. Top up server stablecoin buffer (hot → server stablecoin)
 *  4. Revenue shares (hot → dev/broker per revenue-share.json)
 *  5. Remainder to admin (hot → admin)
 *
 * All transfers use bw executeSend() — no inline transfer code.
 */

import type { JSONRpcProvider } from "opnet";
import type { Network } from "@btc-vision/bitcoin";
import type { Addressbook, FundManagerConfig, RevenueShareConfig } from "./types";
import type { IBlockhostSubscriptions } from "./contract-abis";
import { resolveAddress } from "./addressbook";
import { type PaymentTokenContext, formatUnits, getTokenBalanceOnly } from "./token-utils";
import { executeSend } from "../bw/commands/send";
import { formatBtc } from "../bw/cli-utils";

/**
 * Step 2: Ensure hot wallet has enough BTC for transaction fees.
 * Server sends BTC to bring it up to the configured target (hot_wallet_gas_sats).
 * Also called from the periodic gas check cycle.
 */
export async function topUpHotWalletGas(
  book: Addressbook,
  config: FundManagerConfig,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!book.hot?.address) return;
  if (!book.server?.address || !book.server?.keyfile) return;

  const hotBalance = await provider.getBalance(book.hot.address, true);
  if (hotBalance >= config.hot_wallet_gas_sats) return;

  const needed = config.hot_wallet_gas_sats - hotBalance;
  const serverBalance = await provider.getBalance(book.server.address, true);
  if (serverBalance < needed * 2n) {
    console.warn("[FUND] Server BTC too low to top up hot wallet");
    return;
  }

  console.log(`[FUND] Topping up hot wallet gas: ${formatBtc(needed)}`);
  await executeSend(formatUnits(needed, 8), "btc", "server", "hot", book, provider, contract, network);
  console.log("[FUND] Hot wallet gas top-up complete");
}

/**
 * Step 3: Ensure server wallet has enough stablecoin for operations.
 * Hot wallet sends stablecoin to server if server balance is below buffer.
 */
export async function topUpServerStablecoinBuffer(
  book: Addressbook,
  config: FundManagerConfig,
  tokenCtx: PaymentTokenContext | null,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!book.server?.address) return;
  if (!book.hot?.address) return;
  if (!tokenCtx) return; // no payment token configured

  const serverBalance = await getTokenBalanceOnly(tokenCtx.address, book.server.address, provider, network);
  if (serverBalance >= config.server_stablecoin_buffer_sats) return;

  const needed = config.server_stablecoin_buffer_sats - serverBalance;
  const hotBalance = await getTokenBalanceOnly(tokenCtx.address, book.hot.address, provider, network);
  if (hotBalance < needed) {
    console.warn("[FUND] Hot wallet stablecoin insufficient for server buffer top-up");
    return;
  }

  const neededStr = formatUnits(needed, tokenCtx.decimals);
  console.log(`[FUND] Topping up server stablecoin buffer: ${neededStr}`);
  await executeSend(neededStr, tokenCtx.address, "hot", "server", book, provider, contract, network);
  console.log("[FUND] Server stablecoin buffer topped up");
}

/**
 * Step 4: Distribute revenue shares from hot wallet.
 *
 * OPNet has a single payment token, so this iterates recipients (not tokens)
 * and sends each their share of the hot wallet's stablecoin balance.
 */
export async function distributeRevenueShares(
  book: Addressbook,
  revenueConfig: RevenueShareConfig,
  tokenCtx: PaymentTokenContext | null,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!revenueConfig.enabled || revenueConfig.recipients.length === 0) return;
  if (!tokenCtx) return;

  // Resolve total_bps (with fallback from deprecated total_percent)
  const totalBps = revenueConfig.total_bps ?? Math.round((revenueConfig.total_percent ?? 0) * 100);
  if (totalBps <= 0) return;

  const hotBalance = await getTokenBalanceOnly(tokenCtx.address, book.hot!.address, provider, network);
  if (hotBalance === 0n) return;

  // Calculate total share amount using integer basis points (no float math)
  const totalShareAmount = (hotBalance * BigInt(totalBps)) / 10000n;
  if (totalShareAmount === 0n) return;

  // Distribute to each recipient — last gets the rounding remainder
  let distributed = 0n;
  for (let i = 0; i < revenueConfig.recipients.length; i++) {
    const recipient = revenueConfig.recipients[i]!;
    const recipientAddress = await resolveAddress(recipient.role, book);
    if (!recipientAddress) {
      console.error(`[FUND] Revenue share recipient '${recipient.role}' not in addressbook`);
      continue;
    }

    // Resolve recipient bps (with fallback from deprecated percent)
    const recipientBps = recipient.bps ?? Math.round((recipient.percent ?? 0) * 100);

    const isLast = i === revenueConfig.recipients.length - 1;
    const share = isLast
      ? totalShareAmount - distributed
      : (totalShareAmount * BigInt(recipientBps)) / BigInt(totalBps);
    distributed += share;
    if (share === 0n) continue;

    try {
      const shareStr = formatUnits(share, tokenCtx.decimals);
      await executeSend(shareStr, tokenCtx.address, "hot", recipient.role, book, provider, contract, network);
      console.log(
        `[FUND] Revenue share: sent ${shareStr} ${tokenCtx.symbol} to ${recipient.role} (${recipientBps} bps)`
      );
    } catch (err) {
      console.error(`[FUND] Error sending revenue share to ${recipient.role}: ${err}`);
    }
  }
}

/**
 * Step 5: Send all remaining payment-token balance from hot wallet to admin.
 */
export async function sendRemainderToAdmin(
  book: Addressbook,
  tokenCtx: PaymentTokenContext | null,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!await resolveAddress("admin", book)) {
    console.error("[FUND] Cannot send remainder: admin not in addressbook");
    return;
  }
  if (!tokenCtx) return;

  const hotBalance = await getTokenBalanceOnly(tokenCtx.address, book.hot!.address, provider, network);
  if (hotBalance === 0n) return;

  try {
    const amountStr = formatUnits(hotBalance, tokenCtx.decimals);
    await executeSend(amountStr, tokenCtx.address, "hot", "admin", book, provider, contract, network);
    console.log(`[FUND] Remainder: sent ${amountStr} ${tokenCtx.symbol} to admin`);
  } catch (err) {
    console.error(`[FUND] Error sending remainder to admin: ${err}`);
  }
}
