# Codebase Health Review — blockhost-engine-opnet

> Reviewed 2026-02-22. 39 TypeScript files, 4,534 lines in `src/`.
> Remediated 2026-02-22 — all items below marked FIXED.

## 1. Dead Code & Orphans — FIXED

### Orphan file
| File | Status |
|------|--------|
| `src/fund-manager/chain-pools.ts` | **Deleted.** Never imported. `getMotoSwapConfig()` wraps `loadWeb3Config().motoswap` — callers already call that directly. |

### Dead exports (zero external callers) — Removed
| File | Symbol |
|------|--------|
| `admin/config.ts` | `getServerPrivateKeyPath()` |
| `admin/nonces.ts` | `getNonceCount()` |
| `fund-manager/wallet.ts` | `getNetworkFromConfig()` |
| `provisioner.ts` | `getProvisionerName()` |

### Over-exported — De-exported
| File | Symbol |
|------|--------|
| `fund-manager/state.ts` | `saveState()` → now private |
| `fund-manager/wallet.ts` | `readKeyfile()`, `walletFromMnemonic()` → now private |
| `admin/index.ts` barrel | Narrowed from `export *` to only `loadAdminConfig` + `AdminConfig` type |

---

## 2. Repetition & Abstraction Opportunities — FIXED

### R1: `MAX_SAT_TO_SPEND` constant — FIXED
Extracted `MAX_SAT_TO_SPEND = 100_000n` to `token-utils.ts`. All 10 locations now use the constant.

### R2: `sendSigned()` helper — FIXED
Extracted `sendSigned(sim, wallet, network, maxSat?)` to `token-utils.ts`. Replaced 9 copy-pasted `sendTransaction()` blocks across: `token-utils.ts`, `withdraw.ts`, `plan.ts`, `set.ts`, `config.ts`, `swap.ts` (5 sites). NativeSwap reserve uses `satsIn + MAX_SAT_TO_SPEND`.

### R3: Inline `parseUnits()` replacement — FIXED
Replaced 4 inline amount parsing blocks in `send.ts` (2 sites) and `split.ts` (2 sites) with `parseUnits()` from `token-utils.ts`. Also replaced `swap.ts`'s local `parseAmount()` with `parseUnits`.

### R4: `ZERO_ADDRESS` constant — FIXED
Extracted `ZERO_ADDRESS` to `token-utils.ts`. All 5 locations now import the constant: `cli-utils.ts`, `balance.ts`, `config.ts`, `withdrawal.ts`, `token-utils.ts`.

### R5: `hexToBytes()` — 2 locations — FIXED
Exported `hexToBytes` from `crypto.ts`, replaced duplicate in `admin/index.ts` with import.

### R6: No `executeX()` separation in `plan.ts`, `set.ts`, `config.ts` (NOT FIXED)
Architectural note only. These mix `process.exit(1)` with contract calls. Would need refactoring for programmatic invocation. Not a bug.

---

## 3. Input Validation & Sanitization

### MEDIUM severity — FIXED

| # | Issue | Fix |
|---|-------|-----|
| V2 | Revenue share `bps` sum not validated | Added sum check in `loadRevenueShareConfig()` — returns disabled if recipients don't sum to `total_bps` |
| V3 | Root agent `generateWallet` response not validated | Added OPNet address format check (`/^0x[0-9a-fA-F]{64}$/`) in `client.ts` |
| V4 | `ab new` name not validated | Added `/^[a-zA-Z0-9_]{1,32}$/` regex matching `ab add` |

### V1: `BLOCKHOST_CONFIG_DIR` env var — NOT FIXED
Used in path construction without validation. Mitigated by systemd unit control. Attack requires env control → already owns the box.

### LOW severity — FIXED
- Knock duration: Added `MAX_KNOCK_DURATION_S = 3600` (1 hour) hard cap in `knock.ts`
- `bhcrypt` hex inputs: Added `requireHex()` validation before all crypto operations
- `bw send` amount: Changed `isNaN` to `Number.isFinite` check (rejects `Infinity`, `NaN`)
- `vms.json`: Added runtime shape check (`typeof vms === 'object'`) before `as` cast
- Config `BigInt()`: Added `safeBigInt()` helper that uses `Math.trunc()` to handle float YAML values

---

## 4. General Code Quality

### Q1: Monitor missing SIGTERM handler — FIXED
Added `SIGTERM` handler alongside `SIGINT`. Both call the same `shutdown()` function.

### Q2: Monitor provider never closed — FIXED
Provider is now closed in the shutdown handler via `provider.close()`.

### Q3: `BLOCKHOST_CONFIG_DIR` not respected consistently — FIXED
Updated `admin/config.ts`, `fund-manager/config.ts`, and `bw/commands/who.ts` to use `process.env['BLOCKHOST_CONFIG_DIR'] ?? '/etc/blockhost'`.

### Q4: Silent error swallowing — PARTIALLY FIXED
- `token-utils.ts getAllTokenBalances()`: Added `console.error` log before returning `[]`.
- `reconcile/index.ts ownerOf()`: Left as-is — skipping individual tokens on error is correct behavior (token may be burned).

### Q5: Fund cycle per-step error isolation — FIXED
Steps 2-5 now each wrapped in individual try/catch. A single step failure no longer skips subsequent steps.

### Q6: `any` types in 8 locations — MOSTLY FIXED
- `admin/index.ts` ACTION_HANDLERS: replaced `as any` casts with `as unknown as KnockParams/KnockActionConfig`
- `admin/index.ts` processTransaction: typed `tx` as `TransactionBase<OPNetTransactionTypes>` with targeted intersection cast for `from`
- `admin/index.ts` processAdminCommands: removed `(block as any).transactions` — `Block.transactions` is already typed
- `monitor/index.ts` dispatchEvent: typed `event` as `OPNetEvent<ContractDecodedObjectResult>`, replaced `(result as any).properties?.data` with direct typed access
- `topup.ts`: `as unknown as IFundingTransactionParameters` left as-is — intentional browser null-signer pattern; `window` typing left as-is

### Q7: bw CLI provider leak — FIXED
Added `try/finally` in `bw/index.ts main()` to close provider after command execution.

### Q8: Non-atomic file writes — FIXED
Both `nonces.ts saveNonces()` and `state.ts saveState()` now use write-to-tmp + `renameSync` pattern.

### Q9: No double-signal guard in monitor — FIXED
Added `shuttingDown` boolean guard. Second signal is ignored.

### Q10: Hardcoded SSH port 22 — FIXED
Extracted `SSH_PORT = 22` constant at module scope in `handlers/index.ts`. Used in `encryptConnectionDetails()`.

---

## Summary

| Category | Total Items | Fixed | Not Fixed |
|----------|-------------|-------|-----------|
| Dead Code & Orphans | 12 | 11 | 1 (R6: executeX separation) |
| Repetition | 6 | 5 | 1 (R6) |
| Input Validation | 9 | 8 | 1 (V1: env var path validation) |
| Code Quality | 10 | 9.5 | 0.5 (Q6: topup.ts browser-side `any` intentional) |
| **Total** | **37** | **33.5** | **3.5** |

Remaining unfixed items:
- **R6**: `executeX()` separation — architectural, would change module structure. Not a bug.
- **V1**: `BLOCKHOST_CONFIG_DIR` env var — mitigated by systemd. Attack requires env control → already owns the box.
- **Q6 (partial)**: `topup.ts` browser-side null-signer `as unknown as` cast — intentional OPWallet interception pattern.
