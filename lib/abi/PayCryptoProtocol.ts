
export const payNativeWithMemoAbi = [
    {
        name: 'payNativeWithMemo',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'memo', type: 'string' }
        ],
        outputs: [],
    },
]

export const payWithMemoAbi = [
    {
        name: 'payWithMemo',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'memo', type: 'string' },
        ],
        outputs: [],
    },
]
