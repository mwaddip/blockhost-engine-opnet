/**
 * Contract withdrawal logic (OPNet)
 *
 * Step 1 of the fund cycle: withdraw accumulated payment tokens from the
 * subscription contract to the hot wallet.
 *
 * On OPNet, the BlockhostSubscriptions contract has a single payment token
 * and a withdraw(to) method that moves the accumulated balance to a recipient.
 */

import type { JSONRpcProvider } from "opnet";
import type { Network } from "@btc-vision/bitcoin";
import type { Addressbook, FundManagerConfig } from "./types";
import type { IBlockhostSubscriptions } from "./contract-abis";
import { getTokenBalance, formatTokenBalance } from "./token-utils";
import { executeWithdraw } from "../bw/commands/withdraw";

/**
 * Withdraw payment token balance from the contract to the hot wallet.
 * Only withdraws if balance exceeds the configured threshold.
 */
export async function withdrawFromContract(
  book: Addressbook,
  config: FundManagerConfig,
  contract: IBlockhostSubscriptions,
  contractAddress: string,
  provider: JSONRpcProvider,
  network: Network,
): Promise<void> {
  if (!book.server?.keyfile) {
    console.error("[FUND] Cannot withdraw: server wallet has no keyfile");
    return;
  }

  if (!book.hot?.address) {
    console.error("[FUND] Cannot withdraw: hot wallet not configured");
    return;
  }

  // Get payment token address
  const tokenResult = await contract.getPaymentToken();
  if ('error' in tokenResult) {
    console.error("[FUND] Error querying payment token");
    return;
  }

  const tokenAddr = tokenResult.properties.token.toString();
  const zeroAddr = '0x' + '0'.repeat(64);
  if (tokenAddr === zeroAddr) {
    console.log("[FUND] No payment token configured, skipping withdrawal");
    return;
  }

  // Check contract's token balance
  const { balance, decimals, symbol } = await getTokenBalance(
    tokenAddr,
    contractAddress,
    provider,
    network,
  );

  if (balance === 0n) {
    console.log("[FUND] No token balance in contract, skipping withdrawal");
    return;
  }

  // Check if balance meets minimum threshold
  if (balance < config.min_withdrawal_sats) {
    console.log(
      `[FUND] Skipping withdrawal: ${formatTokenBalance(balance, decimals, symbol)} below threshold`
    );
    return;
  }

  console.log(`[FUND] Withdrawing ${formatTokenBalance(balance, decimals, symbol)} to hot wallet`);

  await executeWithdraw("hot", book, provider, contractAddress, network);
  console.log("[FUND] Withdrawal complete");
}
