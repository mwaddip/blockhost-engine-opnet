/**
 * MotoSwap DEX configuration for token swaps.
 *
 * On OPNet, MotoSwap is the OP20-to-OP20 AMM. Unlike EVM where Uniswap V2
 * addresses are hardcoded per chain, MotoSwap addresses come from
 * web3-defaults.yaml since OPNet currently runs on regtest/mainnet only.
 *
 * For BTC-to-OP20 swaps, NativeSwap is used (separate mechanism).
 */

import { loadWeb3Config, type MotoSwapConfig } from './web3-config.js';

export type { MotoSwapConfig };

/**
 * Load MotoSwap configuration from web3-defaults.yaml.
 *
 * @returns MotoSwap config or null if not configured
 */
export function getMotoSwapConfig(): MotoSwapConfig | null {
    try {
        return loadWeb3Config().motoswap;
    } catch (err) {
        console.error(`[SWAP] Error loading MotoSwap config: ${err}`);
        return null;
    }
}
