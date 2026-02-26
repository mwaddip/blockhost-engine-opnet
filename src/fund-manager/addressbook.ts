/**
 * Addressbook loading, saving, and resolution utilities (OPNet).
 *
 * Addresses are stored as 0x-prefixed 32-byte hex strings — the internal
 * format consumed by Address.fromString() for contract calls.
 *
 * Shared between fund-manager and bw CLI.
 */

import * as fs from 'fs';
import { type Network, toHex, fromBech32 } from '@btc-vision/bitcoin';
import { JSONRpcProvider } from 'opnet';
import type { Addressbook } from './types.js';
import { walletFromKeyfile } from './wallet.js';
import { loadRpcConfig } from './web3-config.js';
import {
    addressbookSave,
    generateWallet as rootAgentGenerateWallet,
} from '../root-agent/client.js';
import type { Wallet } from '@btc-vision/transaction';

/** OPNet P2OP bech32 HRPs — witness program is ML-DSA hash, NOT tweaked pubkey. */
const P2OP_PREFIXES = new Set(['op', 'opt', 'opr']);

const CONFIG_DIR = process.env['BLOCKHOST_CONFIG_DIR'] ?? '/etc/blockhost';
const ADDRESSBOOK_PATH = `${CONFIG_DIR}/addressbook.json`;
const HOT_KEY_PATH = `${CONFIG_DIR}/hot.key`;

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
 * Normalize an address to 0x-prefixed 32-byte internal format.
 * Accepts 0x internal addresses, standard P2TR bech32m, and OPNet P2OP addresses.
 *
 * For standard P2TR (bc1p/tb1p/bcrt1p), the witness program IS the
 * x-only tweaked pubkey — extracted directly.
 *
 * For OPNet P2OP (op1p/opt1p/opr1p), the witness program is the
 * ML-DSA key hash, NOT the tweaked pubkey. These must be resolved
 * via RPC to get the actual on-chain identity.
 *
 * @returns The 0x-prefixed internal address, or null if invalid
 */
export async function normalizeAddress(address: string): Promise<string | null> {
    if (isValidInternalAddress(address)) return address;

    try {
        const decoded = fromBech32(address);
        if (decoded.version >= 1 && decoded.data.length === 32) {
            if (P2OP_PREFIXES.has(decoded.prefix)) {
                // P2OP: witness program is ML-DSA hash — resolve via RPC
                const mldsaHash = '0x' + toHex(decoded.data);
                return await resolveViaRpc(mldsaHash);
            }
            // Standard P2TR: witness program is the tweaked pubkey
            return '0x' + toHex(decoded.data);
        }
    } catch {
        // Not a valid bech32/bech32m address
    }

    return null;
}

/**
 * Resolve an ML-DSA hash to the tweaked pubkey (on-chain identity) via RPC.
 *
 * If the RPC returns the same value we sent (address not indexed yet),
 * we reject it — storing the ML-DSA hash as the on-chain identity would
 * cause NFTs and transactions to go to the wrong address.
 */
async function resolveViaRpc(mldsaHash: string): Promise<string | null> {
    let provider: JSONRpcProvider | null = null;
    try {
        const { rpcUrl, network } = loadRpcConfig();
        provider = new JSONRpcProvider({ url: rpcUrl, network });
        const result = await provider.getPublicKeyInfo(mldsaHash, false);
        const resolved = String(result);
        if (!isValidInternalAddress(resolved)) return null;

        // If RPC returned the same value, the address isn't indexed yet
        if (resolved.toLowerCase() === mldsaHash.toLowerCase()) {
            console.error(
                `[addressbook] P2OP address not yet indexed on RPC. ` +
                `The wallet must have at least one on-chain transaction before it can be resolved. ` +
                `Use the 0x internal address directly, or try again after the wallet has transacted.`,
            );
            return null;
        }

        return resolved;
    } catch (err) {
        console.error(`[addressbook] Failed to resolve P2OP address via RPC: ${err}`);
        return null;
    } finally {
        if (provider) await provider.close();
    }
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
 * Accepts a role name (looked up in addressbook), a raw 0x address,
 * or a bech32m P2TR/P2OP address.
 *
 * @param identifier - Role name, 0x address, or bech32m address
 * @param book - The loaded addressbook
 * @returns The resolved 0x-prefixed 32-byte address, or null if invalid
 */
export async function resolveAddress(
    identifier: string,
    book: Addressbook,
): Promise<string | null> {
    // Try normalizing as an address first (0x or bech32m)
    const normalized = await normalizeAddress(identifier);
    if (normalized) return normalized;

    // Fall back to role lookup
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
