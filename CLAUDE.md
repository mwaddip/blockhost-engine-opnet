# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## SPECIAL.md (HIGHEST PRIORITY)

**Read and internalize `SPECIAL.md` at the start of every session.** It defines the S.P.E.C.I.A.L. analytical bias system — per-component attention weights that affect how you approach code. Apply the matching component profile based on which files you're working on:

| Path pattern | Profile | Key biases |
|---|---|---|
| `src/root-agent/` | S8 P10 E7 C4 I8 A6 L7 | Security obsessive. Mirrors the root agent daemon. |
| `src/fund-manager/` | S8 P8 E8 C5 I7 A6 L9 | Money + timing = max edge case paranoia. |
| `src/bw/` | S8 P7 E6 C7 I6 A6 L7 | User-facing wallet ops. Funds at stake. |
| `src/ab/` | S6 P6 E5 C7 I6 A5 L5 | Simple CRUD. Don't overthink it. |
| `src/is/` | S7 P7 E5 C7 I6 A7 L5 | Simple queries. Exit codes matter. |
| `src/auth-svc/` | S7 P9 E8 C5 I7 A7 L7 | Auth boundary. Must not crash, must not leak. |
| everything else | S7 P7 E8 C5 I9 A7 L8 | Architectural discipline is survival. |

These stats override your default attention distribution. High stats (8+) mean obsessive focus on that dimension. See `SPECIAL.md` for full definitions.

## Interface Contracts (REFERENCE)

**Contract specs define how this package interfaces with the rest of the system.** Read and internalize the relevant contract before modifying provisioner dispatch, VM lifecycle handlers, or any code that calls blockhost-common functions. Do not rely on assumptions — read the contract.

| Contract | Covers | Read when... |
|----------|--------|-------------|
| `facts/PROVISIONER_INTERFACE.md` | The provisioner contract — CLI commands dispatched by this engine, JSON output formats, manifest schema | Changing provisioner dispatch, parsing VM create output, adding new provisioner verbs |
| `facts/COMMON_INTERFACE.md` | blockhost-common's public API — config, vm_db, root_agent | Using any import from `blockhost.*` or reading config files |
| `facts/ENGINE_INTERFACE.md` | Engine interface — CLIs, contract ABI, monitor, fund manager, wizard plugin | Adding engine CLIs, modifying wizard plugin exports, changing config file schemas |

**The engine is a consumer of both contracts.** It dispatches to provisioner CLI commands (via manifest) and imports from common. If either contract changes, engine code may need updating.

## Interface Integrity (PERSISTENT RULE)

**When interfaces don't match, fix the interface — never wrap the mismatch.** If the provisioner's JSON output doesn't match what you expect, the contract needs updating — don't add parsing hacks.

## Rules

- **Documentation sync**: After completing any code change, check whether `README.md` or `CLAUDE.md` need updating to reflect the change. This includes new modules, changed APIs, new CLI commands, new configuration options, changed architecture, and new dependencies. Update the relevant docs before considering the task done.

## Project Overview

blockhost-engine is the core component of a hosting subscription management system. It consists of:

