/**
 * OP20 token utilities: balance queries, transfers, formatting.
 *
 * Replaces ERC20 utilities with OPNet getContract + simulate-then-send pattern.
 */

import {
    getContract,
    JSONRpcProvider,
    type IOP20Contract,
    OP_20_ABI,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import type { Network } from '@btc-vision/bitcoin';
import type { Wallet } from '@btc-vision/transaction';
import type { TokenBalance } from './types.js';

/** Maximum satoshis a single contract interaction may spend on fees. */
export const MAX_SAT_TO_SPEND = 100_000n;

/** OPNet zero address (32 bytes, 0x-prefixed). */
export const ZERO_ADDRESS =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Minimal structural type for a simulation result that can be sent. */
interface Sendable {
    sendTransaction(opts: {
        signer: Wallet['keypair'];
        mldsaSigner: Wallet['mldsaKeypair'];
        refundTo: string;
        maximumAllowedSatToSpend: bigint;
        network: Network;
    }): Promise<unknown>;
}

/**
 * Send a signed transaction from a simulation result.
 * Wraps the repetitive signer/mldsaSigner/refundTo/maxSat/network fields.
 */
export async function sendSigned(
    sim: Sendable,
    wallet: Wallet,
    network: Network,
    maxSat: bigint = MAX_SAT_TO_SPEND,
): Promise<unknown> {
    return sim.sendTransaction({
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        refundTo: wallet.p2tr,
        maximumAllowedSatToSpend: maxSat,
        network,
    });
}

/**
 * Get OP20 token balance for a given address.
 *
 * @param tokenAddress - 0x-prefixed 32-byte contract address
 * @param walletAddress - 0x-prefixed 32-byte owner address
 * @param provider - OPNet JSON-RPC provider
 * @param network - Bitcoin network
 * @returns Token balance with metadata
 */
export async function getTokenBalance(
    tokenAddress: string,
    walletAddress: string,
    provider: JSONRpcProvider,
    network: Network,
): Promise<{ balance: bigint; decimals: number; symbol: string }> {
    const token = getContract<IOP20Contract>(
        tokenAddress,
        OP_20_ABI,
        provider,
        network,
    );

    const ownerAddr = Address.fromString(walletAddress);

    const [balanceResult, metadataResult] = await Promise.all([
        token.balanceOf(ownerAddr),
        token.metadata(),
    ]);

    if ('error' in balanceResult) {
        throw new Error(`balanceOf failed: ${balanceResult.error}`);
    }
    if ('error' in metadataResult) {
        throw new Error(`metadata failed: ${metadataResult.error}`);
    }

    return {
        balance: balanceResult.properties.balance,
        decimals: metadataResult.properties.decimals,
        symbol: metadataResult.properties.symbol,
    };
}

/**
 * Get the payment token balance for a wallet.
 *
 * @param paymentTokenAddress - 0x-prefixed 32-byte OP20 contract address
 * @param walletAddress - 0x-prefixed 32-byte owner address
 * @param provider - OPNet JSON-RPC provider
 * @param network - Bitcoin network
 * @returns TokenBalance with all fields populated
 */
export async function getPaymentTokenBalance(
    paymentTokenAddress: string,
    walletAddress: string,
    provider: JSONRpcProvider,
    network: Network,
): Promise<TokenBalance> {
    const { balance, decimals, symbol } = await getTokenBalance(
        paymentTokenAddress,
        walletAddress,
        provider,
        network,
    );

    return {
        tokenAddress: paymentTokenAddress,
        symbol,
        balance,
        decimals,
    };
}

/**
 * Transfer OP20 tokens from a signing wallet to a recipient.
 * Uses the simulate-then-send pattern.
 *
 * @param tokenAddress - 0x-prefixed 32-byte contract address
 * @param to - Recipient 0x-prefixed 32-byte address
 * @param amount - Amount in base units
 * @param wallet - Signing wallet with keypair and mldsaKeypair
 * @param provider - OPNet JSON-RPC provider
 * @param network - Bitcoin network
 */
export async function transferToken(
    tokenAddress: string,
    to: string,
    amount: bigint,
    wallet: Wallet,
    provider: JSONRpcProvider,
    network: Network,
): Promise<void> {
    const token = getContract<IOP20Contract>(
        tokenAddress,
        OP_20_ABI,
        provider,
        network,
        wallet.address,
    );

    const toAddr = Address.fromString(to);
    const sim = await token.transfer(toAddr, amount);

    if ('error' in sim) {
        throw new Error(`transfer simulation failed: ${sim.error}`);
    }

    await sendSigned(sim, wallet, network);
}

/**
 * Get all token balances for a wallet (payment token from subscription contract).
 *
 * OPNet uses a single payment token, so this returns at most one entry.
 *
 * @param walletAddress - 0x-prefixed 32-byte owner address
 * @param contract - BlockhostSubscriptions contract instance
 * @param provider - OPNet JSON-RPC provider
 * @param network - Bitcoin network
 * @returns Array of token balances (0 or 1 entries)
 */
export async function getAllTokenBalances(
    walletAddress: string,
    contract: { getPaymentToken(): Promise<any> },
    provider: JSONRpcProvider,
    network: Network,
): Promise<TokenBalance[]> {
    const tokenResult = await contract.getPaymentToken();
    if ('error' in tokenResult) return [];

    const tokenAddr = tokenResult.properties.token.toString();
    if (tokenAddr === ZERO_ADDRESS) return [];

    try {
        const bal = await getPaymentTokenBalance(tokenAddr, walletAddress, provider, network);
        return [bal];
    } catch (err) {
        console.error(`[FUND] Error fetching token balance for ${walletAddress}: ${err}`);
        return [];
    }
}

/**
 * Format a token balance for display.
 *
 * @param balance - Raw balance in base units
 * @param decimals - Token decimal places
 * @param symbol - Token symbol
 * @returns Formatted string like "1.50 USDC"
 */
export function formatTokenBalance(
    balance: bigint,
    decimals: number,
    symbol: string,
): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = balance / divisor;
    const frac = balance % divisor;
    const fracStr = frac.toString().padStart(decimals, '0');
    const trimmed = fracStr.replace(/0+$/, '') || '0';
    if (trimmed === '0') {
        return `${whole} ${symbol}`;
    }
    return `${whole}.${trimmed} ${symbol}`;
}

/**
 * Format a raw amount in base units as a decimal string (no symbol).
 *
 * @param value - Raw amount in base units
 * @param decimals - Decimal places
 * @returns Formatted decimal string like "1.50"
 */
export function formatUnits(value: bigint, decimals: number): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = (value % divisor).toString().padStart(decimals, '0');
    const trimmed = frac.replace(/0+$/, '') || '0';
    if (trimmed === '0') {
        return `${whole}`;
    }
    return `${whole}.${trimmed}`;
}

/**
 * Parse a decimal string into base units.
 *
 * @param value - Decimal string like "1.50"
 * @param decimals - Decimal places
 * @returns Amount in base units
 */
export function parseUnits(value: string, decimals: number): bigint {
    const [whole = '0', frac = ''] = value.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
}
