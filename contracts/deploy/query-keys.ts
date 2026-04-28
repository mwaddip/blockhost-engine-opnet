import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

const RPC_URL = process.env.OPNET_RPC_URL ?? 'https://testnet.opnet.org';

function resolveNetwork(rpcUrl: string, name: string | undefined) {
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

const network = resolveNetwork(RPC_URL, process.env.OPNET_NETWORK);

const contracts: Record<string, string> = {
    OPNET_NFT_CONTRACT: process.env.OPNET_NFT_CONTRACT ?? '',
    OPNET_SUBSCRIPTIONS_CONTRACT: process.env.OPNET_SUBSCRIPTIONS_CONTRACT ?? '',
    OPNET_PAYMENT_TOKEN: process.env.OPNET_PAYMENT_TOKEN ?? '',
};

async function main(): Promise<void> {
    const provider = new JSONRpcProvider(RPC_URL, network);

    for (const [name, p2op] of Object.entries(contracts)) {
        if (!p2op) {
            console.log(`${name}: not set, skipping`);
            continue;
        }

        console.log(`\n${name}: ${p2op}`);

        // Try getPublicKeyInfo first
        try {
            const addr = await provider.getPublicKeyInfo(p2op, true);
            if (addr) {
                console.log(`  mldsa_hash:    ${addr.toHex()}`);
                try {
                    console.log(`  tweaked_pubkey: ${addr.tweakedToHex()}`);
                } catch {
                    console.log('  tweaked_pubkey: same as mldsa_hash (contract)');
                }
                continue;
            }
        } catch {
            // fall through
        }

        // Try getCode as fallback — the contract address is derived from the seed
        try {
            const code = await provider.getCode(p2op, true);
            if (code && code.bytecode.length > 0) {
                console.log(`  contract exists (${code.bytecode.length} bytes), but public key info not indexed yet`);
            } else {
                console.log('  contract not found');
            }
        } catch (err) {
            console.log(`  error: ${err}`);
        }
    }

    await provider.close();
}

main().catch((err) => {
    console.error('Query failed:', err);
    process.exit(1);
});
