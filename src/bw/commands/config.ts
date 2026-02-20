/**
 * bw config stable [address]
 *
 * Read or set the payment token on the subscription contract.
 *
 *   bw config stable              — show current payment token address
 *   bw config stable 0xToken...   — set payment token (owner-only)
 */

import { getContract, JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import type { Addressbook } from '../../fund-manager/types.js';
import { resolveWallet } from '../../fund-manager/addressbook.js';
import { isValidInternalAddress } from '../../fund-manager/addressbook.js';
import {
    BLOCKHOST_SUBSCRIPTIONS_ABI,
    type IBlockhostSubscriptions,
} from '../../fund-manager/contract-abis.js';
import { loadWeb3Config } from '../../fund-manager/web3-config.js';

export async function configCommand(
    args: string[],
    book: Addressbook,
    provider: JSONRpcProvider,
    contract: IBlockhostSubscriptions,
    network: Network,
): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: bw config stable [address]');
        console.error(
            '  No address: show current payment token',
        );
        console.error(
            '  With address: set payment token (owner-only)',
        );
        process.exit(1);
    }

    const subcommand = args[0];

    if (subcommand !== 'stable') {
        console.error(`Unknown config subcommand: ${subcommand}`);
        console.error('Available: stable');
        process.exit(1);
    }

    if (args.length === 1) {
        const result = await contract.getPaymentToken();
        if ('error' in result) {
            console.error('Failed to query payment token');
            process.exit(1);
        }
        const tokenAddr = result.properties.token.toString();
        const zeroAddr =
            '0x0000000000000000000000000000000000000000000000000000000000000000';
        if (tokenAddr === zeroAddr) {
            console.error('No payment token configured');
            process.exit(1);
        }
        console.log(tokenAddr);
        return;
    }

    const address = args[1];
    if (!address || !isValidInternalAddress(address)) {
        console.error(`Invalid address: ${address ?? '(missing)'}`);
        process.exit(1);
    }

    const serverWallet = resolveWallet('server', book, network);
    if (!serverWallet) {
        console.error(
            'Error: server wallet not available for signing',
        );
        process.exit(1);
    }

    const web3Config = loadWeb3Config();
    const contractAddress = web3Config.subscriptionsContract;

    const signedContract = getContract<IBlockhostSubscriptions>(
        contractAddress,
        BLOCKHOST_SUBSCRIPTIONS_ABI,
        provider,
        network,
        serverWallet.address,
    );

    const tokenAddr = Address.fromString(address);
    const sim = await signedContract.setPaymentToken(tokenAddr);

    if ('error' in sim) {
        console.error(`setPaymentToken failed: ${sim.error}`);
        process.exit(1);
    }

    await sim.sendTransaction({
        signer: serverWallet.keypair,
        mldsaSigner: serverWallet.mldsaKeypair,
        refundTo: serverWallet.p2tr,
        maximumAllowedSatToSpend: 100_000n,
        feeRate: 15,
        network,
    });

    console.log(address);
}
