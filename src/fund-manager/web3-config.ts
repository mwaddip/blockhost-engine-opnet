/**
 * Shared web3-defaults.yaml loader.
 *
 * Single source of truth for all blockchain configuration: RPC endpoint,
 * contract addresses, MotoSwap/NativeSwap infrastructure. Every module
 * that needs blockchain config imports from here instead of reading
 * the YAML directly.
 *
 * File location: /etc/blockhost/web3-defaults.yaml
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { networks, type Network } from '@btc-vision/bitcoin';
import { isValidInternalAddress } from './addressbook.js';

const CONFIG_DIR = process.env['BLOCKHOST_CONFIG_DIR'] ?? '/etc/blockhost';
const WEB3_DEFAULTS_PATH = `${CONFIG_DIR}/web3-defaults.yaml`;

/** MotoSwap AMM (OP20-to-OP20 swaps). */
export interface MotoSwapConfig {
    readonly router: string;
    readonly factory: string;
}

/** Full blockchain configuration from web3-defaults.yaml. */
export interface Web3Config {
    readonly rpcUrl: string;
    readonly network: Network;
    readonly nftContract: string;
    readonly subscriptionContract: string;
    readonly paymentToken: string;
    readonly motoswap: MotoSwapConfig | null;
    readonly nativeSwap: string | null;
}

interface RawBlockchain {
    readonly rpc_url?: string;
    readonly network?: string;
    readonly nft_contract?: string;
    readonly subscription_contract?: string;
    readonly payment_token?: string;
}

interface RawMotoswap {
    readonly router?: string;
    readonly factory?: string;
}

interface RawYaml {
    readonly blockchain?: RawBlockchain;
    readonly motoswap?: RawMotoswap;
    readonly native_swap?: string;
}

function isAddress(value: unknown): value is string {
    return typeof value === 'string' && isValidInternalAddress(value);
}

function requireAddress(value: unknown, label: string): string {
    if (!isAddress(value)) {
        throw new Error(
            `${label}: expected 0x + 64 hex chars, got '${String(value)}'`,
        );
    }
    return value;
}

/**
 * OPNet network names. Maps directly to `@btc-vision/bitcoin` Network instances:
 *   testnet → networks.opnetTestnet (https://testnet.opnet.org, opt1 prefix)
 *   mainnet → networks.bitcoin    (https://mainnet.opnet.org, op1 prefix)
 *
 * Note: networks.opnetTestnet is the Signet fork — NOT Bitcoin Testnet4.
 */
type NetworkName = 'testnet' | 'mainnet';

const NETWORK_BY_NAME: Record<NetworkName, Network> = {
    testnet: networks.opnetTestnet,
    mainnet: networks.bitcoin,
};

function isNetworkName(s: unknown): s is NetworkName {
    return s === 'testnet' || s === 'mainnet';
}

/**
 * Resolve the network from web3-defaults.yaml.
 *
 * Prefers explicit `blockchain.network` (testnet|mainnet). Falls back to
 * substring-matching `blockchain.rpc_url` for legacy installs that don't
 * have the field — a URL like `https://mainnet-mirror.example.com/testnet`
 * will misroute under the fallback, so emit a loud warning until the operator
 * sets the explicit field.
 */
function resolveNetwork(rpcUrl: string, explicit: string | undefined): Network {
    if (isNetworkName(explicit)) {
        return NETWORK_BY_NAME[explicit];
    }
    if (explicit !== undefined) {
        console.warn(
            `[web3-config] blockchain.network='${explicit}' is invalid (expected testnet|mainnet). ` +
            `Falling back to RPC URL substring match.`,
        );
    } else {
        console.warn(
            `[web3-config] blockchain.network not set in web3-defaults.yaml. ` +
            `Falling back to RPC URL substring match — add 'network: <testnet|mainnet>' under blockchain to silence and harden.`,
        );
    }
    if (rpcUrl.includes('mainnet')) return networks.bitcoin;
    return networks.opnetTestnet;
}

/**
 * Load and validate the full web3-defaults.yaml config.
 *
 * Throws on missing file or missing required fields.
 * MotoSwap and NativeSwap are optional (null if not configured).
 */
export function loadWeb3Config(): Web3Config {
    if (!fs.existsSync(WEB3_DEFAULTS_PATH)) {
        throw new Error(`Config not found: ${WEB3_DEFAULTS_PATH}`);
    }

    const raw = yaml.load(
        fs.readFileSync(WEB3_DEFAULTS_PATH, 'utf8'),
    ) as RawYaml;

    const bc = raw.blockchain;
    if (!bc) {
        throw new Error('Missing "blockchain" section in web3-defaults.yaml');
    }

    const rpcUrl = bc.rpc_url;
    if (!rpcUrl) {
        throw new Error(
            'blockchain.rpc_url not set in web3-defaults.yaml',
        );
    }

    const nftContract = requireAddress(
        bc.nft_contract,
        'blockchain.nft_contract',
    );
    const subscriptionContract = requireAddress(
        bc.subscription_contract,
        'blockchain.subscription_contract',
    );
    const paymentToken = requireAddress(
        bc.payment_token,
        'blockchain.payment_token',
    );

    let motoswap: MotoSwapConfig | null = null;
    if (raw.motoswap?.router && raw.motoswap.factory) {
        motoswap = {
            router: requireAddress(raw.motoswap.router, 'motoswap.router'),
            factory: requireAddress(raw.motoswap.factory, 'motoswap.factory'),
        };
    }

    let nativeSwap: string | null = null;
    if (raw.native_swap) {
        nativeSwap = requireAddress(raw.native_swap, 'native_swap');
    }

    return {
        rpcUrl,
        network: resolveNetwork(rpcUrl, bc.network),
        nftContract,
        subscriptionContract,
        paymentToken,
        motoswap,
        nativeSwap,
    };
}

/**
 * Load only the RPC URL and network (for lightweight consumers).
 */
export function loadRpcConfig(): { readonly rpcUrl: string; readonly network: Network } {
    if (!fs.existsSync(WEB3_DEFAULTS_PATH)) {
        throw new Error(`Config not found: ${WEB3_DEFAULTS_PATH}`);
    }

    const raw = yaml.load(
        fs.readFileSync(WEB3_DEFAULTS_PATH, 'utf8'),
    ) as RawYaml;

    const rpcUrl = raw.blockchain?.rpc_url;
    if (!rpcUrl) {
        throw new Error(
            'blockchain.rpc_url not set in web3-defaults.yaml',
        );
    }

    return { rpcUrl, network: resolveNetwork(rpcUrl, raw.blockchain?.network) };
}
