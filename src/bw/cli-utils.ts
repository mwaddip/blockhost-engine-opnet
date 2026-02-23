/**
 * CLI utilities: provider/contract creation, token resolution, output formatting.
 *
 * Replaces ethers-based utilities with OPNet equivalents.
 */

import { getContract, JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import {
    BLOCKHOST_SUBSCRIPTIONS_ABI,
    type IBlockhostSubscriptions,
} from '../fund-manager/contract-abis.js';
import { isValidInternalAddress } from '../fund-manager/addressbook.js';
import { loadWeb3Config } from '../fund-manager/web3-config.js';
import { ZERO_ADDRESS } from '../fund-manager/token-utils.js';

/**
 * Create an OPNet provider and BlockhostSubscriptions contract from
 * web3-defaults.yaml configuration.
 */
export function createProviderAndContract(): {
    provider: JSONRpcProvider;
    contract: IBlockhostSubscriptions;
    network: Network;
} {
    const cfg = loadWeb3Config();
    const provider = new JSONRpcProvider({ url: cfg.rpcUrl, network: cfg.network });
    const contract = getContract<IBlockhostSubscriptions>(
        cfg.subscriptionsContract,
        BLOCKHOST_SUBSCRIPTIONS_ABI,
        provider,
        cfg.network,
    );

    return { provider, contract, network: cfg.network };
}

/**
 * Resolve a token shortcut to an address.
 *
 * @param token - "btc" (native), "stable" (payment token), or 0x address
 * @param contract - BlockhostSubscriptions contract instance
 * @returns Resolved token info
 */
export async function resolveToken(
    token: string,
    contract: IBlockhostSubscriptions,
): Promise<{ address: string; isNative: boolean }> {
    const lower = token.toLowerCase();

    if (lower === 'btc' || lower === 'native') {
        return { address: 'btc', isNative: true };
    }

    if (lower === 'stable' || lower === 'stablecoin' || lower === 'usdc') {
        const result = await contract.getPaymentToken();
        if ('error' in result) {
            throw new Error('Failed to query payment token from contract');
        }
        const tokenAddr = result.properties.token.toString();
        if (tokenAddr === ZERO_ADDRESS) {
            throw new Error('No payment token configured on contract');
        }
        return { address: tokenAddr, isNative: false };
    }

    if (token.startsWith('0x')) {
        if (!isValidInternalAddress(token)) {
            throw new Error(`Invalid token address: ${token}`);
        }
        return { address: token, isNative: false };
    }

    throw new Error(
        `Unknown token: '${token}'. Use 'btc', 'stable', or a 0x address.`,
    );
}

/**
 * Format satoshi amount for display.
 *
 * @param sats - Amount in satoshis
 * @returns Formatted string like "0.00100000 BTC"
 */
export function formatBtc(sats: bigint): string {
    const whole = sats / 100_000_000n;
    const frac = sats % 100_000_000n;
    const fracStr = frac.toString().padStart(8, '0');
    return `${whole}.${fracStr} BTC`;
}
