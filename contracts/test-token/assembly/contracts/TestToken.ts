import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    OP20,
    OP20InitParameters,
    Blockchain,
    Calldata,
} from '@btc-vision/btc-runtime/runtime';

@final
export class TestToken extends OP20 {
    public constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        const maxSupply = u256.fromString('2100000000000000'); // 21M with 8 decimals

        this.instantiate(new OP20InitParameters(
            maxSupply,
            8,
            'BlockHost Test Token',
            'BHTT',
        ));

        this._mint(Blockchain.tx.origin, maxSupply);
    }
}
