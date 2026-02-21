/**
 * Browser-side BTC transfer via OPWallet.
 *
 * Bundled with esbuild for inclusion in the installer wizard.
 * Uses TransactionFactory.createBTCTransfer() with null signers —
 * OPWallet intercepts and prompts the user to sign.
 */
import { TransactionFactory, type IFundingTransactionParameters } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

declare const window: Record<string, unknown>;

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
    const opnet = window.opnet as { requestAccounts(): Promise<string[]> } | undefined;
    if (!opnet) throw new Error('OPWallet not detected');

    const network = resolveNetwork(networkName);
    const provider = new JSONRpcProvider(rpcUrl, network);
    const factory = new TransactionFactory();

    try {
        // 1. Get connected wallet address
        const accounts = await opnet.requestAccounts();
        if (!accounts.length) throw new Error('No accounts returned from OPWallet');
        const userAddress = accounts[0]!;

        // 2. Fetch UTXOs
        const utxos = await provider.utxoManager.getUTXOs({
            address: userAddress,
            optimize: false,
        });
        if (!utxos.length) throw new Error('No UTXOs available — wallet has no BTC');

        // 3. Dynamic fee rate
        const gas = await provider.gasParameters();
        const feeRate = gas.bitcoin.recommended.medium;

        // 4. Build + sign via OPWallet (null signers — wallet extension intercepts)
        const result = await factory.createBTCTransfer({
            signer: null,
            mldsaSigner: null,
            network,
            utxos,
            from: userAddress,
            to: toAddress,
            amount: BigInt(amountSats),
            feeRate,
            priorityFee: 0n,
            gasSatFee: 0n,
        } as unknown as IFundingTransactionParameters);

        // 5. Broadcast
        const broadcast = await provider.sendRawTransaction(result.tx, false);
        const txid = String(broadcast.result ?? broadcast);

        return {
            txid,
            fee: result.estimatedFees.toString(),
        };
    } catch (e: unknown) {
        console.log('[topup] error stack:', (e as Error).stack);
        throw e;
    } finally {
        await provider.close();
    }
}
