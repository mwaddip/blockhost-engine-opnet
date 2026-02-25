/**
 * Browser-side BTC transfer via OPWallet.
 *
 * Bundled with esbuild for inclusion in the installer wizard.
 * Uses window.opnet.sendBitcoin() — implemented in OPWallet v1.8.2.
 * Wallet handles UTXO selection, signing, and broadcasting internally.
 */

declare const window: Record<string, unknown>;

export interface TopUpResult {
    txid: string;
    fee: string;
}

type OpnetWallet = {
    sendBitcoin(toAddress: string, satoshis: number, options?: { feeRate?: number }): Promise<string>;
};

/**
 * Send BTC from the connected OPWallet to a recipient address.
 *
 * @param rpcUrl      OPNet RPC endpoint (unused — wallet handles everything)
 * @param networkName 'regtest' | 'testnet' | 'mainnet' (unused — wallet uses configured network)
 * @param toAddress   Recipient P2TR address
 * @param amountSats  Amount in satoshis
 */
export async function sendBTC(
    _rpcUrl: string,
    _networkName: string,
    toAddress: string,
    amountSats: number,
): Promise<TopUpResult> {
    const opnet = window.opnet as OpnetWallet | undefined;
    if (!opnet) throw new Error('OPWallet not detected');

    const txid = await opnet.sendBitcoin(toAddress, amountSats);

    return { txid, fee: '' };
}
