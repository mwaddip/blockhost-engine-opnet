/**
 * bw swap <amount> <from-token> <to-token> <wallet>
 *
 * Swap tokens. Routing is automatic:
 *
 *   BTC  → OP20:  NativeSwap (two-phase commit: reserve → wait block → execute)
 *   OP20 → BTC:   NativeSwap listLiquidity (async — lists tokens for sale)
 *   OP20 → OP20:  MotoSwap Router (single transaction)
 *
 * Examples:
 *   bw swap 0.001 btc stable server       — buy stablecoin with BTC
 *   bw swap 100 stable btc server          — sell stablecoin for BTC
 *   bw swap 50 tokenA stable server        — swap OP20 for OP20
 */

import {
    getContract,
    JSONRpcProvider,
    type IMotoswapRouterContract,
    MOTOSWAP_ROUTER_ABI,
    type INativeSwapContract,
    NativeSwapAbi,
    type IOP20Contract,
    OP_20_ABI,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import { address as btcAddress, type Network } from '@btc-vision/bitcoin';
import type { Wallet } from '@btc-vision/transaction';
import type { Addressbook } from '../../fund-manager/types.js';
import type { IBlockhostSubscriptions } from '../../fund-manager/contract-abis.js';
import { resolveWallet } from '../../fund-manager/addressbook.js';
import { resolveToken } from '../cli-utils.js';
import {
    getTokenBalance,
    formatTokenBalance,
    sendSigned,
    MAX_SAT_TO_SPEND,
    parseUnits,
} from '../../fund-manager/token-utils.js';
import { loadWeb3Config } from '../../fund-manager/web3-config.js';

/** 1% slippage tolerance */
const SLIPPAGE_BPS = 100n;
const BPS_BASE = 10_000n;

/** Block polling interval (ms) */
const BLOCK_POLL_MS = 3_000;
/** Max wait for next block (10 minutes) */
const BLOCK_WAIT_TIMEOUT_MS = 600_000;

// ─── Helpers ───────────────────────────────────────────────────────

function isBtc(token: string): boolean {
    const t = token.toLowerCase();
    return t === 'btc' || t === 'native';
}

function parseSats(amountStr: string): bigint {
    return parseUnits(amountStr, 8);
}

function formatSats(sats: bigint): string {
    const whole = sats / 100_000_000n;
    const frac = (sats % 100_000_000n).toString().padStart(8, '0');
    const trimmed = frac.replace(/0+$/, '') || '0';
    return trimmed === '0' ? `${whole} BTC` : `${whole}.${trimmed} BTC`;
}

function applySlippage(amount: bigint): bigint {
    return (amount * (BPS_BASE - SLIPPAGE_BPS)) / BPS_BASE;
}

async function waitForNextBlock(
    provider: JSONRpcProvider,
    currentBlock: bigint,
): Promise<bigint> {
    const start = Date.now();
    while (Date.now() - start < BLOCK_WAIT_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, BLOCK_POLL_MS));
        const latest = BigInt(await provider.getBlockNumber());
        if (latest > currentBlock) return latest;
    }
    throw new Error('Timed out waiting for next block (10 min)');
}

/**
 * Ensure the spender has sufficient OP20 allowance from the wallet.
 * Uses increaseAllowance (OPNet standard, NOT approve).
 */
async function ensureAllowance(
    tokenAddress: string,
    spenderAddress: string,
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

    const spenderAddr = Address.fromString(spenderAddress);
    const allowanceResult = await token.allowance(wallet.address, spenderAddr);
    if ('error' in allowanceResult) {
        throw new Error(`allowance query failed: ${allowanceResult.error}`);
    }

    const current = allowanceResult.properties.remaining;
    if (current >= amount) return;

    const increase = amount - current;
    console.log(`  Increasing allowance by ${increase}...`);
    const sim = await token.increaseAllowance(spenderAddr, increase);
    if ('error' in sim) {
        throw new Error(`increaseAllowance failed: ${sim.error}`);
    }

    await sendSigned(sim, wallet, network);
    console.log('  Allowance set.');
}

// ─── MotoSwap (OP20 ↔ OP20) ──────────────────────────────────────

