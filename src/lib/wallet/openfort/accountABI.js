/**
 * Openfort-compatible account ABI used by this app's passkey wallet adapter.
 *
 * Dependency note:
 * - `VITE_IMPLEMENTATION_CONTRACT` must point to a contract that implements this shape.
 * - For local Anvil we may use the repo's dev mock implementation contract.
 * - For Sepolia/Mainnet use a real production implementation deployment.
 */
export const accountABI = [
	{
		inputs: [{ internalType: 'address', name: '_entryPoint', type: 'address' }],
		stateMutability: 'nonpayable',
		type: 'constructor'
	},
	{
		inputs: [
			{ internalType: 'address', name: 'dest', type: 'address' },
			{ internalType: 'uint256', name: 'value', type: 'uint256' },
			{ internalType: 'bytes', name: 'func', type: 'bytes' }
		],
		name: 'execute',
		outputs: [],
		stateMutability: 'payable',
		type: 'function'
	},
	{
		type: 'function',
		name: 'executeBatch',
		inputs: [
			{
				name: 'calls',
				type: 'tuple[]',
				internalType: 'struct BaseAccount.Call[]',
				components: [
					{ name: 'target', type: 'address', internalType: 'address' },
					{ name: 'value', type: 'uint256', internalType: 'uint256' },
					{ name: 'data', type: 'bytes', internalType: 'bytes' }
				]
			}
		],
		outputs: [],
		stateMutability: 'nonpayable'
	},
	{
		inputs: [
			{ internalType: 'address[]', name: '_target', type: 'address[]' },
			{ internalType: 'uint256[]', name: '_value', type: 'uint256[]' },
			{ internalType: 'bytes[]', name: '_calldata', type: 'bytes[]' }
		],
		name: 'executeBatch',
		outputs: [],
		stateMutability: 'payable',
		type: 'function'
	},
	{
		inputs: [
			{
				components: [
					{ internalType: 'enum IKey.KeyType', name: 'keyType', type: 'uint8' },
					{ internalType: 'uint48', name: 'validUntil', type: 'uint48' },
					{ internalType: 'uint48', name: 'validAfter', type: 'uint48' },
					{ internalType: 'uint48', name: 'limits', type: 'uint48' },
					{ internalType: 'bytes', name: 'key', type: 'bytes' },
					{ internalType: 'enum IKey.KeyControl', name: 'keyControl', type: 'uint8' }
				],
				internalType: 'struct IKey.KeyDataReg',
				name: '_keyData',
				type: 'tuple'
			},
			{
				components: [
					{ internalType: 'enum IKey.KeyType', name: 'keyType', type: 'uint8' },
					{ internalType: 'uint48', name: 'validUntil', type: 'uint48' },
					{ internalType: 'uint48', name: 'validAfter', type: 'uint48' },
					{ internalType: 'uint48', name: 'limits', type: 'uint48' },
					{ internalType: 'bytes', name: 'key', type: 'bytes' },
					{ internalType: 'enum IKey.KeyControl', name: 'keyControl', type: 'uint8' }
				],
				internalType: 'struct IKey.KeyDataReg',
				name: '_sessionKeyData',
				type: 'tuple'
			},
			{ internalType: 'bytes', name: '_signature', type: 'bytes' },
			{ internalType: 'bytes32', name: '_initialGuardian', type: 'bytes32' }
		],
		name: 'initialize',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function'
	},
	{
		inputs: [
			{ internalType: 'uint256', name: '_id', type: 'uint256' },
			{ internalType: 'enum ISessionKey.KeyType', name: '_keyType', type: 'uint8' }
		],
		name: 'getKeyById',
		outputs: [
			{
				components: [
					{
						components: [
							{ internalType: 'bytes32', name: 'x', type: 'bytes32' },
							{ internalType: 'bytes32', name: 'y', type: 'bytes32' }
						],
						internalType: 'struct ISessionKey.PubKey',
						name: 'pubKey',
						type: 'tuple'
					},
					{ internalType: 'address', name: 'eoaAddress', type: 'address' },
					{ internalType: 'enum ISessionKey.KeyType', name: 'keyType', type: 'uint8' }
				],
				internalType: 'struct ISessionKey.Key',
				name: '',
				type: 'tuple'
			}
		],
		stateMutability: 'view',
		type: 'function'
	}
];
