import { readFileSync } from 'fs';
import { BinaryWriter } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
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

const PAYMENT_TOKEN = process.env.OPNET_PAYMENT_TOKEN;
if (!PAYMENT_TOKEN) {
    console.error('Set OPNET_PAYMENT_TOKEN environment variable');
    process.exit(1);
}

async function main(): Promise<void> {
    // Read WASM bytecode (env var set by deploy-contracts wrapper, fallback for dev)
    const wasmPath = process.env.BLOCKHOST_WASM_SUBS;
    const bytecode = wasmPath
        ? readFileSync(wasmPath)
        : readFileSync(
              new URL(
                  '../blockhost-subscriptions/build/BlockhostSubscriptions.wasm',
                  import.meta.url,
              ),
          );

    // Resolve payment token P2OP address to internal Address (32 bytes)
    console.log('Resolving payment token address:', PAYMENT_TOKEN);
    const lookupProvider = new JSONRpcProvider({ url: RPC_URL, network });
    let paymentTokenAddr;
    try {
        paymentTokenAddr = await lookupProvider.getPublicKeyInfo(
            PAYMENT_TOKEN,
            true,
        );
    } finally {
        await lookupProvider.close();
    }
    console.log('Payment token internal address:', paymentTokenAddr.toHex());

    // Constructor calldata: paymentToken (address = 32 bytes)
    const calldata = new BinaryWriter();
    calldata.writeAddress(paymentTokenAddr);

    const result = await deployContract({
        rpcUrl: RPC_URL,
        network,
        mnemonic: MNEMONIC,
        bytecode,
        calldata: calldata.getBuffer(),
    });

    console.log('\nSubscriptions deployment complete!');
    console.log('Contract:', result.contractAddress);
    console.log('Contract pubkey:', result.contractPubKey);
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
