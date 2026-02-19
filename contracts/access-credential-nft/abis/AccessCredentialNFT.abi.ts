import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const AccessCredentialNFTEvents = [
    {
        name: 'Transferred',
        values: [
            { name: 'from', type: ABIDataTypes.ADDRESS },
            { name: 'to', type: ABIDataTypes.ADDRESS },
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Event,
    },
];

export const AccessCredentialNFTAbi = [
    {
        name: 'mint',
        inputs: [
            { name: 'to', type: ABIDataTypes.ADDRESS },
            { name: 'userEncrypted', type: ABIDataTypes.STRING },
        ],
        outputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'transfer',
        inputs: [
            { name: 'to', type: ABIDataTypes.ADDRESS },
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'transferFrom',
        inputs: [
            { name: 'from', type: ABIDataTypes.ADDRESS },
            { name: 'to', type: ABIDataTypes.ADDRESS },
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'approve',
        inputs: [
            { name: 'approved', type: ABIDataTypes.ADDRESS },
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setApprovalForAll',
        inputs: [
            { name: 'operator', type: ABIDataTypes.ADDRESS },
            { name: 'approved', type: ABIDataTypes.BOOL },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isApprovedForAll',
        inputs: [
            { name: 'owner', type: ABIDataTypes.ADDRESS },
            { name: 'operator', type: ABIDataTypes.ADDRESS },
        ],
        outputs: [{ name: 'approved', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getApproved',
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'approved', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'burn',
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'balanceOf',
        inputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'ownerOf',
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'owner', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'tokenOfOwnerByIndex',
        inputs: [
            { name: 'owner', type: ABIDataTypes.ADDRESS },
            { name: 'index', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'totalSupply',
        inputs: [],
        outputs: [{ name: 'totalSupply', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getUserEncrypted',
        inputs: [{ name: 'tokenId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'userEncrypted', type: ABIDataTypes.STRING }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'updateUserEncrypted',
        inputs: [
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
            { name: 'userEncrypted', type: ABIDataTypes.STRING },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    ...AccessCredentialNFTEvents,
    ...OP_NET_ABI,
];

export default AccessCredentialNFTAbi;
