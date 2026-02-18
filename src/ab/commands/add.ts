/**
 * ab add <name> <address> — Add new entry to addressbook
 *
 * Accepts a 0x-prefixed 32-byte internal address.
 */

import {
    loadAddressbook,
    saveAddressbook,
    isValidInternalAddress,
} from '../../fund-manager/addressbook.js';
import { IMMUTABLE_ROLES } from '../index.js';

export async function addCommand(args: string[]): Promise<void> {
    if (args.length !== 2) {
        console.error('Usage: ab add <name> <0x-address>');
        process.exit(1);
    }

    const [name, address] = args;
    if (!name || !address) {
        console.error('Usage: ab add <name> <0x-address>');
        process.exit(1);
    }

    if (IMMUTABLE_ROLES.has(name)) {
        console.error(
            `Error: '${name}' is a reserved system role and cannot be modified.`,
        );
        process.exit(1);
    }

    if (!isValidInternalAddress(address)) {
        console.error(
            `Error: '${address}' is not a valid OPNet address (expected 0x + 64 hex chars).`,
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
