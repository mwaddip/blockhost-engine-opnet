import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------
export type PlanCreatedEvent = {
    readonly planId: bigint;
    readonly name: string;
    readonly pricePerDay: bigint;
};
export type PlanUpdatedEvent = {
    readonly planId: bigint;
    readonly name: string;
    readonly pricePerDay: bigint;
    readonly active: boolean;
};
export type SubscriptionCancelledEvent = {
    readonly subscriptionId: bigint;
    readonly planId: bigint;
    readonly subscriber: Address;
};
export type AcceptingSubscriptionsChangedEvent = {
    readonly accepting: boolean;
};
export type SubscriptionCreatedEvent = {
    readonly subscriptionId: bigint;
    readonly planId: bigint;
    readonly subscriber: Address;
    readonly expiresAt: bigint;
    readonly paidAmount: bigint;
};
export type SubscriptionExtendedEvent = {
    readonly subscriptionId: bigint;
    readonly planId: bigint;
    readonly extendedBy: Address;
    readonly newExpiresAt: bigint;
    readonly paidAmount: bigint;
};

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the setPaymentToken function call.
 */
export type SetPaymentToken = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the createPlan function call.
 */
export type CreatePlan = CallResult<
    {
        planId: bigint;
    },
    OPNetEvent<PlanCreatedEvent>[]
>;

/**
 * @description Represents the result of the updatePlan function call.
 */
export type UpdatePlan = CallResult<{}, OPNetEvent<PlanUpdatedEvent>[]>;

/**
 * @description Represents the result of the cancelSubscription function call.
 */
export type CancelSubscription = CallResult<{}, OPNetEvent<SubscriptionCancelledEvent>[]>;

/**
 * @description Represents the result of the withdraw function call.
 */
export type Withdraw = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setAcceptingSubscriptions function call.
 */
export type SetAcceptingSubscriptions = CallResult<{}, OPNetEvent<AcceptingSubscriptionsChangedEvent>[]>;

/**
 * @description Represents the result of the setGracePeriod function call.
 */
export type SetGracePeriod = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the buySubscription function call.
 */
export type BuySubscription = CallResult<
    {
        subscriptionId: bigint;
    },
    OPNetEvent<SubscriptionCreatedEvent>[]
>;

/**
 * @description Represents the result of the extendSubscription function call.
 */
export type ExtendSubscription = CallResult<{}, OPNetEvent<SubscriptionExtendedEvent>[]>;

/**
 * @description Represents the result of the isAcceptingSubscriptions function call.
 */
export type IsAcceptingSubscriptions = CallResult<
    {
        accepting: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getPaymentToken function call.
 */
export type GetPaymentToken = CallResult<
    {
        token: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getGracePeriod function call.
 */
export type GetGracePeriod = CallResult<
    {
        days: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getPlan function call.
 */
export type GetPlan = CallResult<
    {
        name: string;
        pricePerDay: bigint;
        active: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getSubscription function call.
 */
export type GetSubscription = CallResult<
    {
        planId: bigint;
        subscriber: Address;
        expiresAt: bigint;
        isActive: boolean;
        cancelled: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the isSubscriptionActive function call.
 */
export type IsSubscriptionActive = CallResult<
    {
        active: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the daysRemaining function call.
 */
export type DaysRemaining = CallResult<
    {
        days: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getSubscriptionsBySubscriber function call.
 */
export type GetSubscriptionsBySubscriber = CallResult<
    {
        subscriptionIds: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getTotalSubscriptionCount function call.
 */
export type GetTotalSubscriptionCount = CallResult<
    {
        count: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getTotalPlanCount function call.
 */
export type GetTotalPlanCount = CallResult<
    {
        count: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getUserEncrypted function call.
 */
export type GetUserEncrypted = CallResult<
    {
        data: Uint8Array;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IBlockhostSubscriptions
// ------------------------------------------------------------------
export interface IBlockhostSubscriptions extends IOP_NETContract {
    setPaymentToken(token: Address): Promise<SetPaymentToken>;
    createPlan(name: string, pricePerDay: bigint): Promise<CreatePlan>;
    updatePlan(planId: bigint, name: string, pricePerDay: bigint, active: boolean): Promise<UpdatePlan>;
    cancelSubscription(subscriptionId: bigint): Promise<CancelSubscription>;
    withdraw(to: Address): Promise<Withdraw>;
    setAcceptingSubscriptions(accepting: boolean): Promise<SetAcceptingSubscriptions>;
    setGracePeriod(days: bigint): Promise<SetGracePeriod>;
    buySubscription(planId: bigint, days: bigint, userEncrypted: Uint8Array): Promise<BuySubscription>;
    extendSubscription(subscriptionId: bigint, days: bigint): Promise<ExtendSubscription>;
    isAcceptingSubscriptions(): Promise<IsAcceptingSubscriptions>;
    getPaymentToken(): Promise<GetPaymentToken>;
    getGracePeriod(): Promise<GetGracePeriod>;
    getPlan(planId: bigint): Promise<GetPlan>;
    getSubscription(subscriptionId: bigint): Promise<GetSubscription>;
    isSubscriptionActive(subscriptionId: bigint): Promise<IsSubscriptionActive>;
    daysRemaining(subscriptionId: bigint): Promise<DaysRemaining>;
    getSubscriptionsBySubscriber(subscriber: Address): Promise<GetSubscriptionsBySubscriber>;
    getTotalSubscriptionCount(): Promise<GetTotalSubscriptionCount>;
    getTotalPlanCount(): Promise<GetTotalPlanCount>;
    getUserEncrypted(subscriptionId: bigint): Promise<GetUserEncrypted>;
}
