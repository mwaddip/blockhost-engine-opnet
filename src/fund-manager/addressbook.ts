/**
 * Addressbook loading, saving, and resolution utilities (OPNet).
 *
 * Addresses are stored as 0x-prefixed 32-byte hex strings — the internal
 * format consumed by Address.fromString() for contract calls.
 *
 * Shared between fund-manager and bw CLI.
 */

import * as fs from 'fs';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from './types.js';
import { walletFromKeyfile } from './wallet.js';
import {
    addressbookSave,
    generateWallet as rootAgentGenerateWallet,
} from '../root-agent/client.js';
import type { Wallet } from '@btc-vision/transaction';

const ADDRESSBOOK_PATH = '/etc/blockhost/addressbook.json';
const HOT_KEY_PATH = '/etc/blockhost/hot.key';

/**
 * Validate a 0x-prefixed 32-byte (64 hex char) internal address.
 *
 * @param address - The address string to validate
 * @returns True if valid internal address format
 */
export function isValidInternalAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(address);
}

/**
 * Load addressbook from /etc/blockhost/addressbook.json.
 * Validates all entries have valid internal addresses.
 */
export function loadAddressbook(): Addressbook {
    try {
        if (!fs.existsSync(ADDRESSBOOK_PATH)) {
            console.error(`[FUND] Addressbook not found: ${ADDRESSBOOK_PATH}`);
            return {};
        }

        const data = fs.readFileSync(ADDRESSBOOK_PATH, 'utf8');
        const book = JSON.parse(data) as Addressbook;

        for (const [role, entry] of Object.entries(book)) {
            if (!isValidInternalAddress(entry.address)) {
                console.error(
                    `[FUND] Invalid address for role '${role}': ${entry.address}`,
                );
                delete book[role];
            }
        }

        return book;
    } catch (err) {
        console.error(`[FUND] Error loading addressbook: ${err}`);
        return {};
    }
}

/**
 * Save addressbook via root agent.
 */
export async function saveAddressbook(book: Addressbook): Promise<void> {
    try {
        await addressbookSave(book);
    } catch (err) {
        console.error(`[FUND] Error saving addressbook: ${err}`);
    }
}

/**
 * Resolve an identifier to an internal address.
 * Accepts a role name (looked up in addressbook) or a raw 0x 32-byte address.
 *
 * @param identifier - Role name or 0x-prefixed 32-byte hex address
 * @param book - The loaded addressbook
 * @returns The resolved 0x-prefixed 32-byte address, or null if invalid
 */
export function resolveAddress(
    identifier: string,
    book: Addressbook,
): string | null {
    if (identifier.startsWith('0x')) {
        if (!isValidInternalAddress(identifier)) {
            console.error(`Invalid address: ${identifier}`);
            return null;
        }
        return identifier;
    }

    const entry = book[identifier];
    if (!entry) {
        console.error(`Role '${identifier}' not found in addressbook`);
        return null;
    }
    return entry.address;
}

/**
 * Resolve a role name to a signing wallet (requires keyfile).
 *
 * @param identifier - Role name in addressbook
 * @param book - The loaded addressbook
 * @param network - Bitcoin network for wallet derivation
 * @returns Derived wallet keys, or null if role has no keyfile
 */
export function resolveWallet(
    identifier: string,
    book: Addressbook,
    network: Network,
): Wallet | null {
    const entry = book[identifier];
    if (!entry) {
        console.error(`Role '${identifier}' not found in addressbook`);
        return null;
    }

    if (!entry.keyfile) {
        console.error(
            `Role '${identifier}' has no keyfile — cannot sign transactions`,
        );
        return null;
    }

    if (!fs.existsSync(entry.keyfile)) {
        console.error(
            `Keyfile not found for '${identifier}': ${entry.keyfile}`,
        );
        return null;
    }

    return walletFromKeyfile(entry.keyfile, network);
}

/**
 * Ensure the hot wallet exists in the addressbook.
 * Generates one via root agent if missing.
 */
export async function ensureHotWallet(
    book: Addressbook,
): Promise<Addressbook> {
    if (book['hot']) {
        return book;
    }

    console.log('[FUND] Generating hot wallet via root agent...');
    const { address } = await rootAgentGenerateWallet('hot');

    book['hot'] = {
        address,
        keyfile: HOT_KEY_PATH,
    };

    await saveAddressbook(book);
    console.log(`[FUND] Generated hot wallet: ${address}`);
    return book;
}
