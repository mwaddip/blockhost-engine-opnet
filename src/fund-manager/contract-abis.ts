/**
 * OPNet ABI definitions for BlockhostSubscriptions and AccessCredentialNFT contracts.
 *
 * These are the TypeScript ABI + interface definitions used by getContract<T>()
 * to enable type-safe contract interaction.
 */

import type {
    BitcoinInterfaceAbi,
    CallResult,
    BaseContractProperties,
} from 'opnet';
import type { Address } from '@btc-vision/transaction';

// Re-import as values for ABI arrays (needed at runtime)
import { ABIDataTypes as ABI, BitcoinAbiTypes as AbiType } from 'opnet';

/**
 * AccessCredentialNFT ABI
 */
export const ACCESS_CREDENTIAL_NFT_ABI: BitcoinInterfaceAbi = [
    {
        name: 'mint',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'to', type: ABI.ADDRESS },
            { name: 'userEncrypted', type: ABI.STRING },
        ],
        outputs: [{ name: 'tokenId', type: ABI.UINT256 }],
    },
    {
        name: 'transfer',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'to', type: ABI.ADDRESS },
            { name: 'tokenId', type: ABI.UINT256 },
        ],
        outputs: [],
    },
    {
        name: 'transferFrom',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'from', type: ABI.ADDRESS },
            { name: 'to', type: ABI.ADDRESS },
            { name: 'tokenId', type: ABI.UINT256 },
        ],
        outputs: [],
    },
    {
        name: 'approve',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'approved', type: ABI.ADDRESS },
            { name: 'tokenId', type: ABI.UINT256 },
        ],
        outputs: [],
    },
    {
        name: 'setApprovalForAll',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'operator', type: ABI.ADDRESS },
            { name: 'approved', type: ABI.BOOL },
        ],
        outputs: [],
    },
    {
        name: 'isApprovedForAll',
        type: AbiType.Function,
        constant: true,
        inputs: [
            { name: 'owner', type: ABI.ADDRESS },
            { name: 'operator', type: ABI.ADDRESS },
        ],
        outputs: [{ name: 'approved', type: ABI.BOOL }],
    },
    {
        name: 'getApproved',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'tokenId', type: ABI.UINT256 }],
        outputs: [{ name: 'approved', type: ABI.ADDRESS }],
    },
    {
        name: 'burn',
        type: AbiType.Function,
        constant: false,
        inputs: [{ name: 'tokenId', type: ABI.UINT256 }],
        outputs: [],
    },
    {
        name: 'balanceOf',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'owner', type: ABI.ADDRESS }],
        outputs: [{ name: 'balance', type: ABI.UINT256 }],
    },
    {
        name: 'ownerOf',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'tokenId', type: ABI.UINT256 }],
        outputs: [{ name: 'owner', type: ABI.ADDRESS }],
    },
    {
        name: 'tokenOfOwnerByIndex',
        type: AbiType.Function,
        constant: true,
        inputs: [
            { name: 'owner', type: ABI.ADDRESS },
            { name: 'index', type: ABI.UINT256 },
        ],
        outputs: [{ name: 'tokenId', type: ABI.UINT256 }],
    },
    {
        name: 'totalSupply',
        type: AbiType.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'totalSupply', type: ABI.UINT256 }],
    },
    {
        name: 'getUserEncrypted',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'tokenId', type: ABI.UINT256 }],
        outputs: [{ name: 'userEncrypted', type: ABI.STRING }],
    },
    {
        name: 'updateUserEncrypted',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'tokenId', type: ABI.UINT256 },
            { name: 'userEncrypted', type: ABI.STRING },
        ],
        outputs: [],
    },
    {
        name: 'Transferred',
        type: AbiType.Event,
        values: [
            { name: 'from', type: ABI.ADDRESS },
            { name: 'to', type: ABI.ADDRESS },
            { name: 'tokenId', type: ABI.UINT256 },
        ],
    },
];

/**
 * BlockhostSubscriptions ABI
 */
