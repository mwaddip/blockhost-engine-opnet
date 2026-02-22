/**
 * bw withdraw <to>
 *
 * Withdraw payment tokens from the subscription contract.
 * Only the server wallet (contract owner) can call withdraw.
 *
 * On OPNet, the BlockhostSubscriptions contract has a single `withdraw(to)`
 * method that withdraws accumulated payment tokens to the specified address.
 *
 *   bw withdraw hot   — withdraw to hot wallet
 */

import { getContract, JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import type { Addressbook } from '../../fund-manager/types.js';
import {
    resolveAddress,
    resolveWallet,
} from '../../fund-manager/addressbook.js';
import {
    BLOCKHOST_SUBSCRIPTIONS_ABI,
    type IBlockhostSubscriptions,
} from '../../fund-manager/contract-abis.js';
import { loadWeb3Config } from '../../fund-manager/web3-config.js';
import { sendSigned } from '../../fund-manager/token-utils.js';

/**
 * Core withdraw operation — withdraw payment tokens from contract.
 * Returns void on success, throws on error.
 */
export async function executeWithdraw(
    toRole: string,
    book: Addressbook,
    provider: JSONRpcProvider,
    contractAddress: string,
    network: Network,
): Promise<void> {
    const serverWallet = resolveWallet('server', book, network);
    if (!serverWallet)
        throw new Error(
            'Cannot withdraw: server wallet not available',
        );

    const toAddress = resolveAddress(toRole, book);
    if (!toAddress)
        throw new Error(`Cannot resolve recipient '${toRole}'`);

    const contract = getContract<IBlockhostSubscriptions>(
        contractAddress,
        BLOCKHOST_SUBSCRIPTIONS_ABI,
        provider,
        network,
        serverWallet.address,
    );

    const toAddr = Address.fromString(toAddress);
    const sim = await contract.withdraw(toAddr);

    if ('error' in sim) {
        throw new Error(`withdraw simulation failed: ${sim.error}`);
    }

    await sendSigned(sim, serverWallet, network);
}

/**
 * CLI handler
 */
export async function withdrawCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    _contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: bw withdraw <to>');
        console.error('  Example: bw withdraw hot');
        process.exit(1);
    }

    const toRole = args[0];
    if (!toRole) {
        console.error('Usage: bw withdraw <to>');
        process.exit(1);
    }

    const web3Config = loadWeb3Config();
    const contractAddress = web3Config.subscriptionsContract;

    console.log(
        `Withdrawing from contract to ${toRole}...`,
    );
    await executeWithdraw(
        toRole,
        book,
        provider,
        contractAddress,
        network,
    );
    console.log('Withdrawn.');
}
