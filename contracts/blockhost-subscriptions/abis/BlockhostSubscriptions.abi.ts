import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const BlockhostSubscriptionsEvents = [
    {
        name: 'PlanCreated',
        values: [
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'PlanUpdated',
        values: [
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
            { name: 'active', type: ABIDataTypes.BOOL },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'SubscriptionCancelled',
        values: [
            { name: 'subscriptionId', type: ABIDataTypes.UINT256 },
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'subscriber', type: ABIDataTypes.ADDRESS },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'AcceptingSubscriptionsChanged',
        values: [{ name: 'accepting', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'SubscriptionCreated',
        values: [
            { name: 'subscriptionId', type: ABIDataTypes.UINT256 },
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'subscriber', type: ABIDataTypes.ADDRESS },
            { name: 'expiresAt', type: ABIDataTypes.UINT256 },
            { name: 'paidAmount', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'SubscriptionExtended',
        values: [
            { name: 'subscriptionId', type: ABIDataTypes.UINT256 },
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'extendedBy', type: ABIDataTypes.ADDRESS },
            { name: 'newExpiresAt', type: ABIDataTypes.UINT256 },
            { name: 'paidAmount', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Event,
    },
];

export const BlockhostSubscriptionsAbi = [
    {
        name: 'setPaymentToken',
        inputs: [{ name: 'token', type: ABIDataTypes.ADDRESS }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'createPlan',
        inputs: [
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'planId', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'updatePlan',
        inputs: [
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
            { name: 'active', type: ABIDataTypes.BOOL },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'cancelSubscription',
        inputs: [{ name: 'subscriptionId', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'withdraw',
        inputs: [{ name: 'to', type: ABIDataTypes.ADDRESS }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setAcceptingSubscriptions',
        inputs: [{ name: 'accepting', type: ABIDataTypes.BOOL }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setGracePeriod',
        inputs: [{ name: 'days', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'buySubscription',
        inputs: [
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'days', type: ABIDataTypes.UINT256 },
            { name: 'userEncrypted', type: ABIDataTypes.STRING },
        ],
        outputs: [{ name: 'subscriptionId', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'extendSubscription',
        inputs: [
            { name: 'subscriptionId', type: ABIDataTypes.UINT256 },
            { name: 'days', type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isAcceptingSubscriptions',
        inputs: [],
        outputs: [{ name: 'accepting', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getPaymentToken',
        inputs: [],
        outputs: [{ name: 'token', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getGracePeriod',
        inputs: [],
        outputs: [{ name: 'days', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getPlan',
        inputs: [{ name: 'planId', type: ABIDataTypes.UINT256 }],
        outputs: [
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
            { name: 'active', type: ABIDataTypes.BOOL },
        ],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getSubscription',
        inputs: [{ name: 'subscriptionId', type: ABIDataTypes.UINT256 }],
        outputs: [
            { name: 'planId', type: ABIDataTypes.UINT256 },
            { name: 'subscriber', type: ABIDataTypes.ADDRESS },
            { name: 'expiresAt', type: ABIDataTypes.UINT256 },
            { name: 'isActive', type: ABIDataTypes.BOOL },
            { name: 'cancelled', type: ABIDataTypes.BOOL },
        ],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isSubscriptionActive',
        inputs: [{ name: 'subscriptionId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'active', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'daysRemaining',
        inputs: [{ name: 'subscriptionId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'days', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getSubscriptionsBySubscriber',
        inputs: [
            { name: 'subscriber', type: ABIDataTypes.ADDRESS },
            { name: 'offset', type: ABIDataTypes.UINT256 },
            { name: 'limit', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'subscriptionIds', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getSubscriptionCountBySubscriber',
        inputs: [{ name: 'subscriber', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'count', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getTotalSubscriptionCount',
        inputs: [],
        outputs: [{ name: 'count', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getTotalPlanCount',
        inputs: [],
        outputs: [{ name: 'count', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getUserEncrypted',
        inputs: [{ name: 'subscriptionId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'data', type: ABIDataTypes.STRING }],
        type: BitcoinAbiTypes.Function,
    },
    ...BlockhostSubscriptionsEvents,
    ...OP_NET_ABI,
];

export default BlockhostSubscriptionsAbi;
