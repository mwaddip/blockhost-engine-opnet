#!/usr/bin/env node
/**
 * bw (blockwallet) CLI — scriptable wallet operations for blockhost
 *
 * Usage:
 *   bw send <amount> <token> <from> <to>
 *   bw balance <role> [token]
 *   bw split <amount> <token> <ratios> <from> <to1> <to2> ...
 *   bw withdraw <to>
 *   bw swap <amount> <from-token> <to-token> <wallet>
 *   bw who <identifier>
 *
 * Debug:
 *   bw --debug --cleanup <address>   Sweep all BTC from signing wallets to <address>
 *
 * Configuration:
 *   All config read from /etc/blockhost/web3-defaults.yaml
 */

import { loadAddressbook } from '../fund-manager/addressbook.js';
import { createProviderAndContract } from './cli-utils.js';
import { sendCommand } from './commands/send.js';
import { balanceCommand } from './commands/balance.js';
import { splitCommand } from './commands/split.js';
import { withdrawCommand } from './commands/withdraw.js';
import { swapCommand } from './commands/swap.js';
import { cleanupCommand } from './commands/cleanup.js';
import { whoCommand } from './commands/who.js';
import { configCommand } from './commands/config.js';
import { planCommand } from './commands/plan.js';
import { setCommand } from './commands/set.js';

function printUsage(): void {
    console.log(
        'bw (blockwallet) — scriptable wallet operations for blockhost',
    );
    console.log('');
    console.log('Usage:');
    console.log(
        '  bw send <amount> <token> <from> <to>      Send tokens',
    );
    console.log(
        '  bw balance <role> [token]                  Show balances',
    );
    console.log(
        '  bw split <amount> <token> <ratios> <from> <to1> <to2> ...',
    );
    console.log(
        '                                             Split tokens',
    );
    console.log(
        '  bw withdraw <to>                           Withdraw from contract',
    );
    console.log(
        '  bw swap <amount> <from-token> <to-token> <wallet>',
    );
    console.log(
        '                                             Swap tokens via MotoSwap',
    );
    console.log(
        '  bw who <identifier>                        Query NFT owner',
    );
    console.log(
        '  bw config stable [address]                 Get/set payment token',
    );
    console.log(
        '  bw plan create <name> <price>              Create subscription plan',
    );
    console.log(
        '  bw set encrypt <nft_id> <data>             Update NFT encrypted data',
    );
    console.log('');
    console.log('Debug:');
    console.log(
        '  bw --debug --cleanup <address>             Sweep BTC to address',
    );
    console.log('');
    console.log('Token shortcuts: btc, stable, or 0x address');
    console.log(
        'Roles: admin, server, hot, dev, broker (from addressbook.json)',
    );
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const flags = new Set(argv.filter((a) => a.startsWith('--')));
    const positional = argv.filter((a) => !a.startsWith('--'));

    if (
        flags.has('--help') ||
        flags.has('-h') ||
        argv.length === 0
    ) {
        printUsage();
        process.exit(0);
    }

    // 'who' reads its own config (web3-defaults.yaml), no addressbook or env vars needed
    if (positional[0] === 'who') {
        await whoCommand(positional.slice(1));
        return;
    }

    const book = loadAddressbook();
    if (Object.keys(book).length === 0) {
        console.error(
            'Error: addressbook is empty or missing. Run the installer wizard first.',
        );
        process.exit(1);
    }

    // --debug --cleanup <address>: sweep testnet BTC back to a single address
    if (flags.has('--cleanup')) {
        if (!flags.has('--debug')) {
            console.error(
                'Error: --cleanup requires --debug flag',
            );
            process.exit(1);
        }
        const { provider, network } = createProviderAndContract();
        await cleanupCommand(positional, book, provider, network);
        return;
    }

    const [command, ...args] = positional;

    if (!command) {
        printUsage();
        process.exit(0);
    }

    const { provider, contract, network } =
        createProviderAndContract();

    try {
        switch (command) {
            case 'send':
                await sendCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'balance':
                await balanceCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'split':
                await splitCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'withdraw':
                await withdrawCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'swap':
                await swapCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'config':
                await configCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'plan':
                await planCommand(
                    args,
                    book,
                    provider,
                    contract,
                    network,
                );
                break;
            case 'set':
                await setCommand(args, book, provider, network);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                printUsage();
                process.exit(1);
        }
    } finally {
        await provider.close();
    }
}

main().catch((err: Error) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
