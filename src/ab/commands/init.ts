/**
 * ab --init <admin-addr> <server-addr> [dev-addr] [broker-addr] <server-keyfile>
 *
 * Bootstrap the addressbook with initial required entries.
 * dev and broker are optional — the keyfile (last arg, not an address) marks the end.
 * Fails if addressbook already has entries (safety — only for fresh bootstrap).
 *
 * Addresses: 0x internal (32-byte hex) or bech32m P2TR/P2OP — auto-normalized.
 *
 * Arg counts:
 *   3: admin, server, keyfile
 *   4: admin, server, dev, keyfile
 *   5: admin, server, dev, broker, keyfile
 */

import * as fs from 'fs';
import {
    loadAddressbook,
    saveAddressbook,
    normalizeAddress,
} from '../../fund-manager/addressbook.js';
import type { Addressbook } from '../../fund-manager/types.js';

export async function initCommand(args: string[]): Promise<void> {
    if (args.length < 3 || args.length > 5) {
        console.error(
            'Usage: ab --init <admin-addr> <server-addr> [dev-addr] [broker-addr] <server-keyfile>',
        );
        console.error(
            '  dev and broker are optional; keyfile is always last',
        );
        console.error(
            '  addresses: 0x internal or bech32m (P2TR/P2OP)',
        );
        process.exit(1);
    }

    const serverKeyfile = args[args.length - 1];
    const addresses = args.slice(0, -1);

    if (!serverKeyfile) {
        console.error('Error: missing server keyfile argument');
        process.exit(1);
    }

    if (!fs.existsSync(serverKeyfile)) {
        console.error(
            `Error: server keyfile not found: ${serverKeyfile}`,
        );
        process.exit(1);
    }

    const adminAddr = await normalizeAddress(addresses[0] ?? '');
    const serverAddr = await normalizeAddress(addresses[1] ?? '');
    const devAddr = addresses.length >= 3 ? await normalizeAddress(addresses[2]!) : null;
    const brokerAddr = addresses.length >= 4 ? await normalizeAddress(addresses[3]!) : null;

    if (!adminAddr) {
        console.error(
            `Error: invalid admin address: ${addresses[0] ?? '(missing)'}`,
        );
        process.exit(1);
    }
    if (!serverAddr) {
        console.error(
            `Error: invalid server address: ${addresses[1] ?? '(missing)'}`,
        );
        process.exit(1);
    }
    if (addresses.length >= 3 && !devAddr) {
        console.error(`Error: invalid dev address: ${addresses[2]}`);
        process.exit(1);
    }
    if (addresses.length >= 4 && !brokerAddr) {
        console.error(`Error: invalid broker address: ${addresses[3]}`);
        process.exit(1);
    }

    const existing = loadAddressbook();
    if (Object.keys(existing).length > 0) {
        console.error(
            'Error: addressbook already has entries. --init is only for fresh bootstrap.',
        );
        process.exit(1);
    }

    const book: Addressbook = {
        admin: { address: adminAddr },
        server: { address: serverAddr, keyfile: serverKeyfile },
    };

    if (devAddr) {
        book['dev'] = { address: devAddr };
    }

    if (brokerAddr) {
        book['broker'] = { address: brokerAddr };
    }

    await saveAddressbook(book);
    console.log('Addressbook initialized:');
    console.log(`  admin  → ${adminAddr}`);
    console.log(`  server → ${serverAddr} (keyfile: ${serverKeyfile})`);
    if (devAddr) console.log(`  dev    → ${devAddr}`);
    if (brokerAddr) console.log(`  broker → ${brokerAddr}`);
}
