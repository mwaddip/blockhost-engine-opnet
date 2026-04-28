/**
 * Shared deploy boilerplate for OPNet contracts.
 *
 * Each `deploy-*.ts` wrapper builds its own constructor calldata,
 * then delegates to deployContract() for the rest of the flow:
 * wallet derivation, balance + UTXO fetch, PoW challenge, deployment
 * sign, funding + reveal broadcast, mining confirmation.
 */

import {
    AddressTypes,
    IDeploymentParameters,
    TransactionFactory,
    Mnemonic,
    MLDSASecurityLevel,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';
import { waitForConfirmation } from '../../src/fund-manager/token-utils.js';

/**
 * Resolve a deploy-time network from environment.
 *
 * Prefers explicit OPNET_NETWORK (testnet|mainnet). Falls back to RPC
 * URL substring for legacy invocations and emits a warning since a URL
 * like 'https://mainnet-mirror.example.com/testnet' would misroute.
 */
export function resolveDeployNetwork(
    rpcUrl: string,
    name: string | undefined,
): Network {
    if (name === 'mainnet') return networks.bitcoin;
    if (name === 'testnet') return networks.opnetTestnet;
    if (name !== undefined) {
        console.error(
            `OPNET_NETWORK='${name}' is invalid (expected testnet|mainnet); falling back to RPC URL substring.`,
        );
    } else {
        console.error(
            `OPNET_NETWORK not set; falling back to RPC URL substring — set OPNET_NETWORK=testnet|mainnet to harden.`,
        );
    }
    if (rpcUrl.includes('mainnet')) return networks.bitcoin;
    return networks.opnetTestnet;
}

export interface DeployContractOptions {
    readonly rpcUrl: string;
    readonly network: Network;
    readonly mnemonic: string;
    readonly bytecode: Buffer;
    readonly calldata: Buffer;
}

export interface DeployContractResult {
    readonly contractAddress: string;
    readonly contractPubKey: string;
    readonly fundingHash: string;
    readonly revealHash: string;
}

/**
 * Run the full deploy flow. Throws on any failure (caller's main().catch
 * should exit non-zero).
 */
export async function deployContract(
    opts: DeployContractOptions,
): Promise<DeployContractResult> {
    const provider = new JSONRpcProvider({
        url: opts.rpcUrl,
        network: opts.network,
    });

    try {
        const mnemonic = new Mnemonic(
            opts.mnemonic,
            '',
            opts.network,
            MLDSASecurityLevel.LEVEL2,
        );
        const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

        console.log('Deployer address:', wallet.p2tr);

        const balance = await provider.getBalance(wallet.p2tr, true);
        console.log('Balance:', balance.toString(), 'sats');

        if (balance === 0n) {
            throw new Error('No funds at deployer address');
        }

        console.log('Bytecode size:', opts.bytecode.length, 'bytes');

        const utxos = await provider.utxoManager.getUTXOs({
            address: wallet.p2tr,
        });
        console.log('UTXOs:', utxos.length);

        if (utxos.length === 0) {
            throw new Error('No UTXOs available');
        }

        const challenge = await provider.getChallenge();
        console.log('Challenge obtained');

        const factory = new TransactionFactory();
        const deploymentParams: IDeploymentParameters = {
            from: wallet.p2tr,
            utxos,
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            network: opts.network,
            feeRate: 15,
            priorityFee: 10_000n,
            gasSatFee: 50_000n,
            bytecode: opts.bytecode,
            calldata: opts.calldata,
            challenge,
            linkMLDSAPublicKeyToAddress: true,
            revealMLDSAPublicKey: true,
        };

        const deployment = await factory.signDeployment(deploymentParams);
        console.log('Contract address:', deployment.contractAddress);

        console.log('Broadcasting funding TX...');
        const fundingResult = await provider.sendRawTransaction(
            deployment.transaction[0],
        );
        if ('error' in fundingResult) {
            throw new Error(
                `Funding TX rejected: ${JSON.stringify(fundingResult)}`,
            );
        }
        const fundingHash = String(fundingResult.result ?? fundingResult);
        console.log('Funding TX:', fundingHash);

        console.log('Broadcasting reveal TX...');
        const revealResult = await provider.sendRawTransaction(
            deployment.transaction[1],
        );
        if ('error' in revealResult) {
            throw new Error(
                `Reveal TX rejected: ${JSON.stringify(revealResult)}`,
            );
        }
        const revealHash = String(revealResult.result ?? revealResult);
        console.log('Reveal TX:', revealHash);

        console.log('Waiting for mining confirmation...');
        await waitForConfirmation(provider, revealHash);

        return {
            contractAddress: String(deployment.contractAddress),
            contractPubKey: deployment.contractPubKey,
            fundingHash,
            revealHash,
        };
    } finally {
        await provider.close();
    }
}
