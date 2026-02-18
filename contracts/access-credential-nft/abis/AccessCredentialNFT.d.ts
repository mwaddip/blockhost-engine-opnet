import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------
export type TransferredEvent = {
    readonly from: Address;
    readonly to: Address;
    readonly tokenId: bigint;
    readonly operator: Address;
    readonly from: Address;
    readonly to: Address;
    readonly amount: bigint;
};

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the mint function call.
 */
export type Mint = CallResult<
    {
        tokenId: bigint;
    },
    OPNetEvent<TransferredEvent>[]
>;

/**
 * @description Represents the result of the transfer function call.
 */
export type Transfer = CallResult<{}, OPNetEvent<TransferredEvent>[]>;

/**
 * @description Represents the result of the transferFrom function call.
 */
export type TransferFrom = CallResult<{}, OPNetEvent<TransferredEvent>[]>;

/**
 * @description Represents the result of the approve function call.
 */
export type Approve = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the setApprovalForAll function call.
 */
export type SetApprovalForAll = CallResult<{}, OPNetEvent<never>[]>;

/**
 * @description Represents the result of the isApprovedForAll function call.
 */
export type IsApprovedForAll = CallResult<
    {
        approved: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getApproved function call.
 */
export type GetApproved = CallResult<
    {
        approved: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the burn function call.
 */
export type Burn = CallResult<{}, OPNetEvent<TransferredEvent>[]>;

/**
 * @description Represents the result of the balanceOf function call.
 */
export type BalanceOf = CallResult<
    {
        balance: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the ownerOf function call.
 */
export type OwnerOf = CallResult<
    {
        owner: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the tokenOfOwnerByIndex function call.
 */
export type TokenOfOwnerByIndex = CallResult<
    {
        tokenId: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the totalSupply function call.
 */
export type TotalSupply = CallResult<
    {
        totalSupply: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getUserEncrypted function call.
 */
export type GetUserEncrypted = CallResult<
    {
        userEncrypted: string;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the updateUserEncrypted function call.
 */
export type UpdateUserEncrypted = CallResult<{}, OPNetEvent<never>[]>;

// ------------------------------------------------------------------
// IAccessCredentialNFT
// ------------------------------------------------------------------
export interface IAccessCredentialNFT extends IOP_NETContract {
    mint(to: Address, userEncrypted: string): Promise<Mint>;
    transfer(to: Address, tokenId: bigint): Promise<Transfer>;
    transferFrom(from: Address, to: Address, tokenId: bigint): Promise<TransferFrom>;
    approve(approved: Address, tokenId: bigint): Promise<Approve>;
    setApprovalForAll(operator: Address, approved: boolean): Promise<SetApprovalForAll>;
    isApprovedForAll(owner: Address, operator: Address): Promise<IsApprovedForAll>;
    getApproved(tokenId: bigint): Promise<GetApproved>;
    burn(tokenId: bigint): Promise<Burn>;
    balanceOf(owner: Address): Promise<BalanceOf>;
    ownerOf(tokenId: bigint): Promise<OwnerOf>;
    tokenOfOwnerByIndex(owner: Address, index: bigint): Promise<TokenOfOwnerByIndex>;
    totalSupply(): Promise<TotalSupply>;
    getUserEncrypted(tokenId: bigint): Promise<GetUserEncrypted>;
    updateUserEncrypted(tokenId: bigint, userEncrypted: string): Promise<UpdateUserEncrypted>;
}
