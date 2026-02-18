# BlockhostSubscriptions — OPNet Contract Interface

## Overview

Subscription management contract for BlockHost on OPNet. Operators create plans priced in an OP20 token, subscribers purchase time-limited access to VMs. The contract holds accumulated payment tokens until the operator withdraws them.

## Design Decisions

- **Single payment token**: One OP20 token configured as the accepted payment. No multi-token, no price conversion, no oracle. Operator re-prices plans if token value shifts.
- **Prices in token units**: Plan prices are denominated in the payment token's smallest unit per day. No USD abstraction.
- **Custodial for OP20**: Payment tokens are transferred to the contract via `transferFrom`. Operator withdraws accumulated balance. (Native BTC cannot be held by contracts.)
- **Global accept flag**: Deployer can close/open the contract for new subscriptions (capacity management). Extensions of existing subscriptions are unaffected.
- **Grace period**: Deployer-configurable `gracePeriod` (in days). Expired subscriptions can be extended up to `gracePeriod` days after expiry. Beyond that, the subscription is dead — subscriber must buy a new one. Cancelled subscriptions cannot be extended regardless of grace period.
- **Per-subscriber indexing**: Subscriber → subscription ID mapping via stored array. No O(n) scans.
- **Timestamps**: `Blockchain.block.medianTimestamp` for expiry calculations (median, not exact — acceptable for day-granularity subscriptions).
- **ReentrancyGuard**: On `buySubscription` and `extendSubscription` (cross-contract `transferFrom` call).

## Storage

| Field | Type | Description |
|-------|------|-------------|
| `paymentToken` | Address | Accepted OP20 token contract address |
| `acceptingSubscriptions` | bool | Whether new subscriptions can be created |
| `gracePeriod` | u256 | Days after expiry during which extension is still allowed |
| `nextPlanId` | u256 | Auto-incrementing plan counter (starts at 1) |
| `nextSubscriptionId` | u256 | Auto-incrementing subscription counter (starts at 1) |
| `planName[planId]` | map | Plan name |
| `planPrice[planId]` | map | Price per day in token units |
| `planActive[planId]` | map | Plan active flag |
| `subPlanId[subId]` | map | Subscription's plan |
| `subSubscriber[subId]` | map | Subscriber address |
| `subExpiresAt[subId]` | map | Expiry timestamp |
| `subCancelled[subId]` | map | Cancelled flag |
| `subscriberSubs[address]` | array per subscriber | Subscription IDs owned by subscriber |

## Methods — Deployer Only

### `setPaymentToken(token: Address)`
Set the accepted OP20 payment token. Can be changed (re-price plans accordingly).

### `createPlan(name: string, pricePerDay: u256) → planId: u256`
Create a new subscription plan. Price is in the payment token's smallest unit per day. Returns the new plan ID.

### `updatePlan(planId: u256, name: string, pricePerDay: u256, active: bool)`
Update an existing plan's name, price, and active status. Inactive plans reject new subscriptions but existing subscriptions remain valid.

### `cancelSubscription(subscriptionId: u256)`
Force-cancel a subscription. Sets cancelled = true, expiresAt = now.

### `withdraw(to: Address)`
Transfer all accumulated payment tokens from the contract to the specified address. Calls `transfer` on the OP20 token contract.

### `setAcceptingSubscriptions(accepting: bool)`
Open or close the contract for new subscriptions.

### `setGracePeriod(days: u256)`
Set the grace period in days. Expired subscriptions can be extended within this window.

## Methods — Public

### `buySubscription(planId: u256, days: u256, userEncrypted: Uint8Array) → subscriptionId: u256`
Purchase a new subscription. Requires:
- Contract is accepting subscriptions
- Plan exists and is active
- days > 0 and ≤ 36500 (~100 years)
- Caller has approved sufficient tokens on the payment token contract