async function executeMotoSwap(
    amountStr: string,
    fromTokenAddr: string,
    toTokenAddr: string,
    wallet: Wallet,
    provider: JSONRpcProvider,
    network: Network,
): Promise<void> {
    const cfg = loadWeb3Config();
    if (!cfg.motoswap) {
        throw new Error(
            'MotoSwap not configured in web3-defaults.yaml (motoswap.router / motoswap.factory)',
        );
    }

    // Get from-token metadata for amount parsing
    const { decimals, symbol } = await getTokenBalance(
        fromTokenAddr,
        wallet.address.toString(),
        provider,
        network,
    );

    const amountIn = parseUnits(amountStr, decimals);
    if (amountIn === 0n) throw new Error('Amount is zero');

    console.log(`  Input: ${amountStr} ${symbol}`);

    // Get quote via router
    const router = getContract<IMotoswapRouterContract>(
        cfg.motoswap.router,
        MOTOSWAP_ROUTER_ABI,
        provider,
        network,
        wallet.address,
    );

    const fromAddr = Address.fromString(fromTokenAddr);
    const toAddr = Address.fromString(toTokenAddr);
    const path = [fromAddr, toAddr];

    const quoteResult = await router.getAmountsOut(amountIn, path);
    if ('error' in quoteResult) {
        throw new Error(`getAmountsOut failed: ${quoteResult.error}`);
    }

    const amountsOut = quoteResult.properties.amountsOut;
    const expectedOut = amountsOut[amountsOut.length - 1];
    if (!expectedOut || expectedOut === 0n) {
        throw new Error('No liquidity for this pair');
    }

    const amountOutMin = applySlippage(expectedOut);

    // Get to-token metadata for display
    const toMeta = await getTokenBalance(
        toTokenAddr,
        wallet.address.toString(),
        provider,
        network,
    );
    console.log(
        `  Expected output: ${formatTokenBalance(expectedOut, toMeta.decimals, toMeta.symbol)}`,
    );
    console.log(
        `  Minimum output (1% slippage): ${formatTokenBalance(amountOutMin, toMeta.decimals, toMeta.symbol)}`,
    );

    // Ensure allowance for router
    await ensureAllowance(
        fromTokenAddr,
        cfg.motoswap.router,
        amountIn,
        wallet,
        provider,
        network,
    );

    // Deadline: current block + 20
    const currentBlock = BigInt(await provider.getBlockNumber());
    const deadline = currentBlock + 20n;

    // Execute swap
    console.log('  Executing swap...');
    const sim = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountIn,
        amountOutMin,
        path,
        wallet.address,
        deadline,
    );
    if ('error' in sim) {
        throw new Error(`swap simulation failed: ${sim.error}`);
    }

    await sendSigned(sim, wallet, network);
}

// ─── NativeSwap: BTC → OP20 ──────────────────────────────────────

async function executeNativeSwapBuy(
    amountStr: string,
    tokenAddr: string,
    wallet: Wallet,
    provider: JSONRpcProvider,
    network: Network,
): Promise<void> {
    const cfg = loadWeb3Config();
    if (!cfg.nativeSwap) {
        throw new Error(
            'NativeSwap not configured in web3-defaults.yaml (native_swap)',
        );
    }

    const satsIn = parseSats(amountStr);
    if (satsIn === 0n) throw new Error('Amount is zero');

    console.log(`  Input: ${formatSats(satsIn)}`);

    const nativeSwap = getContract<INativeSwapContract>(
        cfg.nativeSwap,
        NativeSwapAbi,
        provider,
        network,
        wallet.address,
    );

    const token = Address.fromString(tokenAddr);

    // Get quote
    const quoteResult = await nativeSwap.getQuote(token, satsIn);
    if ('error' in quoteResult) {
        throw new Error(`getQuote failed: ${quoteResult.error}`);
    }

    const expectedTokens = quoteResult.properties.tokensOut;
    if (expectedTokens === 0n) {
        throw new Error('No liquidity available on NativeSwap for this token');
    }

    const minTokensOut = applySlippage(expectedTokens);

    // Display quote (get token metadata for formatting)
    const tokenMeta = await getTokenBalance(
        tokenAddr,
        wallet.address.toString(),
        provider,
        network,
    );
    console.log(
        `  Expected output: ${formatTokenBalance(expectedTokens, tokenMeta.decimals, tokenMeta.symbol)}`,
    );
    console.log(
        `  Minimum output (1% slippage): ${formatTokenBalance(minTokensOut, tokenMeta.decimals, tokenMeta.symbol)}`,
    );

    // Phase 1: Reserve
    console.log('  Phase 1: Reserving swap...');
    const reserveSim = await nativeSwap.reserve(token, satsIn, minTokensOut, 1);
    if ('error' in reserveSim) {
        throw new Error(`reserve failed: ${reserveSim.error}`);
    }

    const preBlock = BigInt(await provider.getBlockNumber());

    await sendSigned(reserveSim, wallet, network, satsIn + MAX_SAT_TO_SPEND);
    console.log(`  Reserved at block ${preBlock}. Waiting for next block...`);

    // Wait for next block
    const nextBlock = await waitForNextBlock(provider, preBlock);
    console.log(`  Block ${nextBlock} arrived.`);

    // Phase 2: Execute swap
    console.log('  Phase 2: Executing swap...');
    const swapSim = await nativeSwap.swap(token);
    if ('error' in swapSim) {
        throw new Error(`swap execution failed: ${swapSim.error}`);
    }

    await sendSigned(swapSim, wallet, network);
}

