import { readFileSync } from 'fs';
import {
    AddressTypes,
    BinaryWriter,
    IDeploymentParameters,
    TransactionFactory,
    Mnemonic,
    MLDSASecurityLevel,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://regtest.opnet.org';
const network = RPC_URL.includes('mainnet')
    ? networks.bitcoin
    : RPC_URL.includes('testnet')
      ? networks.opnetTestnet
      : networks.regtest;

const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) {
    console.error('Set OPNET_MNEMONIC environment variable');
    process.exit(1);
}

const MAX_SUPPLY = 1000n; // 1000 NFTs max

async function main(): Promise<void> {
    const provider = new JSONRpcProvider({ url: RPC_URL, network });

    const mnemonic = new Mnemonic(
        MNEMONIC,
        '',
        network,
        MLDSASecurityLevel.LEVEL2,
    );
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

    console.log('Deployer address:', wallet.p2tr);

    const balance = await provider.getBalance(wallet.p2tr, true);
    console.log('Balance:', balance.toString(), 'sats');

    if (balance === 0n) {
        console.error('No funds at deployer address');
        await provider.close();
        process.exit(1);
    }

    // Read WASM bytecode (env var set by deploy-contracts wrapper, fallback for dev)
    const wasmPath = process.env.BLOCKHOST_WASM_NFT;
    const bytecode = wasmPath
        ? readFileSync(wasmPath)
        : readFileSync(new URL('../access-credential-nft/build/AccessCredentialNFT.wasm', import.meta.url));
    console.log('Bytecode size:', bytecode.length, 'bytes');

    // Constructor calldata: maxSupply (u256)
    const calldata = new BinaryWriter();
    calldata.writeU256(MAX_SUPPLY);

    // Get UTXOs
    const utxos = await provider.utxoManager.getUTXOs({
        address: wallet.p2tr,
    });
    console.log('UTXOs:', utxos.length);

    if (utxos.length === 0) {
        console.error('No UTXOs available');
        await provider.close();
        process.exit(1);
    }

    // Get PoW challenge
    const challenge = await provider.getChallenge();
    console.log('Challenge obtained');

    // Deploy
    const factory = new TransactionFactory();
    const deploymentParams: IDeploymentParameters = {
        from: wallet.p2tr,
        utxos: utxos,
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network: network,
        feeRate: 15,
        priorityFee: 10_000n,
        gasSatFee: 50_000n,
        bytecode: bytecode,
        calldata: calldata.getBuffer(),
        challenge: challenge,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey: true,
    };

    const deployment = await factory.signDeployment(deploymentParams);
    console.log('Contract address:', deployment.contractAddress);

    // Broadcast funding transaction
    console.log('Broadcasting funding TX...');
    const fundingResult = await provider.sendRawTransaction(
        deployment.transaction[0],
    );
    console.log('Funding result:', JSON.stringify(fundingResult));

    // Broadcast reveal transaction
    console.log('Broadcasting reveal TX...');
    const revealResult = await provider.sendRawTransaction(
        deployment.transaction[1],
    );
    console.log('Reveal result:', JSON.stringify(revealResult));

    console.log('\nNFT deployment complete!');
    console.log('Contract:', deployment.contractAddress);
    console.log('Contract pubkey:', deployment.contractPubKey);

    await provider.close();
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
