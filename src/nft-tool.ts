#!/usr/bin/env -S npx tsx
/**
 * nft_tool — crypto CLI for blockhost-engine-opnet.
 *
 * Drop-in replacement for the EVM nft_tool (formerly pam_web3_tool).
 * Same subcommand interface, backed by src/crypto.ts (native @noble/* crypto).
 *
 * Subcommands:
 *   encrypt-symmetric  --signature <hex> --plaintext <text>
 *   decrypt-symmetric  --signature <hex> --ciphertext <hex>
 *   decrypt            --private-key-file <path> --ciphertext <hex>
 *   generate-keypair
 *   derive-pubkey      --private-key <hex>
 *   key-to-address     --key <hex>
 */

import { eciesDecrypt, symmetricEncrypt, symmetricDecrypt } from './crypto.js';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';

function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
    const command = args[0] || '';
    const flags: Record<string, string> = {};
    for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--') && i + 1 < args.length) {
            const key = args[i].slice(2);
            flags[key] = args[++i];
        }
    }
    return { command, flags };
}

function die(msg: string): never {
    process.stderr.write(`nft_tool: ${msg}\n`);
    process.exit(1);
}

function require(flags: Record<string, string>, ...keys: string[]): void {
    for (const k of keys) {
        if (!flags[k]) die(`missing --${k}`);
    }
}

const { command, flags } = parseArgs(process.argv.slice(2));

switch (command) {
    case 'encrypt-symmetric': {
        require(flags, 'signature', 'plaintext');
        const result = symmetricEncrypt(flags.signature, flags.plaintext);
        process.stdout.write(result + '\n');
        break;
    }

    case 'decrypt-symmetric': {
        require(flags, 'signature', 'ciphertext');
        const result = symmetricDecrypt(flags.signature, flags.ciphertext);
        process.stdout.write(result + '\n');
        break;
    }

    case 'decrypt': {
        require(flags, 'private-key-file', 'ciphertext');
        const keyHex = fs.readFileSync(flags['private-key-file'], 'utf8').trim().replace(/^0x/, '');
        const result = eciesDecrypt(keyHex, flags.ciphertext);
        process.stdout.write(result + '\n');
        break;
    }

    case 'generate-keypair': {
        const privBytes = randomBytes(32);
        const privHex = bytesToHex(privBytes);
        const pubBytes = secp256k1.getPublicKey(privBytes, false);
        const pubHex = bytesToHex(pubBytes);
        process.stdout.write(`Private key (hex): ${privHex}\n`);
        process.stdout.write(`Public key (hex): ${pubHex}\n`);
        break;
    }

    case 'derive-pubkey': {
        require(flags, 'private-key');
        const keyHex = flags['private-key'].replace(/^0x/, '');
        const pubBytes = secp256k1.getPublicKey(
            Uint8Array.from(Buffer.from(keyHex, 'hex')),
            false,
        );
        const pubHex = bytesToHex(pubBytes);
        process.stdout.write(`Public key (hex): ${pubHex}\n`);
        break;
    }

    case 'key-to-address': {
        require(flags, 'key');
        // OPNet: address derivation requires ML-DSA, not just secp256k1.
        // For secp256k1-only callers, return the compressed pubkey as a 0x-prefixed identifier.
        // Full OPNet address derivation needs the mnemonic path (Mnemonic → deriveOPWallet).
        const keyHex = flags.key.replace(/^0x/, '');
        const pubBytes = secp256k1.getPublicKey(
            Uint8Array.from(Buffer.from(keyHex, 'hex')),
            true,
        );
        process.stdout.write(`0x${bytesToHex(pubBytes)}\n`);
        break;
    }

    default:
        die(
            `unknown command: ${command || '(none)'}\n` +
            'Usage: nft_tool <command> [--flags]\n' +
            'Commands: encrypt-symmetric, decrypt-symmetric, decrypt,\n' +
            '          generate-keypair, derive-pubkey, key-to-address',
        );
}