1. **OPNet Smart Contract** (AssemblyScript) - Handles subscription purchases and extensions on Bitcoin L1
2. **Monitor Server** (TypeScript) - Watches the smart contract for events and triggers actions
3. **Maintenance Scheduler** - Manages subscription lifecycle (suspend/destroy expired subscriptions)
4. **Fund Manager** (TypeScript) - Automated fund withdrawal, revenue sharing, and gas management
5. **bw CLI** (TypeScript) - Scriptable wallet operations (`bw send`, `bw balance`, `bw withdraw`, `bw swap`, `bw split`, `bw who`, `bw config`, `bw plan`, `bw set`)
6. **ab CLI** (TypeScript) - Addressbook management (`ab add`, `ab del`, `ab up`, `ab new`, `ab list`, `ab --init`)
7. **is CLI** (TypeScript) - Identity predicate (`is <wallet> <nft_id>`, `is <signature> <wallet>`, `is contract <address>`)
8. **NFT Minting** (TypeScript) - `blockhost-mint-nft` CLI, mints access credential NFTs on OPNet (2-param: `--owner-wallet`, `--user-encrypted`)
9. **Root Agent Client** (TypeScript) - Privilege separation client for the root agent daemon (iptables, key writes, addressbook saves)
10. **Contract Deployer** (Bash) - `blockhost-deploy-contracts` script for production contract deployment
11. **Installer Wizard Plugin** (Python) - `blockhost/engine_opnet/wizard.py`, provides the blockchain configuration wizard page, API routes, and finalization steps to the installer
12. **Engine Manifest** (`engine.json`) - Declares engine identity, wizard plugin, finalization steps, and `constraints` (chain-specific format patterns for input validation by installer/admin panel)
13. **Auth Service** (TypeScript) - `web3-auth-svc`, HTTPS signing server esbuild-bundled JS with node wrapper. Ships as a template package for VMs.

VM provisioning is handled by the separate `blockhost-provisioner-proxmox` package.
Shared configuration is provided by `blockhost-common`.

## Build Commands

```bash
npm install              # Install dependencies
npx tsc --noEmit         # Type-check TypeScript
npm run monitor          # Run event monitor
```

## Architecture

```
blockhost-engine-opnet/
├── blockhost/engine_opnet/ # Installer wizard plugin (Python)
│   ├── wizard.py           # Blueprint, API routes, finalization steps
│   └── templates/engine_opnet/  # blockchain.html, summary_section.html
├── engine.json           # Engine manifest (discovered by installer at /usr/share/blockhost/)
├── scripts/             # Deployment, minting, and utility scripts
│   ├── mint_nft.py      # NFT minting (installed as blockhost-mint-nft)
│   ├── deploy-contracts.sh  # Production contract deployer (installed as blockhost-deploy-contracts)
├── src/                 # TypeScript server source
│   ├── monitor/         # Contract event polling & OPNet block scanning
│   ├── handlers/        # Event handlers (NFT reservation, provisioner dispatch, NFT minting)
│   ├── admin/           # On-chain admin commands (HMAC OP_RETURN, anti-replay)
│   ├── reconcile/       # Periodic NFT state reconciliation
│   ├── fund-manager/    # Automated fund withdrawal, distribution & gas management
│   ├── crypto.ts        # Native ECIES decrypt + SHAKE256 symmetric encrypt (replaces pam_web3_tool)
│   ├── bw/              # blockwallet CLI (send, balance, withdraw, swap, split, who, config, plan, set)
│   ├── ab/              # addressbook CLI (add, del, up, new, list, --init)
│   ├── is/              # identity predicate CLI (NFT ownership, signature, contract checks)
│   ├── auth-svc/        # Web3 auth signing server (esbuild-bundled for VMs)
│   └── root-agent/      # Root agent client (Unix socket, privilege separation)
├── auth-svc/            # Auth service assets
│   └── signing-page/    # Signing page HTML (served by auth-svc on VMs)
└── examples/            # Deployment examples (systemd, env, config)
```

### VM Naming Convention

VMs are named based on subscription ID: `blockhost-001`, `blockhost-042`, etc. (3-digit zero-padded).

## Smart Contract (OPNet AssemblyScript)

BlockhostSubscriptions is an OPNet smart contract (AssemblyScript → WASM) deployed on Bitcoin L1.

### Key Concepts

- **Plans**: Subscription tiers with USD-denominated pricing (in cents per day)
- **Subscriptions**: User subscriptions with expiration timestamps
- **Payment Token**: Single OP_20 stablecoin configured via `setPaymentToken()`

### Events (for server monitoring)

- `PlanCreated`, `PlanUpdated` - Plan lifecycle
- `SubscriptionCreated`, `SubscriptionExtended`, `SubscriptionCancelled` - Subscription lifecycle
- `AcceptingSubscriptionsChanged` - Admin toggle

