#!/usr/bin/env -S npx tsx
/**
 * bhcrypt — crypto CLI for blockhost-engine-opnet.
 *
 * Subcommand interface backed by src/crypto.ts (native @noble/* crypto).
 *
 * Subcommands:
 *   encrypt-symmetric  --signature <hex> --plaintext <text>
 *   decrypt-symmetric  --signature <hex> --ciphertext <hex>
 *   decrypt            --private-key-file <path> --ciphertext <hex>
 *   generate-keypair
 *   derive-pubkey      --private-key <hex>
 *   key-to-address     --key <hex>
 *   keygen             [--network regtest|testnet|mainnet]
 *   validate-mnemonic  [--network regtest|testnet|mainnet]  (reads MNEMONIC env var)
 */

import { eciesDecrypt, symmetricEncrypt, symmetricDecrypt } from './crypto.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { generateMnemonic, validateMnemonic } from 'bip39';

function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
    const command = args[0] ?? '';
    const flags: Record<string, string> = {};
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg !== undefined && arg.startsWith('--') && i + 1 < args.length) {
            const key = arg.slice(2);
            const val = args[++i];
            if (val !== undefined) flags[key] = val;
        }
    }
    return { command, flags };
}

function die(msg: string): never {
    process.stderr.write(`bhcrypt: ${msg}\n`);
    process.exit(1);
}

function requireFlags(flags: Record<string, string>, ...keys: string[]): void {
    for (const k of keys) {
        if (!flags[k]) die(`missing --${k}`);
    }
}

function requireHex(value: string, label: string): void {
    const clean = value.startsWith('0x') ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length === 0 || clean.length % 2 !== 0) {
        die(`${label}: invalid hex string`);
    }
}

function resolveNetwork(name: string) {
    return name === 'mainnet' ? networks.bitcoin : networks.opnetTestnet;
}

const { command, flags } = parseArgs(process.argv.slice(2));

async function main(): Promise<void> {
    switch (command) {
        case 'encrypt-symmetric': {
            requireFlags(flags, 'signature', 'plaintext');
            requireHex(flags['signature']!, '--signature');
            const result = symmetricEncrypt(flags['signature']!, flags['plaintext']!);
            process.stdout.write(result + '\n');
            break;
        }

        case 'decrypt-symmetric': {
            requireFlags(flags, 'signature', 'ciphertext');
            requireHex(flags['signature']!, '--signature');
            requireHex(flags['ciphertext']!, '--ciphertext');
            const result = symmetricDecrypt(flags['signature']!, flags['ciphertext']!);
            process.stdout.write(result + '\n');
            break;
        }

        case 'decrypt': {
            requireFlags(flags, 'private-key-file', 'ciphertext');
            requireHex(flags['ciphertext']!, '--ciphertext');
            const keyHex = fs.readFileSync(flags['private-key-file']!, 'utf8').trim().replace(/^0x/, '');
            requireHex(keyHex, 'private key file');
            const result = eciesDecrypt(keyHex, flags['ciphertext']!);
            process.stdout.write(result + '\n');
            break;
        }

        case 'generate-keypair': {
            const privBytes = randomBytes(32);
            const privHex = bytesToHex(privBytes);
            const pubBytes = secp256k1.getPublicKey(privBytes, false);
            const pubHex = bytesToHex(pubBytes);
            process.stdout.write(`${privHex}\n`);
            process.stdout.write(`${pubHex}\n`);
            break;
        }

        case 'derive-pubkey': {
            requireFlags(flags, 'private-key');
            const keyHex = flags['private-key']!.replace(/^0x/, '');
            const pubBytes = secp256k1.getPublicKey(
                Uint8Array.from(Buffer.from(keyHex, 'hex')),
                false,
            );
            const pubHex = bytesToHex(pubBytes);
            process.stdout.write(`${pubHex}\n`);
            break;
        }

        case 'key-to-address': {
            requireFlags(flags, 'key');
            // OPNet: address derivation requires ML-DSA, not just secp256k1.
            // For secp256k1-only callers, return the compressed pubkey as a 0x-prefixed identifier.
            // Full OPNet address derivation needs the mnemonic path (Mnemonic → deriveOPWallet).
            const keyHex = flags['key']!.replace(/^0x/, '');
            const pubBytes = secp256k1.getPublicKey(
                Uint8Array.from(Buffer.from(keyHex, 'hex')),
                true,
            );
            process.stdout.write(`0x${bytesToHex(pubBytes)}\n`);
            break;
        }

        case 'keygen': {
            const net = resolveNetwork(flags.network || 'regtest');
            const mnemonic = generateMnemonic();
            const wallet = new Mnemonic(mnemonic, '', net, MLDSASecurityLevel.LEVEL2)
                .deriveOPWallet(AddressTypes.P2TR, 0);
            process.stdout.write(JSON.stringify({ mnemonic, address: wallet.p2tr }) + '\n');
            break;
        }

        case 'validate-mnemonic': {
            const mnemonic = process.env.MNEMONIC;
            if (!mnemonic) die('MNEMONIC environment variable not set');
            if (!validateMnemonic(mnemonic)) die('invalid mnemonic phrase');
            const net = resolveNetwork(flags.network || 'regtest');
            const wallet = new Mnemonic(mnemonic, '', net, MLDSASecurityLevel.LEVEL2)
                .deriveOPWallet(AddressTypes.P2TR, 0);
            process.stdout.write(JSON.stringify({ address: wallet.p2tr }) + '\n');
            break;
        }

        default:
            die(
                `unknown command: ${command || '(none)'}\n` +
                'Usage: bhcrypt <command> [--flags]\n' +
                'Commands: encrypt-symmetric, decrypt-symmetric, decrypt,\n' +
                '          generate-keypair, derive-pubkey, key-to-address,\n' +
                '          keygen, validate-mnemonic',
            );
    }
}

main().catch((err: Error) => die(err.message));
