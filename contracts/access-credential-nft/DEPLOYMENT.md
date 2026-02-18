# AccessCredentialNFT Deployment Guide

Lessons learned and working steps from deploying to OPNet public regtest (February 2026).

---

## Prerequisites

- Node.js >= 24
- OPNet deployer wallet funded with regtest BTC
- Mnemonic in `~/projects/sharedenv/opnet-regtest.env`

```bash
source ~/projects/sharedenv/opnet-regtest.env
```

---

## Build

```bash
cd contracts/access-credential-nft
npm install
npm run build
```

Build output: `build/AccessCredentialNFT.wasm` (~28 KB)

Verify the WASM exports `start`, `execute`, `onDeploy`, `onUpdate`, and `abort`.

---

## Deploy

```bash
cd libpam-web3/opnet-auth-svc/tmp/e2e
source ~/projects/sharedenv/opnet-regtest.env
npx tsx deploy.ts
```

The deploy script broadcasts two transactions. Both must confirm in a block before the contract is live. Public regtest mines blocks roughly every 2-5 minutes.

After deployment, update `~/projects/sharedenv/opnet-regtest.env` with the new contract address.

---

## Verify

```bash
npx tsx query.ts    # balanceOf, tokenOfOwnerByIndex, getAccessData, ownerOf
npx tsx check.ts    # TX receipts and block confirmation
```

---

## Mint

```bash
npx tsx mint.ts <contract_address> [recipient_opnet_address]
```

Defaults to minting to the deployer. Must wait for a block before the mint is reflected in reads.

---

## Test opnet-auth-svc Integration

```bash
cd libpam-web3/opnet-auth-svc

# Update test-config.toml with the new contract address
# Then start the service:
./target/release/opnet-auth-svc --config test-config.toml &

# Send a test request via Unix socket:
python3 tmp/test-socket.py <wallet_address>
# Expected: {"success": true, "token_ids": ["0x000...001"]}
```

---

## Lessons Learned

### 1. `exportStart: "start"` is mandatory in asconfig.json

Without this, the WASM compiles fine but the OPNet runtime rejects it at deployment with:

```
revert: "OP_NET: start function not found"
```

The AssemblyScript compiler generates an internal `_start` function but does not export it by default. The `exportStart` option tells it to export `_start` as `start`.

### 2. The entry point (index.ts) must follow an exact pattern

Three things are required:

```typescript
import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';
import { MyContract } from './contracts/MyContract';

// 1. Factory function - runtime calls this to instantiate the contract
Blockchain.contract = () => {
    return new MyContract();
};

// 2. Re-export runtime entry points (execute, onDeploy, onUpdate)
export * from '@btc-vision/btc-runtime/runtime/exports';

// 3. Abort handler - must call revertOnError, not be empty
export function abort(message: string, fileName: string, line: u32, column: u32): void {
    revertOnError(message, fileName, line, column);
}
```

Missing any of these causes cryptic errors. An empty abort function causes `"Cannot read properties of undefined (reading 'includes')"`. Missing `Blockchain.contract` or the runtime exports causes silent failures.

### 3. OP721 base class exceeds the 20M gas initialization cap

The full OP721 with all its storage maps, arrays, approval systems, and signature verification consumes more than 20M gas during initialization. This is a protocol-level cap that cannot be increased by the deployer (`gasSatFee` only affects execution gas, not the init limit).

The solution was to extend `OP_NET` directly and implement only the methods opnet-auth-svc needs: `mint`, `balanceOf`, `tokenOfOwnerByIndex`, `ownerOf`, `getAccessData`.

### 4. tsconfig.json extends path

Must be:
```json
{ "extends": "@btc-vision/opnet-transform/std/assembly.json" }
```

Not `@btc-vision/assemblyscript/std/assembly.json` (wrong package).

### 5. asconfig.json working configuration

```json
{
    "targets": {
        "release": {
            "outFile": "build/AccessCredentialNFT.wasm",
            "textFile": "build/AccessCredentialNFT.wat"
        }
    },
    "options": {
        "transform": "@btc-vision/opnet-transform",
        "sourceMap": false,
        "optimizeLevel": 3,
        "shrinkLevel": 2,
        "converge": false,
        "noAssert": false,
        "runtime": "stub",
        "exportRuntime": true,
        "exportStart": "start",
        "memoryBase": 0,
        "initialMemory": 1,
        "use": ["abort=assembly/index/abort"]
    }
}
```

Do not add WASM feature flags (`simd`, `reference-types`, `multi-value`, etc.) unless you know the OPNet runtime supports them.

### 6. Public regtest mines blocks slowly

Blocks on `regtest.opnet.org` mine every 2-5 minutes. Transactions broadcast successfully (9 peers) but are not queryable until included in a block. Plan for this delay in testing.

### 7. Method selectors are SHA256, not Keccak256

OPNet uses the first 4 bytes of SHA256 of the method signature. The build output logs these:

| Method | Selector |
|--------|----------|
| `mint(address,string,string)` | `0xa89ce876` |
| `balanceOf(address)` | `0x5b46f8f6` |
| `tokenOfOwnerByIndex(address,uint256)` | `0x489f3960` |
| `ownerOf(uint256)` | `0x06f6d69b` |
| `getAccessData(uint256)` | `0x77c265de` |

### 8. btc_call response format

The `result` field in `btc_call` responses is base64-encoded (not hex). The `properties` field in the opnet JS client contains decoded return values.

### 9. Contract addresses use P2OP bech32 format

Deployed contracts get addresses like `opr1sqqugfpqp9jzhd7s0vnqer49cpeqh6nsey5p9ky7h`. This is the format used in config files and RPC calls.

---

## Current Deployment (Regtest)

```
Contract: opr1sqqugfpqp9jzhd7s0vnqer49cpeqh6nsey5p9ky7h
Deployer: bcrt1pla3gltr0wn0x3p7wacg4sk8etxzsz9qvga2ytflvmnhqh3wr7zds5v37sh
Block: 35456
Token #1: minted to deployer with test data
```