### Server Helper Functions

- `getSubscriptionsBySubscriber(address)` - User subscription lookup
- `isSubscriptionActive(subscriptionId)` - Quick status check
- `getPaymentToken()` - Current payment token address
- `withdrawFunds(token, amount, to)` - Owner withdrawal

### Contract ABIs

OPNet ABIs are defined in `src/fund-manager/contract-abis.ts`:
- `BLOCKHOST_SUBSCRIPTIONS_ABI` / `IBlockhostSubscriptions` — subscription contract
- `ACCESS_CREDENTIAL_NFT_ABI` / `IAccessCredentialNFT` — NFT contract

### Blockchain Interaction

The engine uses the `opnet` package (NOT ethers.js) for all blockchain interaction:
- `JSONRpcProvider` for RPC queries
- `getContract<T>()` for typed contract instances
- Block scanning via `provider.getBlock()` + transaction iteration
- Event decoding from `tx.events` / `tx.receipt.events`
- Balance queries: `provider.getBalance(address, true)` returns `bigint` (satoshis)

### Crypto Module (`src/crypto.ts`)

Native crypto replacing `pam_web3_tool` CLI:
- `eciesDecrypt()` — secp256k1 ECDH + HKDF-SHA256 + AES-256-GCM. Wire: `ephemeralPub(65) + IV(12) + ciphertext+tag`
- `symmetricEncrypt()` — SHAKE256 key derivation + AES-256-GCM. Wire: `IV(12) + ciphertext+tag`
- `loadServerPrivateKey()` — reads `/etc/blockhost/server.key`
- Uses `@noble/curves/secp256k1`, `@noble/hashes` (sha256, sha3, hkdf), `node:crypto`

## Reconciler (`src/reconcile/`)

Runs every 5 minutes as part of the monitor polling loop. Performs two categories of checks:

### NFT Minting Reconciliation

Detects discrepancies between on-chain NFT state and local `vms.json`. Fixes partial failures where a VM was created but the NFT mint wasn't recorded locally.

### NFT Ownership Transfer Detection

For every active/suspended VM with a minted NFT, compares `ownerOf(tokenId)` on-chain with the locally stored `owner_wallet`. When a transfer is detected:

1. Updates `owner_wallet` in `vms.json` to the new on-chain owner
2. Sets `gecos_synced = false` on the VM entry
3. Calls the provisioner's `update-gecos` command to update the VM's GECOS field (`wallet=ADDRESS,nft=TOKEN_ID`)
4. On success, sets `gecos_synced = true`

If `update-gecos` fails (VM stopped, guest agent unresponsive), the `gecos_synced = false` flag persists. On the next reconciliation cycle, the ownership matches (local was already updated), but `gecos_synced === false` triggers a retry.

This is the sole mechanism by which VMs learn about NFT ownership changes post-creation. The PAM module on VMs authenticates against the GECOS field, not the blockchain.

### Provisioner Command

```
getCommand("update-gecos") <vm-name> <wallet-address> --nft-id <token_id>
```

Exit 0 = GECOS updated. Exit 1 = failed (retried next cycle).

## Fund Manager

Integrated into the monitor polling loop. Runs two periodic tasks:

### Fund Cycle (every 24h, configurable)

1. **Withdraw** — If payment token balance > min threshold, call `withdrawFunds()` to move tokens from contract to hot wallet
2. **Hot wallet gas** — Server sends BTC to hot wallet if below `hot_wallet_gas_sats` (default 100,000 sats)
3. **Server stablecoin buffer** — Hot wallet sends stablecoin to server if below `server_stablecoin_buffer_sats`
4. **Revenue shares** — If enabled in `revenue-share.json`, distribute configured % to dev/broker
5. **Remainder to admin** — Send all remaining hot wallet token balances to admin

### Gas Check (every 30min, configurable)

