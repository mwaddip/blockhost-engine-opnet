/**
 * bhcrypt — crypto CLI for blockhost-engine-opnet.
 *
 * Thin CLI wrapper around src/crypto.ts (native @noble/* crypto).
 * All output is raw values to stdout. Errors go to stderr. Exit 0/1.
 *
 * Subcommands:
 *   decrypt            --private-key-file <path> --ciphertext <hex>
 *   encrypt-symmetric  --signature <hex> --plaintext <text>
 *   decrypt-symmetric  --signature <hex> --ciphertext <hex>
 *   generate-keypair   [--show-pubkey]
 *   derive-pubkey      --private-key <hex>
 */

import { eciesDecrypt, symmetricEncrypt, symmetricDecrypt } from '../crypto.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';

function die(msg: string): never {
    process.stderr.write(`bhcrypt: ${msg}\n`);
    process.exit(1);
}

function getFlag(args: string[], name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
    return args.includes(`--${name}`);
}

const args = process.argv.slice(2);
const command = args[0] ?? '';

async function main(): Promise<void> {
    switch (command) {
        case 'decrypt': {
            const keyFile = getFlag(args, 'private-key-file');
            const ciphertext = getFlag(args, 'ciphertext');
            if (!keyFile) die('missing --private-key-file');
            if (!ciphertext) die('missing --ciphertext');

            const keyHex = fs.readFileSync(keyFile, 'utf8').trim().replace(/^0x/, '');
            const plaintext = eciesDecrypt(keyHex, ciphertext);
            process.stdout.write(plaintext);
            break;
        }

        case 'encrypt-symmetric': {
            const signature = getFlag(args, 'signature');
            const plaintext = getFlag(args, 'plaintext');
            if (!signature) die('missing --signature');
            if (!plaintext) die('missing --plaintext');

            const result = symmetricEncrypt(signature, plaintext);
            process.stdout.write(result);
            break;
        }

        case 'decrypt-symmetric': {
            const signature = getFlag(args, 'signature');
            const ciphertext = getFlag(args, 'ciphertext');
            if (!signature) die('missing --signature');
            if (!ciphertext) die('missing --ciphertext');

            const plaintext = symmetricDecrypt(signature, ciphertext);
            process.stdout.write(plaintext);
            break;
        }

        case 'generate-keypair': {
            const privBytes = randomBytes(32);
            const privHex = bytesToHex(privBytes);
            process.stdout.write(privHex);
            if (hasFlag(args, 'show-pubkey')) {
                const pubBytes = secp256k1.getPublicKey(privBytes, false);
                const pubHex = bytesToHex(pubBytes);
                process.stdout.write('\n' + pubHex);
            }
            break;
        }

        case 'derive-pubkey': {
            const keyHex = getFlag(args, 'private-key');
            if (!keyHex) die('missing --private-key');

            const cleaned = keyHex.replace(/^0x/, '');
            const pubBytes = secp256k1.getPublicKey(
                Uint8Array.from(Buffer.from(cleaned, 'hex')),
                false,
            );
            process.stdout.write(bytesToHex(pubBytes));
            break;
        }

        default:
            die(
                `unknown command: ${command || '(none)'}\n` +
                'Usage: bhcrypt <command> [--flags]\n' +
                'Commands: decrypt, encrypt-symmetric, decrypt-symmetric,\n' +
                '          generate-keypair, derive-pubkey',
            );
    }
}

main().catch((err: Error) => die(err.message));
