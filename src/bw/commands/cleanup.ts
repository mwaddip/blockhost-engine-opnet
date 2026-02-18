/**
 * bw --debug --cleanup <address>
 *
 * Testnet utility: sweep all BTC from addressbook wallets (that have keyfiles)
 * back to a single address.
 *
 * On OPNet, this sweeps satoshis from P2TR addresses.
 */

import { JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import { resolveWallet } from '../../fund-manager/addressbook.js';
import { isValidInternalAddress } from '../../fund-manager/addressbook.js';
import { formatBtc } from '../cli-utils.js';

/**
 * Sweep BTC from all signing-capable addressbook wallets to a target address.
 */
export async function cleanupCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    network: Network,
): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: bw --debug --cleanup <address>');
        process.exit(1);
    }

    const target = args[0];
    if (!target || !isValidInternalAddress(target)) {
        console.error(
            `Invalid target address: ${target ?? '(missing)'}`,
        );
        process.exit(1);
    }

    const targetLower = target.toLowerCase();

    const roles: string[] = [];
    for (const [role, entry] of Object.entries(book)) {
        if (!entry.keyfile) continue;
        if (entry.address.toLowerCase() === targetLower) continue;
        roles.push(role);
    }

    if (roles.length === 0) {
        console.log('No signing wallets to sweep.');
        return;
    }

    console.log(
        `Sweeping BTC from ${roles.length} wallet(s) to ${target}...`,
    );
    console.log('');

    let totalSwept = 0n;
    let swept = 0;
    let skipped = 0;

    for (const role of roles) {
        const wallet = resolveWallet(role, book, network);
        if (!wallet) {
            console.log(`  ${role}: skipped (cannot load wallet)`);
            skipped++;
            continue;
        }

        try {
            const balance = await provider.getBalance(
                wallet.p2tr,
                true,
            );
            if (balance === 0n) {
                skipped++;
                continue;
            }

            // Reserve some for fees
            const feeReserve = 10_000n;
            if (balance <= feeReserve) {
                skipped++;
                console.log(
                    `  ${role}: skipped (${formatBtc(balance)}, below fee reserve)`,
                );
                continue;
            }

            const sendAmount = balance - feeReserve;

            // BTC sending would require TransactionFactory
            // For cleanup, we just report what would be swept
            console.log(
                `  ${role}: would sweep ${formatBtc(sendAmount)} (manual UTXO sweep needed)`,
            );
            totalSwept += sendAmount;
            swept++;
        } catch (err) {
            console.error(`  ${role}: failed (${err})`);
        }
    }

    console.log('');
    console.log(
        `Done. Would sweep ${formatBtc(totalSwept)} from ${swept} wallet(s), skipped ${skipped}.`,
    );
    console.log(
        'Note: Automated BTC sweep requires TransactionFactory integration.',
    );
}
