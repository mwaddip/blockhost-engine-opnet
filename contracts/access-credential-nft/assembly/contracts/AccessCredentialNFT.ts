import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    ADDRESS_BYTE_LENGTH,
    Blockchain,
    BytesWriter,
    Calldata,
    NetEvent,
    OP_NET,
    Revert,
    SafeMath,
    StoredString,
    StoredU256,
    U256_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';
import { EMPTY_POINTER } from '@btc-vision/btc-runtime/runtime/math/bytes';
import { AddressMemoryMap } from '@btc-vision/btc-runtime/runtime/memory/AddressMemoryMap';
import { StoredMapU256 } from '@btc-vision/btc-runtime/runtime/storage/maps/StoredMapU256';
import { StoredU256Array } from '@btc-vision/btc-runtime/runtime/storage/arrays/StoredU256Array';

// ── Storage Pointers ────────────────────────────────────────────────

const nextTokenIdPointer: u16 = Blockchain.nextPointer;
const maxSupplyPointer: u16 = Blockchain.nextPointer;
const totalSupplyPointer: u16 = Blockchain.nextPointer;
const ownerOfMapPointer: u16 = Blockchain.nextPointer;
const balanceOfMapPointer: u16 = Blockchain.nextPointer;
const ownerTokensMapPointer: u16 = Blockchain.nextPointer;
const tokenIndexMapPointer: u16 = Blockchain.nextPointer;
const userEncryptedPointer: u16 = Blockchain.nextPointer;
const approvalPointer: u16 = Blockchain.nextPointer;
const approvalForAllPointer: u16 = Blockchain.nextPointer;

// ── Events ──────────────────────────────────────────────────────────

@final
export class TransferredEvent extends NetEvent {
    public constructor(from: Address, to: Address, tokenId: u256) {
        const data: BytesWriter = new BytesWriter(
            ADDRESS_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH,
        );
        data.writeAddress(from);
        data.writeAddress(to);
        data.writeU256(tokenId);
        super('Transferred', data);
    }
}

// ── Contract ────────────────────────────────────────────────────────

@final
export class AccessCredentialNFT extends OP_NET {
    private readonly _nextTokenId: StoredU256;
    private readonly _maxSupply: StoredU256;
    private readonly _totalSupply: StoredU256;
    private readonly ownerOfMap: StoredMapU256;
    private readonly balanceOfMap: AddressMemoryMap;
    private readonly tokenIndexMap: StoredMapU256;
    private readonly approvalMap: StoredMapU256;
    private readonly approvalForAllMap: StoredMapU256;
    private readonly ownerTokensMap: Map<string, StoredU256Array> = new Map();

    public constructor() {
        super();
        this._nextTokenId = new StoredU256(nextTokenIdPointer, EMPTY_POINTER);
        this._maxSupply = new StoredU256(maxSupplyPointer, EMPTY_POINTER);
        this._totalSupply = new StoredU256(totalSupplyPointer, EMPTY_POINTER);
        this.ownerOfMap = new StoredMapU256(ownerOfMapPointer);
        this.balanceOfMap = new AddressMemoryMap(balanceOfMapPointer);
        this.tokenIndexMap = new StoredMapU256(tokenIndexMapPointer);
        this.approvalMap = new StoredMapU256(approvalPointer);
        this.approvalForAllMap = new StoredMapU256(approvalForAllPointer);
    }

    public override onDeployment(calldata: Calldata): void {
        super.onDeployment(calldata);

        const maxSupply: u256 = calldata.readU256();
        if (maxSupply.isZero()) throw new Revert('Max supply cannot be zero');

        this._maxSupply.value = maxSupply;
        this._nextTokenId.value = u256.One;
    }

