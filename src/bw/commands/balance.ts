/**
 * bw balance <role> [token]
 *
 * Show balances for a wallet (native BTC + payment token, or a specific token).
 */

import { JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import { resolveAddress } from '../../fund-manager/addressbook.js';
import {
    getTokenBalance,
    formatTokenBalance,
} from '../../fund-manager/token-utils.js';
import { resolveToken, formatBtc } from '../cli-utils.js';
import type { IBlockhostSubscriptions } from '../../fund-manager/contract-abis.js';

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

    const address = resolveAddress(roleOrAddr, book);
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
            const zeroAddr =
                '0x0000000000000000000000000000000000000000000000000000000000000000';
            if (tokenAddr !== zeroAddr) {
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
