/**
 * bw split <amount> <token> <ratios> <from> <to1> <to2> ...
 *
 * Split tokens from a signing wallet to multiple recipients.
 * Ratios are given as "60/40" or "50/30/20" (must sum to 100).
 * Last recipient gets any rounding dust.
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
    formatTokenBalance,
    parseUnits,
} from '../../fund-manager/token-utils.js';
import { resolveToken, formatBtc } from '../cli-utils.js';
import type { IBlockhostSubscriptions } from '../../fund-manager/contract-abis.js';

export async function splitCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 5) {
        console.error(
            'Usage: bw split <amount> <token> <ratios> <from> <to1> <to2> ...',
        );
        console.error(
            '  Example: bw split 0.001 btc 60/40 hot dev broker',
        );
        console.error(
            '  Example: bw split 100 stable 50/50 hot dev admin',
        );
        process.exit(1);
    }

    const [amountStr, tokenArg, ratiosStr, fromRole, ...recipientRoles] =
        args;
    if (!amountStr || !tokenArg || !ratiosStr || !fromRole) {
        console.error(
            'Usage: bw split <amount> <token> <ratios> <from> <to1> <to2> ...',
        );
        process.exit(1);
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        console.error(`Invalid amount: ${amountStr}`);
        process.exit(1);
    }

    const ratios = ratiosStr.split('/').map(Number);
    if (ratios.some(isNaN) || ratios.some((r) => r <= 0)) {
        console.error(
            `Invalid ratios: ${ratiosStr}. Use format like 60/40 or 50/30/20`,
        );
        process.exit(1);
    }

    const ratioSum = ratios.reduce((a, b) => a + b, 0);
    if (ratioSum !== 100) {
        console.error(`Ratios must sum to 100, got ${ratioSum}`);
        process.exit(1);
    }

    if (ratios.length !== recipientRoles.length) {
        console.error(
            `Number of ratios (${ratios.length}) must match number of recipients (${recipientRoles.length})`,
        );
        process.exit(1);
    }

    const wallet = resolveWallet(fromRole, book, network);
    if (!wallet) {
        process.exit(1);
    }

    const recipients: string[] = [];
    for (const role of recipientRoles) {
        const addr = await resolveAddress(role, book);
        if (!addr) {
            process.exit(1);
        }
        recipients.push(addr);
    }

    const resolved = await resolveToken(tokenArg, contract);

    if (resolved.isNative) {
        // Split BTC — parse to sats
        const totalSats = parseUnits(amountStr, 8);
        let remaining = totalSats;

        console.log(
            `Splitting ${formatBtc(totalSats)} from ${fromRole}: ${ratios.map((r, i) => `${r}% to ${recipientRoles[i]}`).join(', ')}`,
        );

        for (let i = 0; i < recipients.length; i++) {
            const ratio = ratios[i];
            const recipient = recipients[i];
            const recipientRole = recipientRoles[i];
            if (ratio === undefined || !recipient || !recipientRole)
                continue;

            const isLast = i === recipients.length - 1;
            const share = isLast
                ? remaining
                : (totalSats * BigInt(ratio)) / 100n;
            remaining -= share;

            // BTC sending would use TransactionFactory — similar to send command
            // For simplicity in split, we use sequential OP20 transfers for tokens
            // BTC splitting requires more complex UTXO management
            console.log(
                `  ${recipientRole}: ${formatBtc(share)} (BTC split requires manual UTXO management)`,
            );
        }

        console.error(
            'Note: BTC splitting is not yet implemented. Use OP20 tokens or send individually.',
        );
        process.exit(1);
    }

    // Split OP20 tokens
    const { decimals, symbol } = await getTokenBalance(
        resolved.address,
        wallet.address.toString(),
        provider,
        network,
    );

    const totalAmount = parseUnits(amountStr, decimals);
    let remaining = totalAmount;

    console.log(
        `Splitting ${formatTokenBalance(totalAmount, decimals, symbol)} from ${fromRole}: ${ratios.map((r, i) => `${r}% to ${recipientRoles[i]}`).join(', ')}`,
    );

    for (let i = 0; i < recipients.length; i++) {
        const ratio = ratios[i];
        const recipient = recipients[i];
        const recipientRole = recipientRoles[i];
        if (ratio === undefined || !recipient || !recipientRole)
            continue;

        const isLast = i === recipients.length - 1;
        const share = isLast
            ? remaining
            : (totalAmount * BigInt(ratio)) / 100n;
        remaining -= share;

        await transferToken(
            resolved.address,
            recipient,
            share,
            wallet,
            provider,
            network,
        );
        console.log(
            `  ${recipientRole}: ${formatTokenBalance(share, decimals, symbol)}`,
        );
    }

    console.log('Done.');
}
