# Smart Contracts

OPNet smart contracts written in AssemblyScript, compiled to WASM, executed deterministically on Bitcoin L1.

## BlockhostSubscriptions

Manages subscription plans and user purchases.

- **Plans** — Subscription tiers with USD pricing (cents/day)
- **Subscriptions** — User subscriptions with block-height-based expiration
- **Payments** — Single OP_20 payment token configured via `setPaymentToken()`

### Key Functions

```typescript
// Admin
createPlan(name, pricePerDay)
setPaymentToken(tokenAddress)

// Users
buySubscription(planId, days, userEncrypted)
extendSubscription(subscriptionId, days)

// Queries
getSubscription(subscriptionId)
isSubscriptionActive(subscriptionId)
```

### Events (for server monitoring)

- `PlanCreated`, `PlanUpdated` — Plan lifecycle
- `SubscriptionCreated`, `SubscriptionExtended`, `SubscriptionCancelled` — Subscription lifecycle
- `AcceptingSubscriptionsChanged` — Admin toggle

## AccessCredentialNFT

VM access credentials as on-chain NFTs.

- **Minting** — 2-param `mint(to, userEncrypted)`, engine owns the full lifecycle
- **Ownership** — `ownerOf()`, `totalSupply()`, `tokenOfOwnerByIndex()`
- **Encrypted data** — `getUserEncrypted()`, `updateUserEncrypted()`

## Contract ABIs

Defined in `src/fund-manager/contract-abis.ts`:

- `BLOCKHOST_SUBSCRIPTIONS_ABI` / `IBlockhostSubscriptions`
- `ACCESS_CREDENTIAL_NFT_ABI` / `IAccessCredentialNFT`

## Building

From the contract directory:

```bash
npx asc src/index.ts --config asconfig.json
```

Output: `build/<ContractName>.wasm` + `abis/<ContractName>.abi.json`