- Top up hot wallet BTC from server if below threshold
- Check server wallet BTC balance; warn if below `gas_low_threshold_sats`
- NativeSwap integration for stablecoin→BTC swaps is deferred (requires two-phase commit across blocks)

### Hot Wallet

Auto-generated on first fund cycle if not in addressbook. Private key saved to `/etc/blockhost/hot.key` (chmod 600). Acts as an intermediary for distribution — contract funds flow through it before going to recipients.

### Configuration

**`/etc/blockhost/blockhost.yaml`** — under `fund_manager:` key:

| Setting | Default | Description |
|---|---|---|
| `fund_cycle_interval_hours` | 24 | Hours between fund cycles |
| `gas_check_interval_minutes` | 30 | Minutes between gas checks |
| `min_withdrawal_sats` | 50,000 | Minimum token amount (base units) to trigger withdrawal |
| `gas_low_threshold_sats` | 10,000 | Server BTC balance (sats) that triggers a warning |
| `gas_swap_amount_sats` | 50,000 | Amount (sats) for future NativeSwap gas top-up |
| `server_stablecoin_buffer_sats` | 5,000,000 | Target stablecoin balance (base units) for server wallet |
| `hot_wallet_gas_sats` | 100,000 | Target BTC balance (sats) for hot wallet |

**`/etc/blockhost/addressbook.json`** — role-to-wallet mapping (written by installer):

```json
{
  "admin":  { "address": "0x..." },
  "server": { "address": "0x...", "keyfile": "/etc/blockhost/deployer.key" },
  "dev":    { "address": "0x..." },
  "broker": { "address": "0x..." }
}
```

Entries with `keyfile` can sign transactions. The `hot` entry is auto-added on first launch.

**`/etc/blockhost/revenue-share.json`** — revenue sharing config:

```json
{
  "enabled": true,
  "total_percent": 1.0,
  "recipients": [
    { "role": "dev", "percent": 0.5 },
    { "role": "broker", "percent": 0.5 }
  ]
}
```

`recipients[].role` maps to addressbook keys (never contains addresses directly).

## bw (blockwallet) CLI

Standalone CLI for scriptable wallet operations. Reads config from `web3-defaults.yaml`.

```bash
bw send <amount> <token> <from> <to>       # Send tokens between wallets
bw balance <role> [token]                   # Show wallet balances
bw split <amount> <token> <ratios> <from> <to1> <to2> ...  # Split tokens
bw withdraw [token] <to>                    # Withdraw from contract
bw swap <amount> <from-token> btc <wallet>  # Swap token for BTC via MotoSwap/NativeSwap
bw who <identifier>                        # Query NFT owner by token ID or 'admin'
bw who <message> <signature>               # Recover signer address from signature
bw config stable [address]                 # Get/set primary stablecoin on contract
bw plan create <name> <price>              # Create subscription plan (price in cents/day)
bw set encrypt <nft_id> <data>             # Update NFT userEncrypted field
bw --debug --cleanup <address>             # Sweep all testnet ETH to address
```

