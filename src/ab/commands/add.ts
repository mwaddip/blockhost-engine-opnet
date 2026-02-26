/**
 * ab add <name> <address> — Add new entry to addressbook
 *
 * Accepts 0x internal or bech32m (P2TR/P2OP) addresses.
 */

import {
    loadAddressbook,
    saveAddressbook,
    normalizeAddress,
} from '../../fund-manager/addressbook.js';
import { IMMUTABLE_ROLES } from '../index.js';

export async function addCommand(args: string[]): Promise<void> {
    if (args.length !== 2) {
        console.error('Usage: ab add <name> <address>');
        process.exit(1);
    }

    const [name, rawAddress] = args;
    if (!name || !rawAddress) {
        console.error('Usage: ab add <name> <address>');
        process.exit(1);
    }

    if (!/^[a-zA-Z0-9_]{1,32}$/.test(name)) {
        console.error(
            `Error: role name must be 1-32 alphanumeric/underscore characters.`,
        );
        process.exit(1);
    }

    if (IMMUTABLE_ROLES.has(name)) {
        console.error(
            `Error: '${name}' is a reserved system role and cannot be modified.`,
        );
        process.exit(1);
    }

    const address = await normalizeAddress(rawAddress);
    if (!address) {
        console.error(
            `Error: '${rawAddress}' is not a valid OPNet address (expected 0x+64hex or bech32m).`,
        );
        process.exit(1);
    }

    const book = loadAddressbook();

    if (book[name]) {
        console.error(
            `Error: '${name}' already exists. Use 'ab up ${name} <address>' to update.`,
        );
        process.exit(1);
    }

    book[name] = { address };
    await saveAddressbook(book);
    console.log(`Added '${name}' → ${address}`);
}
