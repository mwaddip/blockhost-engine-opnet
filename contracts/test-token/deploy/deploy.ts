import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    AddressTypes,
    IDeploymentParameters,
    TransactionFactory,
    Mnemonic,
    MLDSASecurityLevel,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks, Network } from '@btc-vision/bitcoin';

// ── Configuration ────────────────────────────────────────────────────

const NETWORKS: Record<string, { rpc: string; network: Network }> = {
    regtest: { rpc: 'https://regtest.opnet.org', network: networks.regtest },
    mainnet: { rpc: 'https://mainnet.opnet.org', network: networks.bitcoin },
};

function usage(): never {
    console.error('Usage: npx tsx deploy.ts <wasm-path> [--calldata-hex <hex>] [--network regtest|mainnet]');
    console.error('');
    console.error('Environment: OPNET_MNEMONIC (required)');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx deploy.ts ../build/TestToken.wasm');
    console.error('  npx tsx deploy.ts ../build/Sub.wasm --calldata-hex 00ff...');
    console.error('  npx tsx deploy.ts ../build/Token.wasm --network mainnet');
    process.exit(1);
}

// ── Argument parsing ─────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) usage();

let wasmPath: string | null = null;
let calldataHex: string | null = null;
let networkName = 'regtest';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--calldata-hex') {
        calldataHex = args[++i];
    } else if (args[i] === '--network') {
        networkName = args[++i];
    } else if (args[i].startsWith('--')) {
        console.error(`Unknown flag: ${args[i]}`);
        usage();
    } else {
        wasmPath = args[i];
    }
}

if (!wasmPath) usage();

const MNEMONIC = process.env.OPNET_MNEMONIC;
if (!MNEMONIC) {
    console.error('Set OPNET_MNEMONIC environment variable');
    process.exit(1);
}

const netConfig = NETWORKS[networkName];
if (!netConfig) {
    console.error(`Unknown network: ${networkName}. Use: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────

interface AddressInfo {
    p2tr: string;
    p2op: string;
    tweaked: string;
}

async function resolveAddress(provider: JSONRpcProvider, address: string): Promise<AddressInfo | null> {
    try {
        const info = await provider.getPublicKeysInfoRaw(address);
        const entry = Object.values(info)[0] as { tweakedPubkey: string; p2tr: string; p2op: string } | undefined;
        if (!entry?.tweakedPubkey) return null;
        return {
            p2tr: entry.p2tr,
            p2op: entry.p2op,
            tweaked: `0x${entry.tweakedPubkey}`,
        };
    } catch {
        return null;
    }
}

function printAddress(label: string, info: AddressInfo): void {
    console.log(`${label}:`);
    console.log(`  Bitcoin (p2tr): ${info.p2tr}`);
    console.log(`  OPNet (p2op):   ${info.p2op}`);
    console.log(`  Tweaked (0x):   ${info.tweaked}`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const { rpc, network } = netConfig;
    const provider = new JSONRpcProvider(rpc, network);

    console.log(`Network: ${networkName} (${rpc})\n`);

    // Derive wallet
    const mnemonic = new Mnemonic(MNEMONIC, '', network, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

    const deployerInfo = await resolveAddress(provider, wallet.p2tr);
    if (!deployerInfo) {
        console.error('Could not resolve deployer address — is this wallet known to the network?');
        await provider.close();
        process.exit(1);
    }
    printAddress('Deployer', deployerInfo);

    // Check balance
    const balance = await provider.getBalance(wallet.p2tr, true);
    console.log(`  Balance:        ${balance.toString()} sats\n`);

    if (balance === 0n) {
        console.error('No funds at deployer address');
        await provider.close();
        process.exit(1);
    }

    // Read WASM
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const resolvedPath = resolve(__dirname, wasmPath!);
    const bytecode = readFileSync(resolvedPath);
    console.log(`Bytecode: ${resolvedPath} (${bytecode.length} bytes)`);

    // Calldata
    const calldata = calldataHex
        ? Buffer.from(calldataHex, 'hex')
        : new Uint8Array(0);
    if (calldata.length > 0) {
        console.log(`Calldata: ${calldata.length} bytes`);
    }

    // UTXOs
    const utxos = await provider.utxoManager.getUTXOs({ address: wallet.p2tr });
    console.log(`UTXOs: ${utxos.length}`);

    if (utxos.length === 0) {
        console.error('No UTXOs available');
        await provider.close();
        process.exit(1);
    }

    // PoW challenge
    const challenge = await provider.getChallenge();
    console.log('Challenge obtained\n');

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
        calldata: calldata,
        challenge: challenge,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey: true,
    };

    const deployment = await factory.signDeployment(deploymentParams);

    // Broadcast
    console.log('Broadcasting funding TX...');
    const fundingResult = await provider.sendRawTransaction(deployment.transaction[0]);
    console.log(`  txid: ${fundingResult.result}  peers: ${fundingResult.peers}`);

    console.log('Broadcasting reveal TX...');
    const revealResult = await provider.sendRawTransaction(deployment.transaction[1]);
    console.log(`  txid: ${revealResult.result}  peers: ${revealResult.peers}`);

    console.log('\n── Deployment Complete ──────────────────────────────');
    console.log('Contract:');
    console.log(`  OPNet (p2op):   ${deployment.contractAddress}`);
    const pubkey = deployment.contractPubKey.startsWith('0x')
        ? deployment.contractPubKey
        : `0x${deployment.contractPubKey}`;
    console.log(`  Tweaked (0x):   ${pubkey}`);

    await provider.close();
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
