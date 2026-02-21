/**
 * bw send <amount> <token> <from> <to>
 *
 * Send tokens from a signing wallet to a recipient.
 * Core function executeSend() is also used by fund-manager.
 *
 * On OPNet, "btc" sends native satoshis, all other tokens are OP20 transfers.
 */

import { JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import {
    resolveAddress,
    resolveWallet,
} from '../../fund-manager/addressbook.js';
import {
    transferToken,
    getTokenBalance,
} from '../../fund-manager/token-utils.js';
import { resolveToken } from '../cli-utils.js';
import type { IBlockhostSubscriptions } from '../../fund-manager/contract-abis.js';

/**
 * Core send operation — used by both CLI and fund-manager.
 * Throws on error (caller decides how to handle).
 */
export async function executeSend(
    amountStr: string,
    tokenArg: string,
    fromRole: string,
    toRole: string,
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    const wallet = resolveWallet(fromRole, book, network);
    if (!wallet)
        throw new Error(`Cannot sign as '${fromRole}': no keyfile`);

    const toAddress = resolveAddress(toRole, book);
    if (!toAddress)
        throw new Error(`Cannot resolve recipient '${toRole}'`);

    const resolved = await resolveToken(tokenArg, contract);

    if (resolved.isNative) {
        // Send BTC — amount is in BTC, convert to sats
        const parts = amountStr.split('.');
        const wholePart = parts[0] ?? '0';
        const fracPart = (parts[1] ?? '').padEnd(8, '0').slice(0, 8);
        const sats = BigInt(wholePart) * 100_000_000n + BigInt(fracPart);

        const { TransactionFactory } = await import(
            '@btc-vision/transaction'
        );
        const factory = new TransactionFactory();
        const utxos = await provider.utxoManager.getUTXOs({
            address: wallet.p2tr,
            optimize: false,
        });

        if (utxos.length === 0) {
            throw new Error(`No UTXOs available for ${fromRole}`);
        }

        // Dynamic fee rate from network
        const gas = await provider.gasParameters();
        const feeRate = gas.bitcoin.recommended.medium;

        const result = await factory.createBTCTransfer({
            from: wallet.p2tr,
            to: toAddress,
            amount: sats,
            utxos,
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            network,
            feeRate,
            priorityFee: 0n,
            gasSatFee: 0n,
        });

        await provider.sendRawTransaction(result.tx, false);
        return;
    }

    // OP20 token transfer
    const { decimals } = await getTokenBalance(
        resolved.address,
        wallet.address.toString(),
        provider,
        network,
    );

    // Parse amount with decimals
    const parts = amountStr.split('.');
    const wholePart = parts[0] ?? '0';
    const fracPart = (parts[1] ?? '').padEnd(decimals, '0').slice(0, decimals);
    const tokenAmount =
        BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt(fracPart);

    await transferToken(
        resolved.address,
        toAddress,
        tokenAmount,
        wallet,
        provider,
        network,
    );
}

/**
 * CLI handler
 */
export async function sendCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 4) {
        console.error('Usage: bw send <amount> <token> <from> <to>');
        console.error('  Example: bw send 0.001 btc hot admin');
        console.error('  Example: bw send 100 stable server hot');
        process.exit(1);
    }

    const [amountStr, tokenArg, fromRole, toRole] = args;
    if (!amountStr || !tokenArg || !fromRole || !toRole) {
        console.error('Usage: bw send <amount> <token> <from> <to>');
        process.exit(1);
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        console.error(`Invalid amount: ${amountStr}`);
        process.exit(1);
    }

    console.log(
        `Sending ${amountStr} ${tokenArg} from ${fromRole} to ${toRole}...`,
    );
    await executeSend(
        amountStr,
        tokenArg,
        fromRole,
        toRole,
        book,
        provider,
        contract,
        network,
    );
    console.log('Sent.');
}
