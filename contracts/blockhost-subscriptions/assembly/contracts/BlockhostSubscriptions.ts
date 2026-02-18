import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    ADDRESS_BYTE_LENGTH,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    NetEvent,
    Revert,
    SafeMath,
    StoredBoolean,
    StoredString,
    StoredU256,
    U256_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';
import { EMPTY_POINTER } from '@btc-vision/btc-runtime/runtime/math/bytes';
import { StoredMapU256 } from '@btc-vision/btc-runtime/runtime/storage/maps/StoredMapU256';
import { StoredU256Array } from '@btc-vision/btc-runtime/runtime/storage/arrays/StoredU256Array';
import {
    ReentrancyGuard,
    ReentrancyLevel,
} from '@btc-vision/btc-runtime/runtime';

const SECONDS_PER_DAY: u64 = 86400;
const MAX_SUBSCRIPTION_DAYS: u256 = u256.fromU64(36500); // ~100 years

const TRANSFER_FROM_SELECTOR: u32 = encodeSelector('transferFrom');
const TRANSFER_SELECTOR: u32 = encodeSelector('transfer');
const BALANCE_OF_SELECTOR: u32 = encodeSelector('balanceOf');

const paymentTokenPointer: u16 = Blockchain.nextPointer;
const acceptingSubsPointer: u16 = Blockchain.nextPointer;
const gracePeriodPointer: u16 = Blockchain.nextPointer;
const nextPlanIdPointer: u16 = Blockchain.nextPointer;
const nextSubIdPointer: u16 = Blockchain.nextPointer;
const planNamePointer: u16 = Blockchain.nextPointer;
const planPricePointer: u16 = Blockchain.nextPointer;
const planActivePointer: u16 = Blockchain.nextPointer;
const subPlanIdPointer: u16 = Blockchain.nextPointer;
const subSubscriberPointer: u16 = Blockchain.nextPointer;
const subExpiresAtPointer: u16 = Blockchain.nextPointer;
const subCancelledPointer: u16 = Blockchain.nextPointer;
const subscriberSubsPointer: u16 = Blockchain.nextPointer;

@final
export class SubscriptionCreatedEvent extends NetEvent {
    public constructor(
        subscriptionId: u256,
        planId: u256,
        subscriber: Address,
        expiresAt: u256,
        paidAmount: u256,
        userEncrypted: Uint8Array,
    ) {
        const data: BytesWriter = new BytesWriter(
            U256_BYTE_LENGTH +
                U256_BYTE_LENGTH +
                ADDRESS_BYTE_LENGTH +
                U256_BYTE_LENGTH +
                U256_BYTE_LENGTH +
                4 +
                userEncrypted.length,
        );
        data.writeU256(subscriptionId);
        data.writeU256(planId);
        data.writeAddress(subscriber);
        data.writeU256(expiresAt);
        data.writeU256(paidAmount);
        data.writeBytesWithLength(userEncrypted);
        super('SubscriptionCreated', data);
    }
}

@final
export class SubscriptionExtendedEvent extends NetEvent {
    public constructor(
        subscriptionId: u256,
        planId: u256,
        extendedBy: Address,
        newExpiresAt: u256,
        paidAmount: u256,
    ) {
        const data: BytesWriter = new BytesWriter(
            U256_BYTE_LENGTH +
                U256_BYTE_LENGTH +
                ADDRESS_BYTE_LENGTH +
                U256_BYTE_LENGTH +
                U256_BYTE_LENGTH,
        );
        data.writeU256(subscriptionId);
        data.writeU256(planId);
        data.writeAddress(extendedBy);
        data.writeU256(newExpiresAt);
        data.writeU256(paidAmount);
        super('SubscriptionExtended', data);
    }
}

@final
export class SubscriptionCancelledEvent extends NetEvent {
    public constructor(subscriptionId: u256, planId: u256, subscriber: Address) {
        const data: BytesWriter = new BytesWriter(
            U256_BYTE_LENGTH + U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH,
        );
        data.writeU256(subscriptionId);
        data.writeU256(planId);
        data.writeAddress(subscriber);
        super('SubscriptionCancelled', data);
    }
}

