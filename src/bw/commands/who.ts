/**
 * bw who <identifier>
 *
 * Query the owner of an AccessCredentialNFT by token ID.
 *
 * Forms:
 *   bw who <nft_id>    — who owns NFT token? (integer)
 *   bw who admin       — who owns admin NFT? (from blockhost.yaml)
 *
 * Reads nft_contract and rpc_url from web3-defaults.yaml,
 * and admin.credential_nft_id from blockhost.yaml.
 *
 * Note: Signature recovery (ethers.verifyMessage) is removed since OPNet
 * uses ML-DSA signatures, not ECDSA. That feature was EVM-specific.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { getContract, JSONRpcProvider } from 'opnet';
import {
    ACCESS_CREDENTIAL_NFT_ABI,
    type IAccessCredentialNFT,
} from '../../fund-manager/contract-abis.js';
import { loadWeb3Config } from '../../fund-manager/web3-config.js';

const BLOCKHOST_CONFIG_PATH = '/etc/blockhost/blockhost.yaml';

function loadAdminNftId(): number {
    if (!fs.existsSync(BLOCKHOST_CONFIG_PATH)) {
        throw new Error(`Config not found: ${BLOCKHOST_CONFIG_PATH}`);
    }

    const raw = yaml.load(
        fs.readFileSync(BLOCKHOST_CONFIG_PATH, 'utf8'),
    ) as Record<string, unknown>;
    const admin = raw['admin'] as Record<string, unknown> | undefined;

    if (
        !admin ||
        admin['credential_nft_id'] === undefined ||
        admin['credential_nft_id'] === null
    ) {
        throw new Error(
            'admin.credential_nft_id not set in blockhost.yaml',
        );
    }

    const id = Number(admin['credential_nft_id']);
    if (!Number.isInteger(id) || id < 0) {
        throw new Error(
            `Invalid admin.credential_nft_id: ${String(admin['credential_nft_id'])}`,
        );
    }

    return id;
}

/**
 * CLI handler
 */
export async function whoCommand(args: string[]): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: bw who <identifier>');
        console.error(
            "  identifier: token ID (0, 1, 2, ...) or 'admin'",
        );
        process.exit(1);
    }

    const identifier = args[0];
    if (!identifier) {
        console.error('Usage: bw who <identifier>');
        process.exit(1);
    }

    let tokenId: number;
    if (identifier === 'admin') {
        tokenId = loadAdminNftId();
    } else if (/^\d+$/.test(identifier)) {
        tokenId = parseInt(identifier, 10);
    } else {
        console.error(
            `Invalid identifier: '${identifier}'. Use a token ID or 'admin'.`,
        );
        process.exit(1);
    }

    const { nftContract, rpcUrl, network } = loadWeb3Config();
    const provider = new JSONRpcProvider(rpcUrl, network);
    const contract = getContract<IAccessCredentialNFT>(
        nftContract,
        ACCESS_CREDENTIAL_NFT_ABI,
        provider,
        network,
    );

    try {
        const result = await contract.ownerOf(BigInt(tokenId));
        await provider.close();

        if ('error' in result) {
            console.error(`Error: token ${tokenId} does not exist`);
            process.exit(1);
        }

        console.log(result.properties.owner.toString());
    } catch {
        await provider.close();
        console.error(`Error: token ${tokenId} does not exist`);
        process.exit(1);
    }
}
