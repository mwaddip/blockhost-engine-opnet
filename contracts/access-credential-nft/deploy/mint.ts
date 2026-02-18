import {
    AddressTypes,
    BinaryWriter,
    IInteractionParameters,
    TransactionFactory,
    Mnemonic,
    MLDSASecurityLevel,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { createHash } from 'crypto';

const RPC_URL = 'https://regtest.opnet.org';
const network = networks.regtest;

const MNEMONIC = process.env.OPNET_MNEMONIC;
const CONTRACT = process.env.OPNET_NFT_CONTRACT;

if (!MNEMONIC) {
    console.error('Set OPNET_MNEMONIC environment variable');
    process.exit(1);
}
if (!CONTRACT) {
    console.error('Set OPNET_NFT_CONTRACT environment variable');
    process.exit(1);
}

/** SHA256 first 4 bytes of method name */
function methodSelector(name: string): Buffer {
    const hash = createHash('sha256').update(name).digest();
    return hash.subarray(0, 4);
}

async function main(): Promise<void> {
    const provider = new JSONRpcProvider(RPC_URL, network);

    const mnemonic = new Mnemonic(
        MNEMONIC,
        '',
        network,
        MLDSASecurityLevel.LEVEL2,
    );
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

    console.log('Deployer:', wallet.p2tr);
    console.log('Contract:', CONTRACT);

    // Build mint calldata: mint(to: ADDRESS, userEncrypted: STRING, publicSecret: STRING)
    // Mint to ourselves (the deployer)
    const calldata = new BinaryWriter();

    // Method selector
    const selector = methodSelector('mint');
    console.log('Mint selector:', selector.toString('hex'));
    calldata.writeBytes(selector);

    // "to" address - write deployer's address as bytes
    // OPNet ADDRESS type = the tweaked public key (33 bytes compressed)
    // Actually, in the contract, Address = p2tr hash. Let's use the deployer's address.
    // The contract uses Blockchain.tx.sender for onlyDeployer check.
    // For the "to" param, we need to encode an Address.
    // Looking at BinaryWriter, writeAddress takes a string.
    calldata.writeAddress(wallet.p2tr);

    // userEncrypted (STRING) - test data
    calldata.writeStringWithLength('test-encrypted-data');

    // publicSecret (STRING) - test data
    calldata.writeStringWithLength('test-public-secret');

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

    // Build interaction
    const factory = new TransactionFactory();
    const interactionParams: IInteractionParameters = {
        from: wallet.p2tr,
        to: CONTRACT,
        utxos: utxos,
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network: network,
        feeRate: 5,
        priorityFee: 0n,
        gasSatFee: 10_000n,
        calldata: calldata.getBuffer(),
        challenge: challenge,
    };

    const interaction = await factory.signInteraction(interactionParams);
    console.log('Interaction signed, broadcasting...');

    // Broadcast funding TX
    console.log('Broadcasting funding TX...');
    const fundingResult = await provider.sendRawTransaction(
        interaction.transaction[0],
    );
    console.log('Funding:', JSON.stringify(fundingResult));

    // Broadcast interaction TX
    console.log('Broadcasting interaction TX...');
    const interactionResult = await provider.sendRawTransaction(
        interaction.transaction[1],
    );
    console.log('Interaction:', JSON.stringify(interactionResult));

    console.log('\nMint submitted! Wait for confirmation.');

    await provider.close();
}

main().catch((err) => {
    console.error('Mint failed:', err);
    process.exit(1);
});
