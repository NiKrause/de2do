export const todoEscrowAbi = [
  {
    type: 'function',
    name: 'lockEth',
    stateMutability: 'payable',
    inputs: [
      { name: 'todoId', type: 'bytes32' },
      { name: 'beneficiary', type: 'address' },
      { name: 'deadline', type: 'uint64' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'lockToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'todoId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'deadline', type: 'uint64' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'release',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'todoId', type: 'bytes32' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'todoId', type: 'bytes32' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'escrows',
    stateMutability: 'view',
    inputs: [{ name: 'todoId', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'beneficiary', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'released', type: 'bool' },
      { name: 'refunded', type: 'bool' },
      { name: 'deadline', type: 'uint64' }
    ]
  }
];
