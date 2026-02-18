#!/usr/bin/env node
/**
 * is (identity predicate) CLI — yes/no identity questions via exit code
 *
 * Usage:
 *   is <wallet> <nft_id>         Does wallet own NFT token?
 *   is contract <address>        Does a contract exist at address?
 *
 * Exit: 0 = yes, 1 = no
 *
 * Arguments are order-independent, disambiguated by type:
 *   Address: 0x + 64 hex chars (OPNet 32-byte internal address)
 *   NFT ID: integer
 *   "contract": literal keyword
 *
 * Config from web3-defaults.yaml (rpc_url, nft_contract). No env vars or addressbook.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { getContract, JSONRpcProvider } from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';
import {
    ACCESS_CREDENTIAL_NFT_ABI,
    type IAccessCredentialNFT,
} from '../fund-manager/contract-abis.js';
import { isValidInternalAddress } from '../fund-manager/addressbook.js';

const WEB3_DEFAULTS_PATH = '/etc/blockhost/web3-defaults.yaml';

interface Web3Config {
    nftContract: string;
    rpcUrl: string;
    network: Network;
}

function loadWeb3Config(): Web3Config {
    if (!fs.existsSync(WEB3_DEFAULTS_PATH)) {
        throw new Error(`Config not found: ${WEB3_DEFAULTS_PATH}`);
    }

    const raw = yaml.load(
        fs.readFileSync(WEB3_DEFAULTS_PATH, 'utf8'),
    ) as Record<string, unknown>;
    const blockchain = raw['blockchain'] as
        | Record<string, unknown>
        | undefined;

    const nftContract = blockchain?.['nft_contract'] as string | undefined;
    if (!nftContract || !isValidInternalAddress(nftContract)) {
        throw new Error(
            'blockchain.nft_contract not set or invalid in web3-defaults.yaml',
        );
    }

    const rpcUrl = blockchain?.['rpc_url'] as string | undefined;
    if (!rpcUrl) {
        throw new Error(
            'blockchain.rpc_url not set in web3-defaults.yaml',
        );
    }

    const network = inferNetwork(rpcUrl);
    return { nftContract, rpcUrl, network };
}

function loadRpcUrl(): { rpcUrl: string; network: Network } {
    if (!fs.existsSync(WEB3_DEFAULTS_PATH)) {
        throw new Error(`Config not found: ${WEB3_DEFAULTS_PATH}`);
    }

    const raw = yaml.load(
        fs.readFileSync(WEB3_DEFAULTS_PATH, 'utf8'),
    ) as Record<string, unknown>;
    const blockchain = raw['blockchain'] as
        | Record<string, unknown>
        | undefined;

    const rpcUrl = blockchain?.['rpc_url'] as string | undefined;
    if (!rpcUrl) {
        throw new Error(
            'blockchain.rpc_url not set in web3-defaults.yaml',
        );
    }

    return { rpcUrl, network: inferNetwork(rpcUrl) };
}

function inferNetwork(rpcUrl: string): Network {
    if (rpcUrl.includes('mainnet')) return networks.bitcoin;
    if (rpcUrl.includes('testnet')) return networks.testnet;
    return networks.regtest;
}

function isAddress(arg: string): boolean {
    return isValidInternalAddress(arg);
}

function isNftId(arg: string): boolean {
    return /^\d+$/.test(arg);
}

function printUsage(): void {
    console.error('is — identity predicate (exit 0 = yes, 1 = no)');
    console.error('');
    console.error('Usage:');
    console.error(
        '  is <wallet> <nft_id>       Does wallet own NFT token?',
    );
    console.error(
        '  is contract <address>      Does a contract exist at address?',
    );
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);

    if (
        argv.length === 0 ||
        argv.includes('--help') ||
        argv.includes('-h')
    ) {
        printUsage();
        process.exit(argv.length === 0 ? 1 : 0);
    }

    // Form: is contract <address>
    if (argv.includes('contract')) {
        const other = argv.filter((a) => a !== 'contract');
        if (other.length !== 1 || !other[0] || !isAddress(other[0])) {
            console.error('Usage: is contract <address>');
            process.exit(1);
        }
        const { rpcUrl, network } = loadRpcUrl();
        const provider = new JSONRpcProvider(rpcUrl, network);
        try {
            const info = await provider.getPublicKeyInfo(other[0], true);
            await provider.close();
            process.exit(info ? 0 : 1);
        } catch {
            await provider.close();
            process.exit(1);
        }
    }

    if (argv.length !== 2) {
        printUsage();
        process.exit(1);
    }

    const [arg1, arg2] = argv;
    if (!arg1 || !arg2) {
        printUsage();
        process.exit(1);
    }

    // Form: is <wallet> <nft_id>  (order-independent)
    let walletAddr: string | null = null;
    let nftId: string | null = null;
    if (isAddress(arg1) && isNftId(arg2)) {
        walletAddr = arg1;
        nftId = arg2;
    } else if (isAddress(arg2) && isNftId(arg1)) {
        walletAddr = arg2;
        nftId = arg1;
    }

    if (walletAddr && nftId) {
        const { nftContract, rpcUrl, network } = loadWeb3Config();
        const provider = new JSONRpcProvider(rpcUrl, network);
        const contract = getContract<IAccessCredentialNFT>(
            nftContract,
            ACCESS_CREDENTIAL_NFT_ABI,
            provider,
            network,
        );

        try {
            const result = await contract.ownerOf(BigInt(nftId));
            await provider.close();

            if ('error' in result) {
                process.exit(1);
            }

            const owner = result.properties.owner.toString().toLowerCase();
            process.exit(owner === walletAddr.toLowerCase() ? 0 : 1);
        } catch {
            await provider.close();
            process.exit(1);
        }
    }

    console.error("Error: could not parse arguments. See 'is --help'.");
    process.exit(1);
}

main().catch((err: Error) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
