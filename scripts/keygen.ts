#!/usr/bin/env node
/**
 * Generate a BIP39 mnemonic and derive the OPNet wallet address.
 *
 * Prints JSON to stdout: { "mnemonic": "...", "address": "0x...", "p2tr": "opt1p..." }
 *
 * Called by the root agent's generate-wallet action.
 */

import {
    AddressTypes,
    Mnemonic,
    MLDSASecurityLevel,
} from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const networkName = process.argv[2] ?? 'testnet';
const network = networkName === 'mainnet' ? networks.bitcoin : networks.opnetTestnet;

const mnemonic = Mnemonic.generate(
    128,
    '',
    network,
    MLDSASecurityLevel.LEVEL2,
);

const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

console.log(JSON.stringify({
    mnemonic: mnemonic.phrase,
    address: wallet.address.toHex(),
    p2tr: wallet.p2tr,
}));