- **Token shortcuts**: `btc` (native), `stable` (contract's payment token), or `0x` address
- **Roles**: `admin`, `server`, `hot`, `dev`, `broker` (resolved from addressbook.json)
- **Signing**: Only roles with `keyfile` in addressbook can be used as `<from>`/`<wallet>`
- **`who`**: Queries `ownerOf(tokenId)` on the AccessCredentialNFT contract. Accepts a numeric token ID or `admin` (reads `admin.credential_nft_id` from `blockhost.yaml`). Config from `web3-defaults.yaml` (`nft_contract`, `rpc_url`) — no env vars or addressbook needed.
- **`config stable`**: No arg reads current primary stablecoin address from contract; with arg calls `setPrimaryStablecoin()` (owner-only).
- **`plan create`**: Creates a subscription plan on contract, prints the plan ID from the `PlanCreated` event.
- **`set encrypt`**: Calls `updateUserEncrypted(tokenId, bytes)` on the NFT contract. NFT contract address from `web3-defaults.yaml`.
- **`--cleanup`**: Debug utility — sweeps BTC from every signing wallet back to a single address. Requires `--debug` flag as a safety guard. Skips wallets that are the target or have insufficient balance for gas.

The fund-manager module imports `executeSend()`, `executeWithdraw()`, and `executeSwap()` from the bw command modules directly — all wallet operations flow through the same code paths.

## ab (addressbook) CLI

Standalone CLI for managing wallet entries in `/etc/blockhost/addressbook.json`. No RPC or contract env vars required — purely local filesystem operations.

```bash
ab add <name> <0xaddress>    # Add new entry
ab del <name>                # Delete entry
ab up <name> <0xaddress>     # Update entry's address
ab new <name>                # Generate new wallet, save key, add to addressbook
ab list                      # Show all entries
ab --init <admin> <server> [dev] [broker] <keyfile>  # Bootstrap addressbook
```

- **Immutable roles**: `server`, `admin`, `hot`, `dev`, `broker` — cannot be added, deleted, updated, or generated via `ab`
- **`ab new`**: Generates a keypair, saves private key to `/etc/blockhost/<name>.key` (chmod 600), same pattern as hot wallet generation
- **`ab up`**: Only changes the address; preserves existing `keyfile` if present
- **`ab del`**: Removes the entry from JSON but does NOT delete the keyfile (if any)
- **`ab --init`**: Bootstrap addressbook for fresh installs. Positional args: admin address, server address, optionally dev and broker addresses, then server keyfile (always last). Fails if addressbook already has entries.

## is (identity predicate) CLI

Standalone binary. Exit 0 = yes, 1 = no. No env vars or addressbook needed — config from `web3-defaults.yaml` (`rpc_url`, `nft_contract`).

```bash
is <wallet> <nft_id>         # Does wallet own NFT token?
is contract <address>        # Does a contract exist at address?
```

Arguments are order-independent, disambiguated by type: address = `0x` + 64 hex chars (32-byte OPNet address), NFT ID = integer, `contract` = literal keyword.

## blockhost-deploy-contracts

Bash script for production contract deployment. Reads deployer key from `/etc/blockhost/deployer.key` and RPC URL from `web3-defaults.yaml`.

```bash
blockhost-deploy-contracts          # deploy both (NFT first, then subscription)
blockhost-deploy-contracts nft      # deploy NFT contract only
blockhost-deploy-contracts pos      # deploy subscription contract only
```

Uses pre-compiled ABI/bytecode + `cast send --create` when available, falls back to `forge create`. Prints contract address(es) to stdout, one per line.

## Privilege Separation (Root Agent)

The monitor and CLIs run as the unprivileged `blockhost` user. Privileged operations are delegated to a root agent daemon (from `blockhost-common`) via Unix socket at `/run/blockhost/root-agent.sock`.

### Protocol

Length-prefixed JSON: 4-byte big-endian length + JSON payload (both directions).
- Request: `{"action": "action-name", "params": {...}}`
- Response: `{"ok": true, ...}` or `{"ok": false, "error": "reason"}`

### Client (`src/root-agent/client.ts`)

- `callRootAgent(action, params, timeout)` — generic call
- `iptablesOpen(port, proto?, comment?)` / `iptablesClose(...)` — firewall rules (used by knock handler)
- `generateWallet(name)` — key generation + addressbook update (used by fund-manager hot wallet, `ab new`)
- `addressbookSave(entries)` — write addressbook.json (used by `ab add/del/up`, fund-manager)
- `qmStart(vmid)` — start a Proxmox VM

### What does NOT go through the root agent

- Reading keyfiles and addressbook.json — works via group permission (`blockhost` group, mode 0640)
- ECIES decryption (native `src/crypto.ts`) — `blockhost` user can read `server.key` via group permission
- VM provisioning scripts — provisioner runs as `blockhost`
- Process checks (`pgrep`) — no privilege needed
