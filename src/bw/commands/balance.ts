/**
 * bw balance <role> [token]
 *
 * Show balances for a wallet (native BTC + payment token, or a specific token).
 * Core function executeBalance() is also used by fund-manager.
 */

import { JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import { resolveAddress } from '../../fund-manager/addressbook.js';
import {
    getTokenBalance,
    formatTokenBalance,
    ZERO_ADDRESS,
} from '../../fund-manager/token-utils.js';
import { resolveToken, formatBtc } from '../cli-utils.js';
import type { IBlockhostSubscriptions } from '../../fund-manager/contract-abis.js';

export interface BalanceResult {
    address: string;
    btcBalance: bigint;
    tokenBalance?: bigint;
    tokenDecimals?: number;
    tokenSymbol?: string;
    tokenAddress?: string;
}

/**
 * Core balance query — used by both CLI and fund-manager.
 * Returns BTC balance and optionally a token balance.
 *
 * @param roleOrAddr  Addressbook role name or raw 0x address
 * @param tokenArg    Optional: "btc", "stable", or 0x token address.
 *                    If omitted, only BTC balance is returned.
 */
export async function executeBalance(
    roleOrAddr: string,
    tokenArg: string | undefined,
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<BalanceResult> {
    const address = await resolveAddress(roleOrAddr, book);
    if (!address) {
        throw new Error(`Cannot resolve address for '${roleOrAddr}'`);
    }

    const btcBalance = await provider.getBalance(address, true);
    const result: BalanceResult = { address, btcBalance };

    if (tokenArg) {
        const resolved = await resolveToken(tokenArg, contract);
        if (!resolved.isNative) {
            const tb = await getTokenBalance(
                resolved.address, address, provider, network,
            );
            result.tokenBalance = tb.balance;
            result.tokenDecimals = tb.decimals;
            result.tokenSymbol = tb.symbol;
            result.tokenAddress = resolved.address;
        }
    }

    return result;
}

export async function balanceCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: bw balance <role> [token]');
        process.exit(1);
    }

    const [roleOrAddr, tokenArg] = args;
    if (!roleOrAddr) {
        console.error('Usage: bw balance <role> [token]');
        process.exit(1);
    }

    const address = await resolveAddress(roleOrAddr, book);
    if (!address) {
        process.exit(1);
    }

    console.log(`\nBalances for ${roleOrAddr} (${address}):\n`);

    // Native BTC balance (in sats)
    const btcBalance = await provider.getBalance(address, true);
    console.log(`  BTC          ${formatBtc(btcBalance)}`);

    // If a specific token was requested
    if (tokenArg) {
        const resolved = await resolveToken(tokenArg, contract);
        if (resolved.isNative) {
            console.log();
            return;
        }

        const { balance, decimals, symbol } = await getTokenBalance(
            resolved.address,
            address,
            provider,
            network,
        );
        console.log(
            `  ${symbol.padEnd(12)} ${formatTokenBalance(balance, decimals, symbol)}`,
        );
        console.log();
        return;
    }

    // Show payment token balance if configured
    try {
        const paymentResult = await contract.getPaymentToken();
        if (!('error' in paymentResult)) {
            const tokenAddr =
                paymentResult.properties.token.toString();
            if (tokenAddr !== ZERO_ADDRESS) {
                const { balance, decimals, symbol } =
                    await getTokenBalance(
                        tokenAddr,
                        address,
                        provider,
                        network,
                    );
                console.log(
                    `  ${symbol.padEnd(12)} ${formatTokenBalance(balance, decimals, symbol)}`,
                );
            }
        }
    } catch {
        // Payment token query failed — not critical
    }

    console.log();
}
