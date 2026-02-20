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
 *   keygen             [--network regtest|testnet|mainnet]
 *   validate-mnemonic  [--network regtest|testnet|mainnet]  (reads MNEMONIC env var)
 *   build-funding-psbt --from <addr> --to <addr> --amount <sats> --pubkey <hex>
 *                      --rpc-url <url> [--fee-rate <n>] [--network regtest|testnet|mainnet]
 */

import { eciesDecrypt, symmetricEncrypt, symmetricDecrypt } from './crypto.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import { Psbt, networks, address as btcAddress, fromHex } from '@btc-vision/bitcoin';
import { generateMnemonic, validateMnemonic } from 'bip39';

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

function requireFlags(flags: Record<string, string>, ...keys: string[]): void {
    for (const k of keys) {
        if (!flags[k]) die(`missing --${k}`);
    }
}

function resolveNetwork(name: string) {
    return name === 'mainnet' ? networks.bitcoin :
           name === 'testnet' ? networks.testnet : networks.regtest;
}

const { command, flags } = parseArgs(process.argv.slice(2));

async function main(): Promise<void> {
    switch (command) {
        case 'encrypt-symmetric': {
            requireFlags(flags, 'signature', 'plaintext');
            const result = symmetricEncrypt(flags.signature, flags.plaintext);
            process.stdout.write(result + '\n');
            break;
        }

        case 'decrypt-symmetric': {
            requireFlags(flags, 'signature', 'ciphertext');
            const result = symmetricDecrypt(flags.signature, flags.ciphertext);
            process.stdout.write(result + '\n');
            break;
        }

        case 'decrypt': {
            requireFlags(flags, 'private-key-file', 'ciphertext');
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
            requireFlags(flags, 'private-key');
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
            requireFlags(flags, 'key');
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

        case 'build-funding-psbt': {
            requireFlags(flags, 'from', 'to', 'amount', 'rpc-url');
            const net = resolveNetwork(flags.network || 'regtest');
            const from = flags.from;
            const to = flags.to;
            const amount = BigInt(flags.amount);
            const feeRate = parseFloat(flags['fee-rate'] || '10');
            const rpcUrl = flags['rpc-url'];

            // Fetch UTXOs via opnet provider
            const { JSONRpcProvider } = await import('opnet');
            const provider = new JSONRpcProvider(rpcUrl, net);

            const utxos = await provider.utxoManager.getUTXOsForAmount({
                address: from,
                amount: amount + 10000n,
                mergePendingUTXOs: true,
                filterSpentUTXOs: true,
                throwErrors: true,
            });

            // Build unsigned PSBT — no tapInternalKey; the wallet knows its own keys
            const psbt = new Psbt({ network: net });
            let totalInput = 0n;
            const toSignInputs: { index: number; address: string; disableTweakSigner: boolean }[] = [];

            for (let i = 0; i < utxos.length; i++) {
                const utxo = utxos[i]!;
                const scriptBuf = fromHex(utxo.scriptPubKey.hex);
                psbt.addInput({
                    hash: utxo.transactionId,
                    index: utxo.outputIndex,
                    witnessUtxo: { script: scriptBuf, value: utxo.value },
                });
                totalInput += utxo.value;
                toSignInputs.push({ index: i, address: from, disableTweakSigner: false });
            }

            // Estimate vsize: P2TR input ~58 vB, P2TR output ~43 vB, overhead ~11 vB
            const outputCount = 2; // recipient + change (conservative)
            const estimatedVsize = utxos.length * 58 + outputCount * 43 + 11;
            const fee = BigInt(Math.ceil(estimatedVsize * feeRate));

            if (totalInput < amount + fee) {
                die(`insufficient funds: have ${totalInput} sats, need ${amount + fee} (amount + fee)`);
            }

            // Recipient output
            psbt.addOutput({ address: to, value: amount });

            // Change output (skip if below dust threshold)
            const change = totalInput - amount - fee;
            if (change > 330n) {
                psbt.addOutput({ address: from, value: change });
            }

            process.stdout.write(JSON.stringify({
                psbt: psbt.toHex(),
                toSignInputs,
                fee: fee.toString(),
            }) + '\n');

            await provider.close();
            break;
        }

        default:
            die(
                `unknown command: ${command || '(none)'}\n` +
                'Usage: nft_tool <command> [--flags]\n' +
                'Commands: encrypt-symmetric, decrypt-symmetric, decrypt,\n' +
                '          generate-keypair, derive-pubkey, key-to-address,\n' +
                '          keygen, validate-mnemonic, build-funding-psbt',
            );
    }
}

main().catch((err: Error) => die(err.message));