// ─── NativeSwap: OP20 → BTC ──────────────────────────────────────

/**
 * Sell OP20 tokens for BTC via NativeSwap liquidity listing.
 *
 * IMPORTANT: This is NOT an instant swap. It lists your tokens for sale
 * on NativeSwap. BTC arrives at the wallet's P2TR address when a buyer
 * reserves and executes against your listing. This may take seconds,
 * minutes, or longer depending on demand.
 *
 * The command polls until the listing is fully consumed or times out.
 */
async function executeNativeSwapSell(
    amountStr: string,
    tokenAddr: string,
    wallet: Wallet,
    provider: JSONRpcProvider,
    network: Network,
): Promise<void> {
    const cfg = loadWeb3Config();
    if (!cfg.nativeSwap) {
        throw new Error(
            'NativeSwap not configured in web3-defaults.yaml (native_swap)',
        );
    }

    // Get token metadata
    const { decimals, symbol, balance } = await getTokenBalance(
        tokenAddr,
        wallet.address.toString(),
        provider,
        network,
    );

    const amountIn = parseUnits(amountStr, decimals);
    if (amountIn === 0n) throw new Error('Amount is zero');
    if (amountIn > balance) {
        throw new Error(
            `Insufficient ${symbol} balance: have ${formatTokenBalance(balance, decimals, symbol)}, need ${amountStr}`,
        );
    }

    console.log(`  Listing ${amountStr} ${symbol} for BTC on NativeSwap...`);

    // Build receiver script (wallet's P2TR address)
    const receiverScript = Buffer.from(btcAddress.toOutputScript(wallet.p2tr, network));
    const receiverStr = wallet.p2tr;

    const nativeSwap = getContract<INativeSwapContract>(
        cfg.nativeSwap,
        NativeSwapAbi,
        provider,
        network,
        wallet.address,
    );

    const token = Address.fromString(tokenAddr);

    // Ensure allowance for NativeSwap contract
    await ensureAllowance(
        tokenAddr,
        cfg.nativeSwap,
        amountIn,
        wallet,
        provider,
        network,
    );

    // List liquidity
    const listSim = await nativeSwap.listLiquidity(
        token,
        receiverScript,
        receiverStr,
        amountIn,
        false, // standard queue, not priority
    );
    if ('error' in listSim) {
        throw new Error(`listLiquidity failed: ${listSim.error}`);
    }

    await sendSigned(listSim, wallet, network);

    console.log(
        `  Listed ${formatTokenBalance(amountIn, decimals, symbol)} for BTC.`,
    );
    console.log(
        `  BTC will arrive at ${receiverStr} as buyers fill the listing.`,
    );

    // Poll until listing is consumed (or timeout after 30 min)
    const SELL_TIMEOUT_MS = 30 * 60 * 1000;
    const SELL_POLL_MS = 10_000;
    const start = Date.now();

    console.log('  Waiting for listing to be filled...');
    while (Date.now() - start < SELL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, SELL_POLL_MS));

        const details = await nativeSwap.getProviderDetails(token);
        if ('error' in details) continue;

        const remaining = details.properties.liquidity;
        if (remaining === 0n) {
            console.log('  Listing fully consumed.');
            return;
        }

        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(
            `  ${formatTokenBalance(remaining, decimals, symbol)} remaining (${elapsed}s elapsed)`,
        );
    }

    console.log(
        '  Timed out after 30 minutes. Listing is still active on NativeSwap.',
    );
    console.log(
        '  BTC will arrive as buyers fill it. Use NativeSwap to cancel if needed.',
    );
}