export const BLOCKHOST_SUBSCRIPTIONS_ABI: BitcoinInterfaceAbi = [
    {
        name: 'setPaymentToken',
        type: AbiType.Function,
        constant: false,
        inputs: [{ name: 'token', type: ABI.ADDRESS }],
        outputs: [],
    },
    {
        name: 'createPlan',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'name', type: ABI.STRING },
            { name: 'pricePerDay', type: ABI.UINT256 },
        ],
        outputs: [{ name: 'planId', type: ABI.UINT256 }],
    },
    {
        name: 'updatePlan',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'planId', type: ABI.UINT256 },
            { name: 'name', type: ABI.STRING },
            { name: 'pricePerDay', type: ABI.UINT256 },
            { name: 'active', type: ABI.BOOL },
        ],
        outputs: [],
    },
    {
        name: 'cancelSubscription',
        type: AbiType.Function,
        constant: false,
        inputs: [{ name: 'subscriptionId', type: ABI.UINT256 }],
        outputs: [],
    },
    {
        name: 'withdraw',
        type: AbiType.Function,
        constant: false,
        inputs: [{ name: 'to', type: ABI.ADDRESS }],
        outputs: [],
    },
    {
        name: 'setAcceptingSubscriptions',
        type: AbiType.Function,
        constant: false,
        inputs: [{ name: 'accepting', type: ABI.BOOL }],
        outputs: [],
    },
    {
        name: 'setGracePeriod',
        type: AbiType.Function,
        constant: false,
        inputs: [{ name: 'days', type: ABI.UINT256 }],
        outputs: [],
    },
    {
        name: 'buySubscription',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'planId', type: ABI.UINT256 },
            { name: 'days', type: ABI.UINT256 },
            { name: 'userEncrypted', type: ABI.STRING },
        ],
        outputs: [{ name: 'subscriptionId', type: ABI.UINT256 }],
    },
    {
        name: 'extendSubscription',
        type: AbiType.Function,
        constant: false,
        inputs: [
            { name: 'subscriptionId', type: ABI.UINT256 },
            { name: 'days', type: ABI.UINT256 },
        ],
        outputs: [],
    },
    {
        name: 'isAcceptingSubscriptions',
        type: AbiType.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'accepting', type: ABI.BOOL }],
    },
    {
        name: 'getPaymentToken',
        type: AbiType.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'token', type: ABI.ADDRESS }],
    },
    {
        name: 'getGracePeriod',
        type: AbiType.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'days', type: ABI.UINT256 }],
    },
    {
        name: 'getPlan',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'planId', type: ABI.UINT256 }],
        outputs: [
            { name: 'name', type: ABI.STRING },
            { name: 'pricePerDay', type: ABI.UINT256 },
            { name: 'active', type: ABI.BOOL },
        ],
    },
    {
        name: 'getSubscription',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'subscriptionId', type: ABI.UINT256 }],
        outputs: [
            { name: 'planId', type: ABI.UINT256 },
            { name: 'subscriber', type: ABI.ADDRESS },
            { name: 'expiresAt', type: ABI.UINT256 },
            { name: 'isActive', type: ABI.BOOL },
            { name: 'cancelled', type: ABI.BOOL },
        ],
    },
    {
        name: 'isSubscriptionActive',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'subscriptionId', type: ABI.UINT256 }],
        outputs: [{ name: 'active', type: ABI.BOOL }],
    },
    {
        name: 'daysRemaining',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'subscriptionId', type: ABI.UINT256 }],
        outputs: [{ name: 'days', type: ABI.UINT256 }],
    },
    {
        name: 'getSubscriptionsBySubscriber',
        type: AbiType.Function,
        constant: true,
        inputs: [
            { name: 'subscriber', type: ABI.ADDRESS },
            { name: 'offset', type: ABI.UINT256 },
            { name: 'limit', type: ABI.UINT256 },
        ],
        outputs: [{ name: 'subscriptionIds', type: ABI.UINT256 }],
    },
    {
        name: 'getSubscriptionCountBySubscriber',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'subscriber', type: ABI.ADDRESS }],
        outputs: [{ name: 'count', type: ABI.UINT256 }],
    },
    {
        name: 'getTotalSubscriptionCount',
        type: AbiType.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'count', type: ABI.UINT256 }],
    },
    {
        name: 'getTotalPlanCount',
        type: AbiType.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'count', type: ABI.UINT256 }],
    },
    {
        name: 'getUserEncrypted',
        type: AbiType.Function,
        constant: true,
        inputs: [{ name: 'subscriptionId', type: ABI.UINT256 }],
        outputs: [{ name: 'data', type: ABI.STRING }],
    },
    {
        name: 'PlanCreated',
        type: AbiType.Event,
        values: [
            { name: 'planId', type: ABI.UINT256 },
            { name: 'name', type: ABI.STRING },
            { name: 'pricePerDay', type: ABI.UINT256 },
        ],
    },
    {
        name: 'PlanUpdated',
        type: AbiType.Event,
        values: [
            { name: 'planId', type: ABI.UINT256 },
            { name: 'name', type: ABI.STRING },
            { name: 'pricePerDay', type: ABI.UINT256 },
            { name: 'active', type: ABI.BOOL },
        ],
    },
    {
        name: 'SubscriptionCancelled',
        type: AbiType.Event,
        values: [
            { name: 'subscriptionId', type: ABI.UINT256 },
            { name: 'planId', type: ABI.UINT256 },
            { name: 'subscriber', type: ABI.ADDRESS },
        ],
    },
    {
        name: 'AcceptingSubscriptionsChanged',
        type: AbiType.Event,
        values: [{ name: 'accepting', type: ABI.BOOL }],
    },
    {
        name: 'SubscriptionCreated',
        type: AbiType.Event,
        values: [
            { name: 'subscriptionId', type: ABI.UINT256 },
            { name: 'planId', type: ABI.UINT256 },
            { name: 'subscriber', type: ABI.ADDRESS },
            { name: 'expiresAt', type: ABI.UINT256 },
            { name: 'paidAmount', type: ABI.UINT256 },
        ],
    },
    {
        name: 'SubscriptionExtended',
        type: AbiType.Event,
        values: [
            { name: 'subscriptionId', type: ABI.UINT256 },
            { name: 'planId', type: ABI.UINT256 },
            { name: 'extendedBy', type: ABI.ADDRESS },
            { name: 'newExpiresAt', type: ABI.UINT256 },
            { name: 'paidAmount', type: ABI.UINT256 },
        ],
    },
];

