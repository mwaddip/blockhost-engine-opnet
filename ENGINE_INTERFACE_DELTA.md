# ENGINE_INTERFACE.md — Delta from OPNet Engine

> Boundary changes identified in the OPNet engine that must be synced
> to `facts/ENGINE_INTERFACE.md` before the suite merges to master.
> Each item references the spec section it affects.

---

## 1. `bw swap` signature (spec §1, line 145)

**Current spec:** `bw swap <amount> <from-token> eth <wallet>`
**New spec:** `bw swap <amount> <from-token> <to-token> <wallet>`

Third arg changes from literal `eth` to a free `<to-token>` parameter, enabling
bidirectional swaps and token-to-token swaps. Both engines must implement this
at merge time. EVM engine currently only supports `token → ETH`.

## 2. New engine setting: `native_token` (spec §1, new)

Engines must export a `native_token` setting (in `engine.json` manifest) declaring
the shortcut name for the chain's gas token. External consumers (admin panel,
installer, provisioner) use this string when shelling out to `bw` commands.

| Engine | `native_token` |
|--------|---------------|
| EVM    | `eth`         |
| OPNet  | `btc`         |

The token shortcuts table (spec §1, line 256) becomes:

| Shortcut | Resolves to |
|----------|-------------|
| `<native_token>` | Chain's native gas token |
| `stable` | Contract's primary stablecoin |
| `0x...` | Literal token address |

## 3. `web3-defaults.yaml` schema expanded (spec §6, line 795)

New required keys under `blockchain:`:
- `subscriptions_contract` — subscription contract address (was `BLOCKHOST_CONTRACT` env var on EVM)
- `payment_token` — primary stablecoin address

New optional sections:
- `motoswap.router`, `motoswap.factory` — OP20-to-OP20 AMM (OPNet-specific)
- `native_swap` — BTC-to-OP20 DEX contract address (OPNet-specific)

Missing from OPNet variant:
- `chain_id` — OPNet infers network from RPC URL, not chain IDs

These are chain-specific sections. The spec should note that each engine may add
its own DEX/infrastructure keys under `web3-defaults.yaml`.

## 4. Address format: 20 bytes → 32 bytes (spec §1, line 25)

**Current spec:** "addresses are `0x` + 40 hex" (20-byte EVM addresses)
**OPNet:** `0x` + 64 hex (32-byte internal addresses)

Affects every external component that validates, displays, or stores addresses:
admin panel input validation, installer wizard fields, addressbook entries,
`engine.json` constraints patterns.

The spec should define address format as engine-specific. The `engine.json`
manifest already has a `constraints` section for format patterns — this is the
mechanism for communicating address format to the installer/admin panel.

## 5. `FundManagerConfig` units (spec §4, line 669)

**Current spec (EVM):**
```yaml
fund_manager:
  min_withdrawal_usd: 50
  gas_low_threshold_usd: 5
  gas_swap_amount_usd: 20
  server_stablecoin_buffer_usd: 50
  hot_wallet_gas_eth: 0.01
```

**OPNet:**
```yaml
fund_manager:
  min_withdrawal_sats: 500000
  gas_low_threshold_sats: 50000
  gas_swap_amount_sats: 200000
  server_stablecoin_buffer_sats: 5000000
  hot_wallet_gas_sats: 100000
```

Units changed from USD/ETH to sats. Key names changed (`_usd` → `_sats`,
`_eth` → `_sats`). The spec should note that fund manager config keys are
engine-specific — each engine defines its own denomination and thresholds.

## 6. DEX integration moved to config (spec §4, line 684)

**Current spec:** Hardcoded `ChainConfig` per chain ID (router, weth, usdc, pair)
**OPNet:** DEX addresses read from `web3-defaults.yaml` (`motoswap`, `native_swap`)

The hardcoded chain-pools approach is EVM-specific. The spec should note that
DEX configuration is engine-owned and may come from either code or config files.

---

## Items explicitly NOT boundary changes

- **CLI arg counts/positions** for `send`, `balance`, `withdraw`, `split`,
  `who`, `config stable`, `plan create`, `set encrypt` — unchanged.
- **`ab` commands** — all signatures unchanged.
- **`is` commands** — signatures unchanged.
- **Exit code convention** — still 0 = success, 1 = failure.
- **Addressbook JSON shape** — still `{ address, keyfile? }`.
- **Smart contract abstract functions** — same method semantics.
- **Monitor event names and handler pattern** — unchanged.
- **`.env` consumption** — integration concern, will surface at plug-in time.
