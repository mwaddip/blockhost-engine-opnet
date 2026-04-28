import { readFileSync } from 'fs';
import { BinaryWriter } from '@btc-vision/transaction';
import {
    deployContract,
    resolveDeployNetwork,
} from './deploy-helpers.js';

const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';
const network = resolveDeployNetwork(RPC_URL, process.env.OPNET_NETWORK);

const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) {
    console.error('Set OPNET_MNEMONIC environment variable');
    process.exit(1);
}

const MAX_SUPPLY = 1000n; // 1000 NFTs max

async function main(): Promise<void> {
    // Read WASM bytecode (env var set by deploy-contracts wrapper, fallback for dev)
    const wasmPath = process.env.BLOCKHOST_WASM_NFT;
    const bytecode = wasmPath
        ? readFileSync(wasmPath)
        : readFileSync(
              new URL(
                  '../access-credential-nft/build/AccessCredentialNFT.wasm',
                  import.meta.url,
              ),
          );

    // Constructor calldata: maxSupply (u256)
    const calldata = new BinaryWriter();
    calldata.writeU256(MAX_SUPPLY);

    const result = await deployContract({
        rpcUrl: RPC_URL,
        network,
        mnemonic: MNEMONIC,
        bytecode,
        calldata: calldata.getBuffer(),
    });

    console.log('\nNFT deployment complete!');
    console.log('Contract:', result.contractAddress);
    console.log('Contract pubkey:', result.contractPubKey);
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
