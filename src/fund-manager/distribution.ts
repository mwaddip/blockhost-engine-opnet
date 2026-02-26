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
import { getAllTokenBalances, formatUnits } from "./token-utils";
import { executeBalance } from "../bw/commands/balance";
import { executeSend } from "../bw/commands/send";
import { formatBtc } from "../bw/cli-utils";

/**
 * Convert satoshis to BTC decimal string for executeSend.
 * e.g. 100000n → "0.00100000"
 */
function satsToStr(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = (sats % 100_000_000n).toString().padStart(8, '0');
  return `${whole}.${frac}`;
}

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

  const hotBal = await executeBalance("hot", undefined, book, provider, contract, network);
  if (hotBal.btcBalance >= config.hot_wallet_gas_sats) return;

  const needed = config.hot_wallet_gas_sats - hotBal.btcBalance;
  const serverBal = await executeBalance("server", undefined, book, provider, contract, network);
  if (serverBal.btcBalance < needed * 2n) {
    console.warn("[FUND] Server BTC too low to top up hot wallet");
    return;
  }

  console.log(`[FUND] Topping up hot wallet gas: ${formatBtc(needed)}`);
  await executeSend(satsToStr(needed), "btc", "server", "hot", book, provider, contract, network);
  console.log("[FUND] Hot wallet gas top-up complete");
}

/**
 * Step 3: Ensure server wallet has enough stablecoin for operations.
 * Hot wallet sends stablecoin to server if server balance is below buffer.
 */
export async function topUpServerStablecoinBuffer(
  book: Addressbook,
  config: FundManagerConfig,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!book.server?.address) return;
  if (!book.hot?.address) return;

  const serverBal = await executeBalance("server", "stable", book, provider, contract, network);
  if (serverBal.tokenBalance === undefined) return; // no payment token configured

  if (serverBal.tokenBalance >= config.server_stablecoin_buffer_sats) return;

  // Check hot wallet has enough
  const needed = config.server_stablecoin_buffer_sats - serverBal.tokenBalance;

  const hotBal = await executeBalance("hot", "stable", book, provider, contract, network);
  if ((hotBal.tokenBalance ?? 0n) < needed) {
    console.warn("[FUND] Hot wallet stablecoin insufficient for server buffer top-up");
    return;
  }

  const decimals = serverBal.tokenDecimals ?? 8;
  const neededStr = formatUnits(needed, decimals);
  console.log(`[FUND] Topping up server stablecoin buffer: ${neededStr}`);
  await executeSend(neededStr, serverBal.tokenAddress!, "hot", "server", book, provider, contract, network);
  console.log("[FUND] Server stablecoin buffer topped up");
}

/**
 * Step 4: Distribute revenue shares from hot wallet.
 */
export async function distributeRevenueShares(
  book: Addressbook,
  revenueConfig: RevenueShareConfig,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!revenueConfig.enabled || revenueConfig.recipients.length === 0) {
    return;
  }

  // Resolve total_bps (with fallback from deprecated total_percent)
  const totalBps = revenueConfig.total_bps ?? Math.round((revenueConfig.total_percent ?? 0) * 100);
  if (totalBps <= 0) return;

  const balances = await getAllTokenBalances(book.hot!.address, contract, provider, network);

  for (const tb of balances) {
    if (tb.balance === 0n) continue;

    // Calculate total share amount using integer basis points (no float math)
    const totalShareAmount = (tb.balance * BigInt(totalBps)) / 10000n;
    if (totalShareAmount === 0n) continue;

    // Distribute to each recipient
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
        const shareStr = formatUnits(share, tb.decimals);
        await executeSend(shareStr, tb.tokenAddress, "hot", recipient.role, book, provider, contract, network);
        console.log(
          `[FUND] Revenue share: sent ${shareStr} ${tb.symbol} to ${recipient.role} (${recipientBps} bps)`
        );
      } catch (err) {
        console.error(`[FUND] Error sending revenue share to ${recipient.role}: ${err}`);
      }
    }
  }
}

/**
 * Step 5: Send all remaining token balances from hot wallet to admin.
 */
export async function sendRemainderToAdmin(
  book: Addressbook,
  provider: JSONRpcProvider,
  contract: IBlockhostSubscriptions,
  network: Network,
): Promise<void> {
  if (!await resolveAddress("admin", book)) {
    console.error("[FUND] Cannot send remainder: admin not in addressbook");
    return;
  }

  const balances = await getAllTokenBalances(book.hot!.address, contract, provider, network);

  for (const tb of balances) {
    if (tb.balance === 0n) continue;

    try {
      const amountStr = formatUnits(tb.balance, tb.decimals);
      await executeSend(amountStr, tb.tokenAddress, "hot", "admin", book, provider, contract, network);
      console.log(`[FUND] Remainder: sent ${amountStr} ${tb.symbol} to admin`);
    } catch (err) {
      console.error(`[FUND] Error sending remainder to admin: ${err}`);
    }
  }
}