Calls `transferFrom` on the payment token to pull `pricePerDay * days` from caller to contract. Records subscription, adds to subscriber's index. Emits `SubscriptionCreated`.

The `userEncrypted` field is an ECIES-encrypted payload containing a symmetric key. The engine decrypts it using the server's private key, then uses that symmetric key to encrypt the actual connection details (hostname/port/username), which are stored in the NFT contract's `userEncrypted` field.

### `extendSubscription(subscriptionId: u256, days: u256)`
Extend an existing subscription. Anyone can extend any subscription (allows gifting). Requires:
- Subscription exists and is not cancelled
- Plan is still active
- days > 0 and ≤ 36500 (~100 years)
- If expired, must be within `gracePeriod` days of expiry

If subscription is still active, extends from current expiry. If expired (but within grace period), extends from now. Emits `SubscriptionExtended`.

## Methods — Read

### `isAcceptingSubscriptions() → bool`
Returns whether the contract is accepting new subscriptions.

### `getPaymentToken() → Address`
Returns the configured OP20 payment token address.

### `getGracePeriod() → u256`
Returns the grace period in days.

### `getPlan(planId: u256) → (name: string, pricePerDay: u256, active: bool)`
Returns plan details.

### `getSubscription(subscriptionId: u256) → (planId: u256, subscriber: Address, expiresAt: u256, isActive: bool, cancelled: bool)`
Returns subscription details. `isActive` = not cancelled AND not expired.

### `isSubscriptionActive(subscriptionId: u256) → bool`
Quick active check.

### `daysRemaining(subscriptionId: u256) → u256`
Full days remaining. 0 if expired or cancelled.

### `getSubscriptionsBySubscriber(subscriber: Address) → u256[]`
Returns all subscription IDs for a subscriber. O(k) where k = subscriber's subscription count.

### `getTotalSubscriptionCount() → u256`
Total subscriptions ever created.

### `getTotalPlanCount() → u256`
Total plans ever created.

## Events

### `SubscriptionCreated`
| Field | Type | Description |
|-------|------|-------------|
| subscriptionId | u256 | New subscription ID |
| planId | u256 | Plan purchased |
| subscriber | Address | Subscriber address |
| expiresAt | u256 | Expiry timestamp |
| paidAmount | u256 | Token amount paid |
| userEncrypted | bytes | ECIES-encrypted symmetric key |

### `SubscriptionExtended`
| Field | Type | Description |
|-------|------|-------------|
| subscriptionId | u256 | Subscription extended |
| planId | u256 | Plan of the subscription |
| extendedBy | Address | Who paid for the extension |
| newExpiresAt | u256 | New expiry timestamp |
| paidAmount | u256 | Token amount paid |

### `SubscriptionCancelled`
| Field | Type | Description |
|-------|------|-------------|
| subscriptionId | u256 | Subscription cancelled |
| planId | u256 | Plan of the subscription |
| subscriber | Address | Subscriber address |

### `PlanCreated`
| Field | Type | Description |
|-------|------|-------------|
| planId | u256 | New plan ID |
| name | string | Plan name |
| pricePerDay | u256 | Price per day in token units |

### `PlanUpdated`
| Field | Type | Description |
|-------|------|-------------|
| planId | u256 | Plan updated |
| name | string | New name |
| pricePerDay | u256 | New price |
| active | bool | New active state |

### `AcceptingSubscriptionsChanged`
| Field | Type | Description |
|-------|------|-------------|
| accepting | bool | New state |

## Dropped from EVM Version

The following EVM features are not ported:
- Payment method CRUD (multi-token support)
- Uniswap V2 pair price discovery
- Stablecoin configuration
- Slippage tolerance / minimum liquidity checks
- USD-denominated pricing
- `FundsWithdrawn`, `SlippageUpdated`, `MinLiquidityUpdated`, `PrimaryStablecoinSet`, `PaymentMethodAdded`, `PaymentMethodUpdated` events