@final
export class PlanCreatedEvent extends NetEvent {
    public constructor(planId: u256, name: string, pricePerDay: u256) {
        const nameBytes: Uint8Array = Uint8Array.wrap(String.UTF8.encode(name));
        const data: BytesWriter = new BytesWriter(
            U256_BYTE_LENGTH + 4 + nameBytes.length + U256_BYTE_LENGTH,
        );
        data.writeU256(planId);
        data.writeStringWithLength(name);
        data.writeU256(pricePerDay);
        super('PlanCreated', data);
    }
}

@final
export class PlanUpdatedEvent extends NetEvent {
    public constructor(planId: u256, name: string, pricePerDay: u256, active: bool) {
        const nameBytes: Uint8Array = Uint8Array.wrap(String.UTF8.encode(name));
        const data: BytesWriter = new BytesWriter(
            U256_BYTE_LENGTH + 4 + nameBytes.length + U256_BYTE_LENGTH + 1,
        );
        data.writeU256(planId);
        data.writeStringWithLength(name);
        data.writeU256(pricePerDay);
        data.writeBoolean(active);
        super('PlanUpdated', data);
    }
}

@final
export class AcceptingSubscriptionsChangedEvent extends NetEvent {
    public constructor(accepting: bool) {
        const data: BytesWriter = new BytesWriter(1);
        data.writeBoolean(accepting);
        super('AcceptingSubscriptionsChanged', data);
    }
}

@final
export class BlockhostSubscriptions extends ReentrancyGuard {
    protected readonly reentrancyLevel: ReentrancyLevel = ReentrancyLevel.STANDARD;

    private readonly paymentTokenStore: StoredU256;
    private readonly acceptingSubs: StoredBoolean;
    private readonly gracePeriod: StoredU256;
    private readonly nextPlanId: StoredU256;
    private readonly nextSubId: StoredU256;
    private readonly planNameMap: Map<u64, StoredString> = new Map();
    private readonly planPriceMap: StoredMapU256;
    private readonly planActiveMap: StoredMapU256;
    private readonly subPlanIdMap: StoredMapU256;
    private readonly subSubscriberMap: StoredMapU256;
    private readonly subExpiresAtMap: StoredMapU256;
    private readonly subCancelledMap: StoredMapU256;
    private readonly subscriberSubsCache: Map<Address, StoredU256Array> = new Map();

    public constructor() {
        super();
        this.paymentTokenStore = new StoredU256(paymentTokenPointer, EMPTY_POINTER);
        this.acceptingSubs = new StoredBoolean(acceptingSubsPointer, false);
        this.gracePeriod = new StoredU256(gracePeriodPointer, EMPTY_POINTER);
        this.nextPlanId = new StoredU256(nextPlanIdPointer, EMPTY_POINTER);
        this.nextSubId = new StoredU256(nextSubIdPointer, EMPTY_POINTER);
        this.planPriceMap = new StoredMapU256(planPricePointer);
        this.planActiveMap = new StoredMapU256(planActivePointer);
        this.subPlanIdMap = new StoredMapU256(subPlanIdPointer);
        this.subSubscriberMap = new StoredMapU256(subSubscriberPointer);
        this.subExpiresAtMap = new StoredMapU256(subExpiresAtPointer);
        this.subCancelledMap = new StoredMapU256(subCancelledPointer);
    }

    public override onDeployment(calldata: Calldata): void {
        super.onDeployment(calldata);

        const paymentToken: Address = calldata.readAddress();
        if (paymentToken === Address.zero()) throw new Revert('Invalid payment token');

        this.paymentTokenStore.value = u256.fromUint8ArrayBE(paymentToken);
        this.acceptingSubs.value = true;
        this.nextPlanId.value = u256.One;
        this.nextSubId.value = u256.One;
        this.gracePeriod.value = u256.Zero;
    }

    protected override isSelectorExcluded(selector: u32): boolean {
        if (selector === encodeSelector('isAcceptingSubscriptions')) return true;
        if (selector === encodeSelector('getPaymentToken')) return true;
        if (selector === encodeSelector('getGracePeriod')) return true;
        if (selector === encodeSelector('getPlan')) return true;
        if (selector === encodeSelector('getSubscription')) return true;
        if (selector === encodeSelector('isSubscriptionActive')) return true;
        if (selector === encodeSelector('daysRemaining')) return true;
        if (selector === encodeSelector('getSubscriptionsBySubscriber')) return true;
        if (selector === encodeSelector('getTotalSubscriptionCount')) return true;
        if (selector === encodeSelector('getTotalPlanCount')) return true;

        return super.isSelectorExcluded(selector);
    }

