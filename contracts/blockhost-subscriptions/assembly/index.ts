import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';
import { BlockhostSubscriptions } from './contracts/BlockhostSubscriptions';

Blockchain.contract = () => {
    return new BlockhostSubscriptions();
};

export * from '@btc-vision/btc-runtime/runtime/exports';

export function abort(message: string, fileName: string, line: u32, column: u32): void {
    revertOnError(message, fileName, line, column);
}
