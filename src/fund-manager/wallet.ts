/**
 * Keyfile loading and OPNet wallet derivation.
 *
 * Keyfiles contain a BIP39 mnemonic phrase (one line, trimmed).
 * The wallet is derived on the fly via ML-DSA level 2 + P2TR index 0.
 */

import * as fs from 'fs';
import { networks, type Network } from '@btc-vision/bitcoin';
import {
    AddressTypes,
    Mnemonic,
    MLDSASecurityLevel,
    type Wallet,
} from '@btc-vision/transaction';

/**
 * Read a mnemonic phrase from a keyfile.
 *
 * @param keyfilePath - Absolute path to the keyfile
 * @returns The mnemonic phrase (trimmed, single line)
 */
export function readKeyfile(keyfilePath: string): string {
    const raw = fs.readFileSync(keyfilePath, 'utf8').trim();
    if (raw.length === 0) {
        throw new Error(`Keyfile is empty: ${keyfilePath}`);
    }
    return raw;
}

/**
 * Derive an OPNet wallet from a mnemonic keyfile.
 *
 * @param keyfilePath - Absolute path to keyfile containing a BIP39 mnemonic
 * @param network - Bitcoin network (regtest, testnet, mainnet)
 * @returns Wallet with keypair, mldsaKeypair, p2tr, address
 */
export function walletFromKeyfile(keyfilePath: string, network: Network): Wallet {
    const phrase = readKeyfile(keyfilePath);
    return walletFromMnemonic(phrase, network);
}

/**
 * Derive an OPNet wallet from a mnemonic phrase.
 *
 * @param phrase - BIP39 mnemonic phrase
 * @param network - Bitcoin network
 * @returns Wallet with keypair, mldsaKeypair, p2tr, address
 */
export function walletFromMnemonic(phrase: string, network: Network): Wallet {
    const mnemonic = new Mnemonic(phrase, '', network, MLDSASecurityLevel.LEVEL2);
    return mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);
}

/**
 * Get the default network from the RPC URL environment variable.
 * Falls back to regtest if not determinable.
 */
export function getNetworkFromEnv(): Network {
    const rpcUrl = process.env.RPC_URL ?? '';
    if (rpcUrl.includes('mainnet')) return networks.bitcoin;
    if (rpcUrl.includes('testnet')) return networks.testnet;
    return networks.regtest;
}
