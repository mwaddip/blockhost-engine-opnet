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

/** Maximum satoshis a single contract interaction may spend on fees. */
export const MAX_SAT_TO_SPEND = 100_000n;

/**
 * Poll until a transaction is confirmed in a block.
 *
 * @param provider - OPNet RPC provider
 * @param txHash - Transaction hash to track
 * @param timeoutMs - Max wait time (default 60 minutes)
 * @param pollMs - Poll interval (default 4 seconds)
 * @returns The confirmed transaction object
 * @throws If the transaction is not confirmed within the timeout
 */
export async function waitForConfirmation(
    provider: JSONRpcProvider,
    txHash: string,
    timeoutMs = 60 * 60_000,
    pollMs = 4_000,
): Promise<unknown> {
    let elapsed = 0;
    while (elapsed < timeoutMs) {
        try {
            const tx = await provider.getTransaction(txHash);
            if (tx) return tx;
        } catch {
            // not mined yet
        }
        await new Promise((r) => setTimeout(r, pollMs));
        elapsed += pollMs;
    }
    throw new Error(
        `Transaction ${txHash} not confirmed after ${Math.round(timeoutMs / 1000)}s`,
    );
}

/** OPNet zero address (32 bytes, 0x-prefixed). */
export const ZERO_ADDRESS =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Payment token info, fetched once per fund/gas cycle and reused.
 *
 * Replaces repeated `executeBalance(role, "stable", ...)` calls that each
 * re-fetched `contract.getPaymentToken()` + `token.metadata()`. Step functions
 * receive this and use it together with `getTokenBalanceOnly` for per-wallet
 * balance queries.
 */
export interface PaymentTokenContext {
    /** 0x-prefixed 32-byte payment token contract address. */
    readonly address: string;
    readonly decimals: number;
    readonly symbol: string;
}

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
 * Fetch only the OP20 token metadata (decimals + symbol) — one RPC call.
 * Use this when the caller already knows the wallet doesn't matter (e.g.
 * loading a `PaymentTokenContext` once per cycle).
 */
export async function getTokenMetadata(
    tokenAddress: string,
    provider: JSONRpcProvider,
    network: Network,
): Promise<{ decimals: number; symbol: string }> {
    const token = getContract<IOP20Contract>(
        tokenAddress,
        OP_20_ABI,
        provider,
        network,
    );
    const result = await token.metadata();
    if ('error' in result) {
        throw new Error(`metadata failed: ${result.error}`);
    }
    return {
        decimals: result.properties.decimals,
        symbol: result.properties.symbol,
    };
}

/**
 * Fetch only the OP20 balance (no metadata) — one RPC call.
 * Use this when decimals/symbol are already known via `PaymentTokenContext`.
 */
export async function getTokenBalanceOnly(
    tokenAddress: string,
    walletAddress: string,
    provider: JSONRpcProvider,
    network: Network,
): Promise<bigint> {
    const token = getContract<IOP20Contract>(
        tokenAddress,
        OP_20_ABI,
        provider,
        network,
    );
    const ownerAddr = Address.fromString(walletAddress);
    const result = await token.balanceOf(ownerAddr);
    if ('error' in result) {
        throw new Error(`balanceOf failed: ${result.error}`);
    }
    return result.properties.balance;
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
