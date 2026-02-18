/**
 * MotoSwap DEX configuration for token swaps.
 *
 * On OPNet, MotoSwap is the OP20-to-OP20 AMM. Unlike EVM where Uniswap V2
 * addresses are hardcoded per chain, MotoSwap addresses come from
 * web3-defaults.yaml since OPNet currently runs on regtest/mainnet only.
 *
 * For BTC-to-OP20 swaps, NativeSwap is used (separate mechanism).
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';

const WEB3_DEFAULTS_PATH = '/etc/blockhost/web3-defaults.yaml';

export interface MotoSwapConfig {
    /** MotoSwap Router contract address (0x 32-byte) */
    router: string;
    /** MotoSwap Factory contract address (0x 32-byte) */
    factory: string;
}

/**
 * Load MotoSwap configuration from web3-defaults.yaml.
 *
 * @returns MotoSwap config or null if not configured
 */
export function getMotoSwapConfig(): MotoSwapConfig | null {
    try {
        if (!fs.existsSync(WEB3_DEFAULTS_PATH)) {
            return null;
        }

        const raw = yaml.load(
            fs.readFileSync(WEB3_DEFAULTS_PATH, 'utf8'),
        ) as Record<string, unknown>;

        const motoswap = raw['motoswap'] as
            | Record<string, string>
            | undefined;
        if (!motoswap?.['router'] || !motoswap['factory']) {
            return null;
        }

        return {
            router: motoswap['router'],
            factory: motoswap['factory'],
        };
    } catch (err) {
        console.error(`[SWAP] Error loading MotoSwap config: ${err}`);
        return null;
    }
}
