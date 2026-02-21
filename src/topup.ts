/**
 * Browser-side BTC transfer via OPWallet.
 *
 * Bundled with esbuild for inclusion in the installer wizard.
 * Uses TransactionFactory.createBTCTransfer() with null signers —
 * OPWallet intercepts and prompts the user to sign.
 */
import { TransactionFactory } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

function resolveNetwork(name: string) {
    return name === 'mainnet' ? networks.bitcoin :
           name === 'testnet' ? networks.testnet : networks.regtest;
}

export interface TopUpResult {
    txid: string;
    fee: string;
}

/**
 * Send BTC from the connected OPWallet to a recipient address.
 *
 * @param rpcUrl    OPNet RPC endpoint
 * @param networkName  'regtest' | 'testnet' | 'mainnet'
 * @param toAddress Recipient P2TR address
 * @param amountSats Amount in satoshis
 */
export async function sendBTC(
    rpcUrl: string,
    networkName: string,
    toAddress: string,
    amountSats: number,
): Promise<TopUpResult> {
    const opnet = (window as any).opnet;
    if (!opnet) throw new Error('OPWallet not detected');

    const network = resolveNetwork(networkName);
    const provider = new JSONRpcProvider(rpcUrl, network);
    const factory = new TransactionFactory();

    try {
        // 1. Get connected wallet address
        const accounts: string[] = await opnet.requestAccounts();
        if (!accounts.length) throw new Error('No accounts returned from OPWallet');
        const userAddress = accounts[0];

        // 2. Fetch UTXOs
        const utxos = await provider.utxoManager.getUTXOs({
            address: userAddress,
            optimize: false,
        });
        if (!utxos.length) throw new Error('No UTXOs available — wallet has no BTC');

        // 3. Build + sign via OPWallet (null signers)
        const result = await factory.createBTCTransfer({
            signer: null as any,
            mldsaSigner: null,
            network,
            utxos,
            from: userAddress,
            to: toAddress,
            feeRate: 10,
            priorityFee: 0n,
            gasSatFee: 0n,
            amount: BigInt(amountSats),
        });

        // 4. Broadcast
        const broadcast = await provider.sendRawTransaction(result.tx, false);
        const txid = broadcast.result || broadcast.toString();

        return {
            txid,
            fee: result.estimatedFees.toString(),
        };
    } finally {
        await provider.close();
    }
}
