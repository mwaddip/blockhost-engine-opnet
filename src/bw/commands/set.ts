/**
 * bw set encrypt <nft_id> <userEncrypted>
 *
 * Update the userEncrypted field on an AccessCredentialNFT.
 *
 *   bw set encrypt 0 "encrypted-data-here"   — update NFT #0 encrypted data
 *
 * Prints confirmation on success.
 */

import { getContract, JSONRpcProvider } from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import type { Addressbook } from '../../fund-manager/types.js';
import { resolveWallet } from '../../fund-manager/addressbook.js';
import {
    ACCESS_CREDENTIAL_NFT_ABI,
    type IAccessCredentialNFT,
} from '../../fund-manager/contract-abis.js';
import { loadWeb3Config } from '../../fund-manager/web3-config.js';

export async function setCommand(
    args: string[],
    book: Addressbook,
    _provider: JSONRpcProvider,
    _network: Network,
): Promise<void> {
    if (args.length < 1) {
        console.error(
            'Usage: bw set encrypt <nft_id> <userEncrypted>',
        );
        console.error('  nft_id:        NFT token ID (integer)');
        console.error(
            '  userEncrypted: encrypted data string',
        );
        process.exit(1);
    }

    const subcommand = args[0];

    if (subcommand !== 'encrypt') {
        console.error(`Unknown set subcommand: ${subcommand}`);
        console.error('Available: encrypt');
        process.exit(1);
    }

    if (args.length < 3) {
        console.error(
            'Usage: bw set encrypt <nft_id> <userEncrypted>',
        );
        process.exit(1);
    }

    const nftIdStr = args[1];
    const userEncrypted = args[2];

    if (!nftIdStr || !userEncrypted) {
        console.error(
            'Usage: bw set encrypt <nft_id> <userEncrypted>',
        );
        process.exit(1);
    }

    const nftId = parseInt(nftIdStr, 10);
    if (isNaN(nftId) || nftId < 0) {
        console.error(`Invalid NFT ID: ${nftIdStr}`);
        process.exit(1);
    }

    const { nftContract: nftContractAddress, rpcUrl, network } =
        loadWeb3Config();

    const serverWallet = resolveWallet('server', book, network);
    if (!serverWallet) {
        console.error(
            'Error: server wallet not available for signing',
        );
        process.exit(1);
    }

    const provider = new JSONRpcProvider(rpcUrl, network);
    const nftContract = getContract<IAccessCredentialNFT>(
        nftContractAddress,
        ACCESS_CREDENTIAL_NFT_ABI,
        provider,
        network,
        serverWallet.address,
    );

    const sim = await nftContract.updateUserEncrypted(
        BigInt(nftId),
        userEncrypted,
    );

    if ('error' in sim) {
        await provider.close();
        console.error(
            `updateUserEncrypted failed: ${sim.error}`,
        );
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

    await provider.close();
    console.log(`Updated NFT #${nftId} userEncrypted.`);
}
