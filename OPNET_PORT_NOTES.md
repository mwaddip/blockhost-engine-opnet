# BlockHost OPNet Port — Conclusions

## Scope of OPNet-Specific Work

Three things to build:

1. **AssemblyScript contracts** (4 contracts, same logical interface as Solidity)
2. **blockhost-engine-opnet** (implements the engine interface)
3. **libpam-web3-opnet** (standalone PAM auth against OPNet)

Everything else (provisioner, GC, admin panel, installer) talks to the engine interface and stays chain-agnostic.

## Architecture

```
blockhost-provisioner ──┐
blockhost-gc ───────────┤
blockhost-admin ────────┤
                        ▼
              blockhost-engine (interface)
               ┌────────┴────────┐
    engine-evm                engine-opnet


Guest VMs (completely separate):
    libpam-web3  or  libpam-web3-opnet
```

- The engine is the blockchain boundary. It was already the natural adapter — formalizing it as the interface requires no extra components or layers.
- libpam-web3 runs on guest VMs, independently verifies NFT ownership at SSH time. Shares the same NFT contract on-chain but never talks to the engine.
- The signup page remains chain-specific by nature (MetaMask vs OPWallet).

## Contract Simplifications for OPNet

### AccessCredentialNFT → OP_721
- **Only two fields matter per token: `userEncrypted` and `publicSecret`.**
- Drop `tokenURI()` on-chain builder — was doing JSON assembly + Base64 encoding. Store raw fields, retrieve via getters, assemble metadata off-chain if needed.
- Drop `animationUrlBase64` — the embedded signing page was a gimmick (MetaMask won't connect to file:// resources, ECIES requires HTTPS, so hosting was required anyway). Was 15k payload per mint.
- Drop `mintBatch` — unused.
- Drop `imageUri`, `description` — presentation only, not needed on-chain.
- Result: trivial contract. OP_721 + two stored fields + mint + getter.

### BlockhostSubscriptions → OP_NET
- Core plan/subscription CRUD ports cleanly.
- Subscription iteration loops (`getExpiredSubscriptions`, `getSubscriptionsExpiringSoon`) were dead code and have been removed from the Solidity contract.
- Can simplify to BTC-only payments, but MotoSwap stablecoin pair pricing is still useful for dollar-denominated plans.
- Uniswap V2 `getReserves()` → MotoSwap pool interface. Same constant-product math, different interface.
- `Ownable` → manual owner pattern.
- `ReentrancyGuard` → manual flag or rely on OPNet execution model.
- `SafeERC20` → direct OP_20 calls (no non-standard return value problem on OPNet).
- All arithmetic wrapped in SafeMath (u256).

### BrokerRegistry → OP_NET
- Straightforward port. Simple CRUD with owner-only admin.
- `Broker[]` array → indexed storage with counter.
- `mapping(address => uint256)` → `StoredMap<Address, u256>`.
- No blockers.

### BrokerRequests → OP_NET
- Core request/response pattern ports fine.
- Drop `_isContract()` (uses `extcodesize` — no equivalent on OPNet).
- Drop `_isERC721()` (uses ERC165 `supportsInterface` + try/catch — neither exists on OPNet).
- Drop `_isOwner()` (uses arbitrary staticcall with `abi.encodeWithSignature`).
- Invalid entries can simply be ignored by the blockchain monitor process. Trust-based validation is impossible since anyone can be an instance needing a broker, but the off-chain monitor filters.

## EVM Features Without OPNet Equivalents

| EVM Feature | Where Used | Resolution |
|---|---|---|
| `extcodesize` | BrokerRequests | Drop — monitor filters invalid entries |
| ERC165 `supportsInterface` | BrokerRequests | Drop — monitor filters |
| `try/catch` | BrokerRequests | Drop — monitor filters |
| `abi.encodePacked` | AccessCredentialNFT tokenURI | Dropped — tokenURI moved off-chain |
| `Base64.encode` | AccessCredentialNFT tokenURI | Dropped — no longer needed |
| OpenZeppelin `Ownable` | All contracts | Manual owner StoredAddress + checks |
| OpenZeppelin `ReentrancyGuard` | Subscriptions | Manual flag or OPNet execution model |
| `SafeERC20` | Subscriptions | Direct OP_20 calls |
| Uniswap V2 pair interface | Subscriptions | MotoSwap pool interface |

## Off-Chain Adapter Considerations

### Chain Constants the Adapter Supplies
- **`blockTime`** — ~12s (EVM) vs ~10min (Bitcoin). Ripples through:
  - Monitor poll interval (no point polling every 15s on Bitcoin)
  - Admin `max_command_age` (300s = ~25 ETH blocks but barely 1 BTC block)
  - BrokerRequests expiration precision
  - Fund manager retry/verification timing
- **Confirmation depth** — how many blocks before a tx is considered final
- **Fee model** — EVM gas price vs Bitcoin fee rate
- **Address format** — single 20-byte (EVM) vs mldsaHash + tweakedPubkey (OPNet)

### OPNet-Specific Transaction Flow
- Every write is simulate-then-send. The adapter internalizes this.
- `signer = wallet.keypair, mldsaSigner = wallet.mldsaKeypair` for backend signing.
- Method selectors are SHA256 first 4 bytes, not Keccak256.

### Token Interactions
- EVM `approve()` → OPNet `increaseAllowance()` / `decreaseAllowance()`

## Engine Interface (Defined)

The engine interface is formalized in `blockhost-facts/ENGINE_INTERFACE.md` (repo: `github.com/mwaddip/blockhost-facts`).

### CLI Commands to Implement

| Command | Purpose | OPNet Notes |
|---------|---------|-------------|
| `is <sig> <wallet>` | Verify signature | OPNet signature verification against Bitcoin/ML-DSA keys |
| `is <wallet> <nft_id>` | Check NFT ownership | `ownerOf()` on OP_721 via `opnet` package |
| `is contract <address>` | Contract liveness check | Query OPNet contract existence |
| `blockhost-deploy-contracts` | Deploy contracts | Deploy WASM contracts via OPNet; supports `nft`, `pos`, or both |
| `bw send` | Send tokens | OPNet simulate-then-send; BTC native + OP_20 tokens |
| `bw balance` | Check balances | `JSONRpcProvider` queries; also works for NFT contracts |
| `bw split` | Split-send to multiple recipients | Multiple simulate-then-send calls |
| `bw withdraw` | Withdraw contract funds | Contract call via `opnet` package |
| `bw swap` | Swap token → native | Uniswap V2 → MotoSwap or NativeSwap |
| `bw who` | Query NFT owner | `ownerOf()` on OP_721 contract |
| `bw config stable` | Set/get primary stablecoin | `setPrimaryStablecoin()` on subscription contract |
| `bw plan create` | Create subscription plan | `createPlan()` on subscription contract |
| `bw set encrypt` | Update NFT encrypted data | `updateUserEncrypted()` on NFT contract |
| `ab` (addressbook) | Manage wallet roles | Mostly chain-agnostic (file I/O), but `ab new` keygen needs both secp256k1 keypair + ML-DSA keypair |
| `ab --init` | Bootstrap addressbook | Non-interactive wallet bootstrap |
| `blockhost-mint-nft` | Mint credential NFT | Call OP_721 `mint()` via `opnet` |
| `blockhost-generate-signup` | Generate signup HTML | OPNet-specific template (OPWallet instead of MetaMask, different chain params) |

### Monitor Service

- Event polling interval: derive from `blockTime` (~10min for Bitcoin vs 5s for EVM)
- Event handlers: same logic (SubscriptionCreated → create VM + mint NFT, etc.)
- Fund manager: MotoSwap for price discovery / swaps instead of Uniswap V2
- Gas check: BTC fee rate instead of ETH gas price
- Admin commands: ECIES encryption is secp256k1-based — works on both chains

### Package Convention

- Package name: `blockhost-engine-opnet`
- Declares `Conflicts: blockhost-engine` — only one engine per host
- Same file layout as EVM engine (monitor.js, bw.js, ab.js, etc.)
- Same systemd unit structure

### Engine Wizard Plugin

The engine contributes a wizard page + finalization steps to the installer (same plugin pattern as provisioner). Each engine ships its own blockchain config page, deploy logic, signup template, and key generation. The installer is fully chain-agnostic.

For `engine-opnet`, the wizard plugin provides:
- Blockchain config page (OPNet RPC, network selection)
- Finalization steps: keygen (secp256k1 + ML-DSA), contract deployment (WASM), plan creation, NFT mint, signup page generation
- OPNet-specific signup template (OPWallet integration)

### Abstraction Debt Status (from ENGINE_INTERFACE.md §11)

Most EVM leakage has been resolved by new engine CLIs. Remaining open items:

| Issue | Status | Resolution |
|-------|--------|------------|
| `cast` in installer/admin | **RESOLVED** | Replaced by `is`, `bw` subcommands, `blockhost-deploy-contracts` |
| `cast wallet verify` | **RESOLVED** | Replaced by `is <signature> <wallet>` |
| Signup template EVM-specific | **RESOLVED** | Engine wizard plugin ships its own template |
| Key generation uses `eth_keys` | **RESOLVED** | Moves to engine wizard plugin / `ab new` |
| `validate_system.py` uses `cast call` | **RESOLVED** | Replaced by `is contract <address>` |
| `chain-pools.ts` hardcoded DEX addresses | **OPEN** | OPNet equivalent: MotoSwap pool addresses |
| No `BLOCK_TIME` constant | **OPEN** | Engine supplies chain-specific constant |
| `mint_nft.py` dual install path | **OPEN** | Less of a concern with engine wizard plugin (same submodule) |

## Prerequisites Before Implementation

1. ~~Engine interface definition~~ — **DONE** (`facts/ENGINE_INTERFACE.md`)
2. ~~Abstraction debt resolved~~ — **DONE** (new CLIs: `is`, `blockhost-deploy-contracts`, `bw config stable`, `bw plan create`, `bw set encrypt`, `ab --init`; engine wizard plugin planned; `blockhost-init` deprecated)
3. Abstraction implementation — **IN PROGRESS** (EVM side must implement planned CLIs before OPNet engine can be built against the same interface)
4. Contract interface definitions (derived from engine interface §2 + existing Solidity)
5. libpam-web3 interface definition

## Deployment Timing (Bitcoin Block Time)

On EVM the full installer finalization (2 deploys + createPlan + mint NFT) completes in ~12 minutes. On Bitcoin (~10min blocks):

- **Block 1:** Deploy NFT contract + deploy subscription contract + `createPlan` (batched in one tx)
- **Between blocks:** IPv6 broker allocation (needs NFT contract address for the broker request)
- **Block 2:** Mint admin NFT #0 (needs broker allocation result for encrypted connection details)

Minimum ~20 minutes for the on-chain portion. The wizard flow needs a progress indicator rather than a blocking spinner. Still faster than most comparable infrastructure setups.

## Design Decisions Log

### Why the engine is the adapter (not a new abstraction layer)
The engine already sat at the blockchain boundary — every chain interaction flowed through it. The `bw` and `ab` CLIs were originally built as personal convenience tools for console testing, then other components naturally started using them instead of direct `cast` calls. The formalization into an interface just recognized what was already true. No new component needed.

### Why libpam-web3 is separate from the engine
libpam-web3 runs on guest VMs, not the host. It does one thing: verify that the SSH user's wallet owns the NFT granting access to that machine. It shares the NFT contract on-chain with the engine but never communicates with it directly. Two independent implementations: `libpam-web3` (EVM) and `libpam-web3-opnet`.

### Why provisioner abstraction was harder than engine will be
The provisioner was the first component built and other submodules leaked into it — quick fixes to unblock tests that became semi-permanent. The engine was built after that lesson, so it didn't accumulate the same debt. The only real bleed-through is `cast` usage in the installer/admin, which is being resolved by routing everything through engine CLIs.

### Contract simplification rationale
- **tokenURI dropped:** Was building full JSON + Base64 on-chain. The embedded signing page HTML (`animationUrlBase64`) was 15k per mint and couldn't work self-contained anyway — MetaMask refuses `file://` origins and ECIES requires HTTPS. With hosting required regardless, the on-chain signing page was pure overhead.
- **NFT reduced to two fields:** `userEncrypted` (AES-256-GCM encrypted connection details) and `publicSecret` (message user signs to derive decryption key). Everything else was presentation metadata that can live off-chain.
- **BrokerRequests validation dropped:** `_isContract`, `_isERC721`, `_isOwner` all use EVM-specific introspection (extcodesize, ERC165, arbitrary staticcall). Since anyone can be a broker client, trust-based validation is impossible anyway. Invalid entries are filtered by the off-chain monitor.
- **Subscription iteration dropped:** `getExpiredSubscriptions` and `getSubscriptionsExpiringSoon` were dead code — the engine already tracks expiries in its local `vms.json` database.

## Reference: OPNet Contract Rules

- Extend `OP_NET` (or `OP_20` / `OP_721`) from `@btc-vision/btc-runtime`
- SafeMath for ALL u256 operations
- No while loops — bounded `for` loops only
- No iterating all map keys — store aggregates separately
- Storage pointers must be unique — use `Blockchain.nextPointer`
- Constructor runs every interaction — use `onDeployment()` for one-time init
- Method selectors are SHA256 first 4 bytes — use `encodeSelector('methodName')`
- `super.onDeployment()` MUST be called first in onDeployment