// ─── Entry point ──────────────────────────────────────────────────

/**
 * Core swap operation — used by both CLI and fund-manager.
 * Routes to MotoSwap or NativeSwap based on token types.
 */
export async function executeSwap(
    amountStr: string,
    fromTokenArg: string,
    toTokenArg: string,
    walletRole: string,
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    const wallet = resolveWallet(walletRole, book, network);
    if (!wallet) {
        throw new Error(`Cannot sign as '${walletRole}': no keyfile`);
    }

    const fromIsBtc = isBtc(fromTokenArg);
    const toIsBtc = isBtc(toTokenArg);

    if (fromIsBtc && toIsBtc) {
        throw new Error('Cannot swap BTC for BTC');
    }

    if (fromIsBtc) {
        // BTC → OP20 via NativeSwap
        const toResolved = await resolveToken(toTokenArg, contract);
        if (toResolved.isNative) throw new Error('Cannot swap BTC for BTC');

        await executeNativeSwapBuy(
            amountStr,
            toResolved.address,
            wallet,
            provider,
            network,
        );
    } else if (toIsBtc) {
        // OP20 → BTC via NativeSwap listLiquidity
        const fromResolved = await resolveToken(fromTokenArg, contract);
        if (fromResolved.isNative) throw new Error('Cannot swap BTC for BTC');

        await executeNativeSwapSell(
            amountStr,
            fromResolved.address,
            wallet,
            provider,
            network,
        );
    } else {
        // OP20 → OP20 via MotoSwap
        const fromResolved = await resolveToken(fromTokenArg, contract);
        const toResolved = await resolveToken(toTokenArg, contract);

        if (fromResolved.isNative || toResolved.isNative) {
            throw new Error('Unexpected native token in MotoSwap path');
        }

        await executeMotoSwap(
            amountStr,
            fromResolved.address,
            toResolved.address,
            wallet,
            provider,
            network,
        );
    }
}

/**
 * CLI handler
 */
export async function swapCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 4) {
        console.error(
            'Usage: bw swap <amount> <from-token> <to-token> <wallet>',
        );
        console.error('');
        console.error('Routes:');
        console.error(
            '  BTC  → OP20: NativeSwap (two-phase, waits for next block)',
        );
        console.error(
            '  OP20 → BTC:  NativeSwap (lists for sale, waits for buyer)',
        );
        console.error(
            '  OP20 → OP20: MotoSwap Router (single transaction)',
        );
        console.error('');
        console.error('Examples:');
        console.error('  bw swap 0.001 btc stable server');
        console.error('  bw swap 100 stable btc server');
        console.error('  bw swap 50 tokenA stable server');
        process.exit(1);
    }

    const [amountStr, fromTokenArg, toTokenArg, walletRole] = args;
    if (!amountStr || !fromTokenArg || !toTokenArg || !walletRole) {
        console.error(
            'Usage: bw swap <amount> <from-token> <to-token> <wallet>',
        );
        process.exit(1);
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        console.error(`Invalid amount: ${amountStr}`);
        process.exit(1);
    }

    const fromIsBtc = isBtc(fromTokenArg);
    const toIsBtc = isBtc(toTokenArg);
    const route = fromIsBtc || toIsBtc ? 'NativeSwap' : 'MotoSwap';

    console.log(
        `Swapping ${amountStr} ${fromTokenArg} → ${toTokenArg} via ${route} (wallet: ${walletRole})`,
    );

    await executeSwap(
        amountStr,
        fromTokenArg,
        toTokenArg,
        walletRole,
        book,
        provider,
        contract,
        network,
    );

    console.log('Swap complete.');
}
