/**
 * Browser-side BTC transfer via OPWallet.
 *
 * Bundled with esbuild for inclusion in the installer wizard.
 * Uses TransactionFactory.createBTCTransfer() with IFundingTransactionParametersWithoutSigner —
 * OPWallet intercepts, handles UTXO selection, signing, and broadcasting.
 */
import {
    TransactionFactory,
    type IFundingTransactionParametersWithoutSigner,
} from '@btc-vision/transaction';

export interface TopUpResult {
    txid: string;
    fee: string;
}

type OpnetWallet = {
    requestAccounts(): Promise<string[]>;
};

declare const window: Record<string, unknown>;

/**
 * Send BTC from the connected OPWallet to a recipient address.
 *
 * @param _rpcUrl      OPNet RPC endpoint (unused — OPWallet handles RPC)
 * @param _networkName 'regtest' | 'testnet' | 'mainnet' (unused — OPWallet knows the network)
 * @param toAddress    Recipient P2TR address
 * @param amountSats   Amount in satoshis
 */
export async function sendBTC(
    _rpcUrl: string,
    _networkName: string,
    toAddress: string,
    amountSats: number,
): Promise<TopUpResult> {
    const opnet = window.opnet as OpnetWallet | undefined;
    if (!opnet) throw new Error('OPWallet not detected');

    // Get connected wallet address
    const accounts = await opnet.requestAccounts();
    if (!accounts.length) throw new Error('No accounts returned from OPWallet');
    const userAddress = accounts[0]!;

    // OPWallet handles UTXOs, fees, signing, and broadcasting
    const factory = new TransactionFactory();
    const params: IFundingTransactionParametersWithoutSigner = {
        from: userAddress,
        to: toAddress,
        amount: BigInt(amountSats),
        feeRate: 0,
        priorityFee: 0n,
        utxos: [],
    };

    const result = await factory.createBTCTransfer(params);

    return {
        txid: result.tx,
        fee: result.estimatedFees.toString(),
    };
}