    // ── Mint ────────────────────────────────────────────────────────

    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'userEncrypted', type: ABIDataTypes.STRING },
    )
    @returns({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    @emit('Transferred')
    public mint(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const to: Address = calldata.readAddress();
        const userEncrypted: string = calldata.readStringWithLength();

        if (to === Address.zero()) throw new Revert('Cannot mint to zero address');

        const tokenId: u256 = this._nextTokenId.value;
        if (tokenId > this._maxSupply.value) throw new Revert('Max supply reached');

        // Set owner
        this.ownerOfMap.set(tokenId, u256.fromUint8ArrayBE(to));

        // Add to enumeration (1-based index: 0 = not found)
        const tokenArray = this.getOwnerTokenArray(to);
        const newIndex = tokenArray.getLength();
        tokenArray.push(tokenId);
        this.tokenIndexMap.set(tokenId, u256.fromU32(newIndex + 1));
        tokenArray.save();

        // Update balance
        const currentBalance = this.balanceOfMap.get(to);
        this.balanceOfMap.set(to, SafeMath.add(currentBalance, u256.One));

        // Increment counters
        this._nextTokenId.value = SafeMath.add(tokenId, u256.One);
        this._totalSupply.value = SafeMath.add(this._totalSupply.value, u256.One);

        // Store access data
        const tokenIndex: u64 = tokenId.toU64();
        const ue = new StoredString(userEncryptedPointer, tokenIndex);
        ue.value = userEncrypted;

        this.emitEvent(new TransferredEvent(Address.zero(), to, tokenId));

        const writer: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(tokenId);
        return writer;
    }

    // ── Transfer ────────────────────────────────────────────────────

    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
    )
    @emit('Transferred')
    public transfer(calldata: Calldata): BytesWriter {
        const to: Address = calldata.readAddress();
        const tokenId: u256 = calldata.readU256();
        const from: Address = this.getOwner(tokenId);

        this.requireAuthorized(from, Blockchain.tx.sender, tokenId);
        this.executeTransfer(from, to, tokenId);

        return new BytesWriter(0);
    }

    @method(
        { name: 'from', type: ABIDataTypes.ADDRESS },
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
    )
    @emit('Transferred')
    public transferFrom(calldata: Calldata): BytesWriter {
        const from: Address = calldata.readAddress();
        const to: Address = calldata.readAddress();
        const tokenId: u256 = calldata.readU256();
        const actualOwner: Address = this.getOwner(tokenId);

        if (from !== actualOwner) throw new Revert('From is not the owner');

        this.requireAuthorized(from, Blockchain.tx.sender, tokenId);
        this.executeTransfer(from, to, tokenId);

        return new BytesWriter(0);
    }

    // ── Approval ────────────────────────────────────────────────────

    @method(
        { name: 'approved', type: ABIDataTypes.ADDRESS },
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
    )
    public approve(calldata: Calldata): BytesWriter {
        const approved: Address = calldata.readAddress();
        const tokenId: u256 = calldata.readU256();
        const owner: Address = this.getOwner(tokenId);

        const sender: Address = Blockchain.tx.sender;
        if (sender !== owner && !this.isApprovedForAllInternal(owner, sender)) {
            throw new Revert('Not owner or approved for all');
        }

        this.approvalMap.set(tokenId, u256.fromUint8ArrayBE(approved));
        return new BytesWriter(0);
    }

    @method(
        { name: 'operator', type: ABIDataTypes.ADDRESS },
        { name: 'approved', type: ABIDataTypes.BOOL },
    )
    public setApprovalForAll(calldata: Calldata): BytesWriter {
        const operator: Address = calldata.readAddress();
        const approved: bool = calldata.readBoolean();
        const sender: Address = Blockchain.tx.sender;

        if (sender === operator) throw new Revert('Cannot approve self');

        const key = this.approvalForAllKey(sender, operator);
        this.approvalForAllMap.set(key, approved ? u256.One : u256.Zero);
        return new BytesWriter(0);
    }

    @method(
        { name: 'owner', type: ABIDataTypes.ADDRESS },
        { name: 'operator', type: ABIDataTypes.ADDRESS },
    )
    @returns({ name: 'approved', type: ABIDataTypes.BOOL })
    public isApprovedForAll(calldata: Calldata): BytesWriter {
        const owner: Address = calldata.readAddress();
        const operator: Address = calldata.readAddress();

        const w: BytesWriter = new BytesWriter(1);
        w.writeBoolean(this.isApprovedForAllInternal(owner, operator));
        return w;
    }

    @method({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'approved', type: ABIDataTypes.ADDRESS })
    public getApproved(calldata: Calldata): BytesWriter {
        const tokenId: u256 = calldata.readU256();
        const approvedU256: u256 = this.approvalMap.get(tokenId);

        const w: BytesWriter = new BytesWriter(ADDRESS_BYTE_LENGTH);
        w.writeAddress(this.u256ToAddress(approvedU256));
        return w;
    }

    // ── Burn ────────────────────────────────────────────────────────

    @method({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    @emit('Transferred')
    public burn(calldata: Calldata): BytesWriter {
        const tokenId: u256 = calldata.readU256();
        const owner: Address = this.getOwner(tokenId);

        this.requireAuthorized(owner, Blockchain.tx.sender, tokenId);

        // Remove from enumeration
        this.removeTokenFromEnumeration(owner, tokenId);

        // Clear owner
        this.ownerOfMap.set(tokenId, u256.Zero);

        // Decrement balance
        const currentBalance = this.balanceOfMap.get(owner);
        this.balanceOfMap.set(owner, SafeMath.sub(currentBalance, u256.One));

        // Decrement total supply
        this._totalSupply.value = SafeMath.sub(this._totalSupply.value, u256.One);

        // Clear approval
        this.approvalMap.set(tokenId, u256.Zero);

        this.emitEvent(new TransferredEvent(owner, Address.zero(), tokenId));

        return new BytesWriter(0);
    }

    // ── View Functions ──────────────────────────────────────────────

    @method({ name: 'owner', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'balance', type: ABIDataTypes.UINT256 })
    public balanceOf(calldata: Calldata): BytesWriter {
        const owner: Address = calldata.readAddress();
        if (owner === Address.zero()) throw new Revert('Invalid address');

        const balance: u256 = this.balanceOfMap.get(owner);
        const w: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        w.writeU256(balance);
        return w;
    }

    @method({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'owner', type: ABIDataTypes.ADDRESS })
    public ownerOf(calldata: Calldata): BytesWriter {
        const tokenId: u256 = calldata.readU256();
        const owner: Address = this.getOwner(tokenId);

        const w: BytesWriter = new BytesWriter(ADDRESS_BYTE_LENGTH);
        w.writeAddress(owner);
        return w;
    }

    @method(
        { name: 'owner', type: ABIDataTypes.ADDRESS },
        { name: 'index', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    public tokenOfOwnerByIndex(calldata: Calldata): BytesWriter {
        const owner: Address = calldata.readAddress();
        const index: u256 = calldata.readU256();

        const balance: u256 = this.balanceOfMap.get(owner);
        if (index >= balance) throw new Revert('Index out of bounds');

        const tokenArray = this.getOwnerTokenArray(owner);
        const tokenId: u256 = tokenArray.get(index.toU32());

        const w: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        w.writeU256(tokenId);
        return w;
    }

    @method()
    @returns({ name: 'totalSupply', type: ABIDataTypes.UINT256 })
    public totalSupply(_calldata: Calldata): BytesWriter {
        const w: BytesWriter = new BytesWriter(U256_BYTE_LENGTH);
        w.writeU256(this._totalSupply.value);
        return w;
    }

    // ── Access Data ─────────────────────────────────────────────────

    @method({ name: 'tokenId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'userEncrypted', type: ABIDataTypes.STRING })
    public getUserEncrypted(calldata: Calldata): BytesWriter {
        const tokenId: u256 = calldata.readU256();
        const ownerU256: u256 = this.ownerOfMap.get(tokenId);
        if (ownerU256.isZero()) throw new Revert('Token does not exist');

        const tokenIndex: u64 = tokenId.toU64();
        const ue = new StoredString(userEncryptedPointer, tokenIndex);
        const ueValue: string = ue.value;

        const writer: BytesWriter = new BytesWriter(4 + ueValue.length);
        writer.writeStringWithLength(ueValue);
        return writer;
    }

    @method(
        { name: 'tokenId', type: ABIDataTypes.UINT256 },
        { name: 'userEncrypted', type: ABIDataTypes.STRING },
    )
    public updateUserEncrypted(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const tokenId: u256 = calldata.readU256();
        const userEncrypted: string = calldata.readStringWithLength();

        const ownerU256: u256 = this.ownerOfMap.get(tokenId);
        if (ownerU256.isZero()) throw new Revert('Token does not exist');

        const tokenIndex: u64 = tokenId.toU64();
        const ue = new StoredString(userEncryptedPointer, tokenIndex);
        ue.value = userEncrypted;

        return new BytesWriter(0);
    }

    // ── Internal Helpers ────────────────────────────────────────────

    private getOwner(tokenId: u256): Address {
        const ownerU256: u256 = this.ownerOfMap.get(tokenId);
        if (ownerU256.isZero()) throw new Revert('Token does not exist');
        return this.u256ToAddress(ownerU256);
    }

    private u256ToAddress(val: u256): Address {
        const addr: Address = new Address([]);
        const bytes: Uint8Array = val.toUint8Array(true);
        for (let i: i32 = 0; i < 32; i++) {
            addr[i] = bytes[i];
        }
        return addr;
    }

    private requireAuthorized(owner: Address, sender: Address, tokenId: u256): void {
        if (sender === owner) return;

        const approvedU256: u256 = this.approvalMap.get(tokenId);
        if (!approvedU256.isZero()) {
            const approved: Address = this.u256ToAddress(approvedU256);
            if (sender === approved) return;
        }

        if (this.isApprovedForAllInternal(owner, sender)) return;

        throw new Revert('Not authorized');
    }

    private isApprovedForAllInternal(owner: Address, operator: Address): bool {
        const key = this.approvalForAllKey(owner, operator);
        return !this.approvalForAllMap.get(key).isZero();
    }

    private approvalForAllKey(owner: Address, operator: Address): u256 {
        const combined = new Uint8Array(65); // 32 + 1 separator + 32
        for (let i: i32 = 0; i < 32; i++) {
            combined[i] = owner[i];
        }
        combined[32] = 0xff; // domain separator
        for (let i: i32 = 0; i < 32; i++) {
            combined[i + 33] = operator[i];
        }
        return u256.fromBytes(Blockchain.sha256(combined));
    }

    private executeTransfer(from: Address, to: Address, tokenId: u256): void {
        if (to === Address.zero()) throw new Revert('Cannot transfer to zero address');
        if (from === to) throw new Revert('Cannot transfer to self');

        // Remove from sender enumeration
        this.removeTokenFromEnumeration(from, tokenId);

        // Add to recipient enumeration (1-based index: 0 = not found)
        const toArray = this.getOwnerTokenArray(to);
        const newIndex = toArray.getLength();
        toArray.push(tokenId);
        this.tokenIndexMap.set(tokenId, u256.fromU32(newIndex + 1));
        toArray.save();

        // Update owner
        this.ownerOfMap.set(tokenId, u256.fromUint8ArrayBE(to));

        // Update balances
        const fromBalance = this.balanceOfMap.get(from);
        this.balanceOfMap.set(from, SafeMath.sub(fromBalance, u256.One));
        const toBalance = this.balanceOfMap.get(to);
        this.balanceOfMap.set(to, SafeMath.add(toBalance, u256.One));

        // Clear single-token approval
        this.approvalMap.set(tokenId, u256.Zero);

        this.emitEvent(new TransferredEvent(from, to, tokenId));
    }

    private removeTokenFromEnumeration(owner: Address, tokenId: u256): void {
        const tokenArray = this.getOwnerTokenArray(owner);
        const length = tokenArray.getLength();
        const storedIndex: u256 = this.tokenIndexMap.get(tokenId);
        if (storedIndex.isZero()) throw new Revert('Token not in enumeration');
        const index: u32 = storedIndex.toU32() - 1; // convert 1-based to 0-based

        // Swap with last element if not already last
        if (index < length - 1) {
            const lastTokenId: u256 = tokenArray.get(length - 1);
            tokenArray.set(index, lastTokenId);
            this.tokenIndexMap.set(lastTokenId, u256.fromU32(index + 1)); // 1-based
        }

        tokenArray.deleteLast();
        tokenArray.save();

        this.tokenIndexMap.set(tokenId, u256.Zero);
    }

    private addressToKey(addr: Address): string {
        const HEX: string = '0123456789abcdef';
        let result: string = '';
        for (let i: i32 = 0; i < 32; i++) {
            const b: u8 = unchecked(addr[i]);
            result += HEX.charAt((b >> 4) & 0xf);
            result += HEX.charAt(b & 0xf);
        }
        return result;
    }

    private getOwnerTokenArray(owner: Address): StoredU256Array {
        const key = this.addressToKey(owner);
        if (!this.ownerTokensMap.has(key)) {
            const array = new StoredU256Array(ownerTokensMapPointer, owner.slice(0, 30));
            this.ownerTokensMap.set(key, array);
        }

        return this.ownerTokensMap.get(key);
    }
}
