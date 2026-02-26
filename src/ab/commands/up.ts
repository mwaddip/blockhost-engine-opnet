/**
 * ab up <name> <address> — Update entry's address in addressbook
 *
 * Accepts 0x internal or bech32m (P2TR/P2OP) addresses.
 */

import {
    loadAddressbook,
    saveAddressbook,
    normalizeAddress,
} from '../../fund-manager/addressbook.js';
import { IMMUTABLE_ROLES } from '../index.js';

export async function upCommand(args: string[]): Promise<void> {
    if (args.length !== 2) {
        console.error('Usage: ab up <name> <address>');
        process.exit(1);
    }

    const [name, rawAddress] = args;
    if (!name || !rawAddress) {
        console.error('Usage: ab up <name> <address>');
        process.exit(1);
    }

    if (IMMUTABLE_ROLES.has(name)) {
        console.error(
            `Error: '${name}' is a reserved system role and cannot be modified.`,
        );
        process.exit(1);
    }

    const address = normalizeAddress(rawAddress);
    if (!address) {
        console.error(
            `Error: '${rawAddress}' is not a valid OPNet address (expected 0x+64hex or bech32m).`,
        );
        process.exit(1);
    }

    const book = loadAddressbook();

    if (!book[name]) {
        console.error(
            `Error: '${name}' not found in addressbook. Use 'ab add ${name} <address>' to create.`,
        );
        process.exit(1);
    }

    const entry = book[name];
    if (entry) {
        entry.address = address;
    }
    await saveAddressbook(book);
    console.log(`Updated '${name}' → ${address}`);
}
