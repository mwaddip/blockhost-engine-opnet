/**
 * bw swap <amount> <from-token> <to-token> <wallet>
 *
 * Swap OP20 tokens via MotoSwap Router.
 *
 * Note: This is a placeholder. MotoSwap integration requires the Router ABI
 * and contract addresses to be configured. The EVM version used Uniswap V2;
 * the OPNet equivalent uses MotoSwap's AMM.
 *
 *   bw swap 20 stable btc server   — swap $20 stablecoin for BTC
 */

import type { JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import type { IBlockhostSubscriptions } from '../../fund-manager/contract-abis.js';

/**
 * Core swap operation — swap OP20 tokens via MotoSwap.
 *
 * TODO: Implement when MotoSwap Router ABI and addresses are available.
 * The EVM version used Uniswap V2 Router; OPNet uses MotoSwap for OP20-to-OP20
 * swaps and NativeSwap for BTC-to-OP20 swaps.
 */
export async function executeSwap(
    _amountStr: string,
    _fromTokenArg: string,
    _toTokenArg: string,
    _walletRole: string,
    _book: Addressbook,
    _provider: JSONRpcProvider,
    _contract: IBlockhostSubscriptions,
    _network: Network,
): Promise<void> {
    throw new Error(
        'Swap not yet implemented for OPNet. MotoSwap Router ABI required.',
    );
}

/**
 * CLI handler
 */
export async function swapCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 4) {
        console.error(
            'Usage: bw swap <amount> <from-token> <to-token> <wallet>',
        );
        console.error('  Example: bw swap 20 stable btc server');
        process.exit(1);
    }

    const [amountStr, fromTokenArg, toTokenArg, walletRole] = args;
    if (!amountStr || !fromTokenArg || !toTokenArg || !walletRole) {
        console.error(
            'Usage: bw swap <amount> <from-token> <to-token> <wallet>',
        );
        process.exit(1);
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        console.error(`Invalid amount: ${amountStr}`);
        process.exit(1);
    }

    console.log(
        `Swapping ${amountStr} ${fromTokenArg} for ${toTokenArg} using ${walletRole} wallet...`,
    );
    await executeSwap(
        amountStr,
        fromTokenArg,
        toTokenArg,
        walletRole,
        book,
        provider,
        contract,
        network,
    );
    console.log('Swapped.');
}