/**
 * AccessCredentialNFT contract interface
 */
export interface IAccessCredentialNFT extends BaseContractProperties {
    mint(to: Address, userEncrypted: string): Promise<CallResult<{ tokenId: bigint }, []>>;
    transfer(to: Address, tokenId: bigint): Promise<CallResult<Record<string, never>, []>>;
    transferFrom(from: Address, to: Address, tokenId: bigint): Promise<CallResult<Record<string, never>, []>>;
    approve(approved: Address, tokenId: bigint): Promise<CallResult<Record<string, never>, []>>;
    setApprovalForAll(operator: Address, approved: boolean): Promise<CallResult<Record<string, never>, []>>;
    isApprovedForAll(owner: Address, operator: Address): Promise<CallResult<{ approved: boolean }, []>>;
    getApproved(tokenId: bigint): Promise<CallResult<{ approved: Address }, []>>;
    burn(tokenId: bigint): Promise<CallResult<Record<string, never>, []>>;
    balanceOf(owner: Address): Promise<CallResult<{ balance: bigint }, []>>;
    ownerOf(tokenId: bigint): Promise<CallResult<{ owner: Address }, []>>;
    tokenOfOwnerByIndex(owner: Address, index: bigint): Promise<CallResult<{ tokenId: bigint }, []>>;
    totalSupply(): Promise<CallResult<{ totalSupply: bigint }, []>>;
    getUserEncrypted(tokenId: bigint): Promise<CallResult<{ userEncrypted: string }, []>>;
    updateUserEncrypted(tokenId: bigint, userEncrypted: string): Promise<CallResult<Record<string, never>, []>>;
}

/**
 * BlockhostSubscriptions contract interface
 */
export interface IBlockhostSubscriptions extends BaseContractProperties {
    setPaymentToken(token: Address): Promise<CallResult<Record<string, never>, []>>;
    createPlan(name: string, pricePerDay: bigint): Promise<CallResult<{ planId: bigint }, []>>;
    updatePlan(planId: bigint, name: string, pricePerDay: bigint, active: boolean): Promise<CallResult<Record<string, never>, []>>;
    cancelSubscription(subscriptionId: bigint): Promise<CallResult<Record<string, never>, []>>;
    withdraw(to: Address): Promise<CallResult<Record<string, never>, []>>;
    setAcceptingSubscriptions(accepting: boolean): Promise<CallResult<Record<string, never>, []>>;
    setGracePeriod(days: bigint): Promise<CallResult<Record<string, never>, []>>;
    buySubscription(planId: bigint, days: bigint, userEncrypted: string): Promise<CallResult<{ subscriptionId: bigint }, []>>;
    extendSubscription(subscriptionId: bigint, days: bigint): Promise<CallResult<Record<string, never>, []>>;
    isAcceptingSubscriptions(): Promise<CallResult<{ accepting: boolean }, []>>;
    getPaymentToken(): Promise<CallResult<{ token: Address }, []>>;
    getGracePeriod(): Promise<CallResult<{ days: bigint }, []>>;
    getPlan(planId: bigint): Promise<CallResult<{ name: string; pricePerDay: bigint; active: boolean }, []>>;
    getSubscription(subscriptionId: bigint): Promise<CallResult<{ planId: bigint; subscriber: Address; expiresAt: bigint; isActive: boolean; cancelled: boolean }, []>>;
    isSubscriptionActive(subscriptionId: bigint): Promise<CallResult<{ active: boolean }, []>>;
    daysRemaining(subscriptionId: bigint): Promise<CallResult<{ days: bigint }, []>>;
    getSubscriptionsBySubscriber(subscriber: Address, offset: bigint, limit: bigint): Promise<CallResult<{ subscriptionIds: bigint }, []>>;
    getSubscriptionCountBySubscriber(subscriber: Address): Promise<CallResult<{ count: bigint }, []>>;
    getTotalSubscriptionCount(): Promise<CallResult<{ count: bigint }, []>>;
    getTotalPlanCount(): Promise<CallResult<{ count: bigint }, []>>;
    getUserEncrypted(subscriptionId: bigint): Promise<CallResult<{ data: string }, []>>;
}