    @method({ name: 'token', type: ABIDataTypes.ADDRESS })
    public setPaymentToken(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const token: Address = calldata.readAddress();
        if (token === Address.zero()) throw new Revert('Invalid payment token');

        this.paymentTokenStore.value = u256.fromUint8ArrayBE(token);
        return new BytesWriter(0);
    }

    @method(
        { name: 'name', type: ABIDataTypes.STRING },
        { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'planId', type: ABIDataTypes.UINT256 })
    @emit('PlanCreated')
    public createPlan(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const name: string = calldata.readStringWithLength();
        const pricePerDay: u256 = calldata.readU256();

        if (pricePerDay.isZero()) throw new Revert('Price must be positive');

        const planId: u256 = this.nextPlanId.value;

        const planIndex: u64 = planId.toU64();
        const nameStore = new StoredString(planNamePointer, planIndex);
        nameStore.value = name;

        this.planPriceMap.set(planId, pricePerDay);
        this.planActiveMap.set(planId, u256.One);

        this.nextPlanId.value = SafeMath.add(planId, u256.One);

        this.emitEvent(new PlanCreatedEvent(planId, name, pricePerDay));

        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(planId);
        return writer;
    }

    @method(
        { name: 'planId', type: ABIDataTypes.UINT256 },
        { name: 'name', type: ABIDataTypes.STRING },
        { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
        { name: 'active', type: ABIDataTypes.BOOL },
    )
    @emit('PlanUpdated')
    public updatePlan(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const planId: u256 = calldata.readU256();
        const name: string = calldata.readStringWithLength();
        const pricePerDay: u256 = calldata.readU256();
        const active: bool = calldata.readBoolean();

        this.requireValidPlan(planId);
        if (pricePerDay.isZero()) throw new Revert('Price must be positive');

        const planIndex: u64 = planId.toU64();
        const nameStore = new StoredString(planNamePointer, planIndex);
        nameStore.value = name;

        this.planPriceMap.set(planId, pricePerDay);
        this.planActiveMap.set(planId, active ? u256.One : u256.Zero);

        this.emitEvent(new PlanUpdatedEvent(planId, name, pricePerDay, active));

        return new BytesWriter(0);
    }

    @method({ name: 'subscriptionId', type: ABIDataTypes.UINT256 })
    @emit('SubscriptionCancelled')
    public cancelSubscription(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const subscriptionId: u256 = calldata.readU256();
        this.requireValidSubscription(subscriptionId);

        if (!this.subCancelledMap.get(subscriptionId).isZero()) {
            throw new Revert('Already cancelled');
        }

        this.subCancelledMap.set(subscriptionId, u256.One);

        const now: u256 = u256.fromU64(Blockchain.block.medianTimestamp);
        this.subExpiresAtMap.set(subscriptionId, now);

        const planId: u256 = this.subPlanIdMap.get(subscriptionId);
        const subscriberU256: u256 = this.subSubscriberMap.get(subscriptionId);
        const subscriber: Address = this.u256ToAddress(subscriberU256);

        this.emitEvent(new SubscriptionCancelledEvent(subscriptionId, planId, subscriber));

        return new BytesWriter(0);
    }

    @method({ name: 'to', type: ABIDataTypes.ADDRESS })
    public withdraw(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const to: Address = calldata.readAddress();
        if (to === Address.zero()) throw new Revert('Invalid address');

        const tokenAddr: Address = this.getPaymentTokenAddress();

        const balance: u256 = this.queryTokenBalance(tokenAddr, Blockchain.contractAddress);
        if (balance.isZero()) throw new Revert('No balance');

        this.transferToken(tokenAddr, to, balance);

        return new BytesWriter(0);
    }

    @method({ name: 'accepting', type: ABIDataTypes.BOOL })
    @emit('AcceptingSubscriptionsChanged')
    public setAcceptingSubscriptions(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const accepting: bool = calldata.readBoolean();
        this.acceptingSubs.value = accepting;

        this.emitEvent(new AcceptingSubscriptionsChangedEvent(accepting));

        return new BytesWriter(0);
    }

    @method({ name: 'days', type: ABIDataTypes.UINT256 })
    public setGracePeriod(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const days: u256 = calldata.readU256();
        this.gracePeriod.value = days;

        return new BytesWriter(0);
    }

    @method(
        { name: 'planId', type: ABIDataTypes.UINT256 },
        { name: 'days', type: ABIDataTypes.UINT256 },
        { name: 'userEncrypted', type: ABIDataTypes.BYTES },
    )
    @returns({ name: 'subscriptionId', type: ABIDataTypes.UINT256 })
    @emit('SubscriptionCreated')
    public buySubscription(calldata: Calldata): BytesWriter {
        const planId: u256 = calldata.readU256();
        const days: u256 = calldata.readU256();
        const userEncrypted: Uint8Array = calldata.readBytesWithLength();

        if (!this.acceptingSubs.value) throw new Revert('Not accepting subscriptions');
        this.requireValidPlan(planId);
        if (this.planActiveMap.get(planId).isZero()) throw new Revert('Plan not active');
        if (days.isZero()) throw new Revert('Days must be positive');
        if (days > MAX_SUBSCRIPTION_DAYS) throw new Revert('Days exceeds maximum');

        const pricePerDay: u256 = this.planPriceMap.get(planId);
        const totalCost: u256 = SafeMath.mul(pricePerDay, days);

        const tokenAddr: Address = this.getPaymentTokenAddress();
        this.pullTokens(tokenAddr, Blockchain.tx.sender, totalCost);

        const subscriptionId: u256 = this.nextSubId.value;
        const now: u64 = Blockchain.block.medianTimestamp;
        const durationSeconds: u64 = days.toU64() * SECONDS_PER_DAY;
        const expiresAt: u256 = u256.fromU64(now + durationSeconds);

        const subscriber: Address = Blockchain.tx.sender;

        this.subPlanIdMap.set(subscriptionId, planId);
        this.subSubscriberMap.set(subscriptionId, u256.fromUint8ArrayBE(subscriber));
        this.subExpiresAtMap.set(subscriptionId, expiresAt);
        this.subCancelledMap.set(subscriptionId, u256.Zero);

        const subArray = this.getSubscriberSubArray(subscriber);
        subArray.push(subscriptionId);
        subArray.save();

        this.nextSubId.value = SafeMath.add(subscriptionId, u256.One);

        this.emitEvent(
            new SubscriptionCreatedEvent(
                subscriptionId,
                planId,
                subscriber,
                expiresAt,
                totalCost,
                userEncrypted,
            ),
        );

        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(subscriptionId);
        return writer;
    }

    @method(
        { name: 'subscriptionId', type: ABIDataTypes.UINT256 },
        { name: 'days', type: ABIDataTypes.UINT256 },
    )
    @emit('SubscriptionExtended')
    public extendSubscription(calldata: Calldata): BytesWriter {
        const subscriptionId: u256 = calldata.readU256();
        const days: u256 = calldata.readU256();

        this.requireValidSubscription(subscriptionId);
        if (!this.subCancelledMap.get(subscriptionId).isZero()) {
            throw new Revert('Subscription cancelled');
        }
        if (days.isZero()) throw new Revert('Days must be positive');
        if (days > MAX_SUBSCRIPTION_DAYS) throw new Revert('Days exceeds maximum');

        const planId: u256 = this.subPlanIdMap.get(subscriptionId);
        if (this.planActiveMap.get(planId).isZero()) throw new Revert('Plan not active');

        const now: u64 = Blockchain.block.medianTimestamp;
        const nowU256: u256 = u256.fromU64(now);
        const currentExpiry: u256 = this.subExpiresAtMap.get(subscriptionId);

        if (currentExpiry < nowU256) {
            const graceDays: u256 = this.gracePeriod.value;
            if (!graceDays.isZero()) {
                const graceSeconds: u256 = SafeMath.mul(graceDays, u256.fromU64(SECONDS_PER_DAY));
                const graceDeadline: u256 = SafeMath.add(currentExpiry, graceSeconds);
                if (nowU256 > graceDeadline) {
                    throw new Revert('Grace period expired');
                }
            } else {
                throw new Revert('Subscription expired');
            }
        }

        const pricePerDay: u256 = this.planPriceMap.get(planId);
        const totalCost: u256 = SafeMath.mul(pricePerDay, days);

        const tokenAddr: Address = this.getPaymentTokenAddress();
        this.pullTokens(tokenAddr, Blockchain.tx.sender, totalCost);

        const durationSeconds: u64 = days.toU64() * SECONDS_PER_DAY;
        const baseTime: u256 = currentExpiry > nowU256 ? currentExpiry : nowU256;
        const newExpiresAt: u256 = SafeMath.add(baseTime, u256.fromU64(durationSeconds));

        this.subExpiresAtMap.set(subscriptionId, newExpiresAt);

        this.emitEvent(
            new SubscriptionExtendedEvent(
                subscriptionId,
                planId,
                Blockchain.tx.sender,
                newExpiresAt,
                totalCost,
            ),
        );

        return new BytesWriter(0);
    }

    @method()
    @returns({ name: 'accepting', type: ABIDataTypes.BOOL })
    public isAcceptingSubscriptions(_calldata: Calldata): BytesWriter {
        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(this.acceptingSubs.value);
        return writer;
    }

    @method()
    @returns({ name: 'token', type: ABIDataTypes.ADDRESS })
    public getPaymentToken(_calldata: Calldata): BytesWriter {
        const writer: BytesWriter = new BytesWriter(ADDRESS_BYTE_LENGTH);
        writer.writeAddress(this.getPaymentTokenAddress());
        return writer;
    }

    @method()
    @returns({ name: 'days', type: ABIDataTypes.UINT256 })
    public getGracePeriod(_calldata: Calldata): BytesWriter {
        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(this.gracePeriod.value);
        return writer;
    }

    @method({ name: 'planId', type: ABIDataTypes.UINT256 })
    @returns(
        { name: 'name', type: ABIDataTypes.STRING },
        { name: 'pricePerDay', type: ABIDataTypes.UINT256 },
        { name: 'active', type: ABIDataTypes.BOOL },
    )
    public getPlan(calldata: Calldata): BytesWriter {
        const planId: u256 = calldata.readU256();
        this.requireValidPlan(planId);

        const planIndex: u64 = planId.toU64();
        const nameStore = new StoredString(planNamePointer, planIndex);
        const name: string = nameStore.value;
        const pricePerDay: u256 = this.planPriceMap.get(planId);
        const active: bool = !this.planActiveMap.get(planId).isZero();

        const writer: BytesWriter = new BytesWriter(4 + name.length + U256_BYTE_LENGTH + 1);
        writer.writeStringWithLength(name);
        writer.writeU256(pricePerDay);
        writer.writeBoolean(active);
        return writer;
    }

    @method({ name: 'subscriptionId', type: ABIDataTypes.UINT256 })
    @returns(
        { name: 'planId', type: ABIDataTypes.UINT256 },
        { name: 'subscriber', type: ABIDataTypes.ADDRESS },
        { name: 'expiresAt', type: ABIDataTypes.UINT256 },
        { name: 'isActive', type: ABIDataTypes.BOOL },
        { name: 'cancelled', type: ABIDataTypes.BOOL },
    )
    public getSubscription(calldata: Calldata): BytesWriter {
        const subscriptionId: u256 = calldata.readU256();
        this.requireValidSubscription(subscriptionId);

        const planId: u256 = this.subPlanIdMap.get(subscriptionId);
        const subscriberU256: u256 = this.subSubscriberMap.get(subscriptionId);
        const expiresAt: u256 = this.subExpiresAtMap.get(subscriptionId);
        const cancelled: bool = !this.subCancelledMap.get(subscriptionId).isZero();

        const now: u256 = u256.fromU64(Blockchain.block.medianTimestamp);
        const isActive: bool = !cancelled && expiresAt > now;

        const writer: BytesWriter = new BytesWriter(
            U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH + 1 + 1,
        );
        writer.writeU256(planId);
        writer.writeAddress(this.u256ToAddress(subscriberU256));
        writer.writeU256(expiresAt);
        writer.writeBoolean(isActive);
        writer.writeBoolean(cancelled);
        return writer;
    }

    @method({ name: 'subscriptionId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'active', type: ABIDataTypes.BOOL })
    public isSubscriptionActive(calldata: Calldata): BytesWriter {
        const subscriptionId: u256 = calldata.readU256();

        let active: bool = false;
        if (!subscriptionId.isZero() && subscriptionId < this.nextSubId.value) {
            const cancelled: bool = !this.subCancelledMap.get(subscriptionId).isZero();
            const expiresAt: u256 = this.subExpiresAtMap.get(subscriptionId);
            const now: u256 = u256.fromU64(Blockchain.block.medianTimestamp);
            active = !cancelled && expiresAt > now;
        }

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(active);
        return writer;
    }

    @method({ name: 'subscriptionId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'days', type: ABIDataTypes.UINT256 })
    public daysRemaining(calldata: Calldata): BytesWriter {
        const subscriptionId: u256 = calldata.readU256();
        this.requireValidSubscription(subscriptionId);

        let remaining: u256 = u256.Zero;
        const cancelled: bool = !this.subCancelledMap.get(subscriptionId).isZero();

        if (!cancelled) {
            const expiresAt: u256 = this.subExpiresAtMap.get(subscriptionId);
            const now: u256 = u256.fromU64(Blockchain.block.medianTimestamp);
            if (expiresAt > now) {
                const diff: u256 = SafeMath.sub(expiresAt, now);
                remaining = SafeMath.div(diff, u256.fromU64(SECONDS_PER_DAY));
            }
        }

        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(remaining);
        return writer;
    }

    @method({ name: 'subscriber', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'subscriptionIds', type: ABIDataTypes.UINT256 })
    public getSubscriptionsBySubscriber(calldata: Calldata): BytesWriter {
        const subscriber: Address = calldata.readAddress();
        const subArray = this.getSubscriberSubArray(subscriber);
        const length: u32 = subArray.getLength();

        const writer: BytesWriter = new BytesWriter(4 + length * 32);
        writer.writeU32(length);
        for (let i: u32 = 0; i < length; i++) {
            writer.writeU256(subArray.get(i));
        }
        return writer;
    }

    @method()
    @returns({ name: 'count', type: ABIDataTypes.UINT256 })
    public getTotalSubscriptionCount(_calldata: Calldata): BytesWriter {
        const count: u256 = SafeMath.sub(this.nextSubId.value, u256.One);
        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(count);
        return writer;
    }

    @method()
    @returns({ name: 'count', type: ABIDataTypes.UINT256 })
    public getTotalPlanCount(_calldata: Calldata): BytesWriter {
        const count: u256 = SafeMath.sub(this.nextPlanId.value, u256.One);
        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(count);
        return writer;
    }

    private getPaymentTokenAddress(): Address {
        const tokenU256: u256 = this.paymentTokenStore.value;
        if (tokenU256.isZero()) throw new Revert('Payment token not set');
        return this.u256ToAddress(tokenU256);
    }

    private u256ToAddress(val: u256): Address {
        const addr: Address = new Address([]);
        const bytes: Uint8Array = val.toUint8Array(true);
        for (let i: i32 = 0; i < 32; i++) {
            addr[i] = bytes[i];
        }
        return addr;
    }

    private requireValidPlan(planId: u256): void {
        if (planId.isZero() || planId >= this.nextPlanId.value) {
            throw new Revert('Plan not found');
        }
    }

    private requireValidSubscription(subscriptionId: u256): void {
        if (subscriptionId.isZero() || subscriptionId >= this.nextSubId.value) {
            throw new Revert('Subscription not found');
        }
    }

    private pullTokens(token: Address, from: Address, amount: u256): void {
        const writer = new BytesWriter(100);
        writer.writeSelector(TRANSFER_FROM_SELECTOR);
        writer.writeAddress(from);
        writer.writeAddress(Blockchain.contractAddress);
        writer.writeU256(amount);

        const result = Blockchain.call(token, writer, true);

        if (result.data.byteLength > 0) {
            if (!result.data.readBoolean()) {
                throw new Revert('TransferFrom failed');
            }
        }
    }

    private transferToken(token: Address, to: Address, amount: u256): void {
        const writer = new BytesWriter(68);
        writer.writeSelector(TRANSFER_SELECTOR);
        writer.writeAddress(to);
        writer.writeU256(amount);

        const result = Blockchain.call(token, writer, true);

        if (result.data.byteLength > 0) {
            if (!result.data.readBoolean()) {
                throw new Revert('Transfer failed');
            }
        }
    }

    private queryTokenBalance(token: Address, account: Address): u256 {
        const writer = new BytesWriter(36);
        writer.writeSelector(BALANCE_OF_SELECTOR);
        writer.writeAddress(account);

        const result = Blockchain.call(token, writer, true);
        return result.data.readU256();
    }

    private getSubscriberSubArray(subscriber: Address): StoredU256Array {
        if (!this.subscriberSubsCache.has(subscriber)) {
            const array = new StoredU256Array(subscriberSubsPointer, subscriber);
            this.subscriberSubsCache.set(subscriber, array);
        }

        return this.subscriberSubsCache.get(subscriber);
    }
}
