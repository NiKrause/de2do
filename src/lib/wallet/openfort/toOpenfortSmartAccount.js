import { WebAuthnP256 } from 'ox';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import {
	entryPoint08Abi,
	getUserOperationHash,
	getUserOperationTypedData,
	toSmartAccount
} from 'viem/account-abstraction';
import { accountABI } from './accountABI.js';
import { ENTRY_POINT_VERSION, KeyType } from './const.js';
import { encodeWebAuthnSignature } from './encodeSignature.js';
import { P256_STUB_SIGNATURE } from './stubSignatures.js';
import { beforePasskeyPrompt } from '../../passkey-notice.js';

const executeSingleAbi = [
	{
		inputs: [
			{ internalType: 'address', name: 'dest', type: 'address' },
			{ internalType: 'uint256', name: 'value', type: 'uint256' },
			{ internalType: 'bytes', name: 'func', type: 'bytes' }
		],
		name: 'execute',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function'
	}
];

const executeBatch08Abi = [
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
	}
];

async function getAccountNonce(client, { address, entryPointAddress, key = 0n }) {
	return await client.readContract({
		address: entryPointAddress,
		abi: [
			{
				inputs: [
					{ name: 'sender', type: 'address' },
					{ name: 'key', type: 'uint192' }
				],
				name: 'getNonce',
				outputs: [{ name: 'nonce', type: 'uint256' }],
				stateMutability: 'view',
				type: 'function'
			}
		],
		functionName: 'getNonce',
		args: [address, key]
	});
}

async function getCredentialFromChain(client, { address, credentialId }) {
	const key = await client.readContract({
		address,
		abi: accountABI,
		functionName: 'getKeyById',
		args: [0n, KeyType.WEBAUTHN]
	});

	return {
		id: credentialId,
		x: key.pubKey.x,
		y: key.pubKey.y
	};
}

/**
 * Build a viem smart-account adapter for an Openfort-compatible 7702 implementation.
 *
 * Dependency note:
 * - The account logic delegated via `VITE_IMPLEMENTATION_CONTRACT` must support
 *   the Openfort methods encoded in `accountABI` (initialize/execute/executeBatch, etc.).
 * - Local development can use the repo's mock implementation.
 * - Sepolia/Mainnet should use a real production implementation deployment.
 */
export async function toOpenfortSmartAccount({
	client,
	owner,
	address: accountAddress,
	entryPointAddress,
	credential,
	credentialId,
	nonceKey
}) {
	const address = accountAddress ?? owner?.address;
	if (!address) throw new Error('Account address not found');

	let resolvedCredential = credential;
	if (!resolvedCredential) {
		if (!credentialId) {
			throw new Error('Passkey credential data is required');
		}
		resolvedCredential = await getCredentialFromChain(client, { address, credentialId });
	}

	if (!resolvedCredential?.id || !resolvedCredential?.x || !resolvedCredential?.y) {
		throw new Error('Passkey credential data is required');
	}

	const entryPoint = {
		address: entryPointAddress,
		abi: entryPoint08Abi,
		version: ENTRY_POINT_VERSION
	};

	const getChainId = async () => {
		if (client.chain?.id) return client.chain.id;
		return await client.getChainId();
	};

	const baseSmartAccount = toSmartAccount({
		client,
		entryPoint,
		getFactoryArgs: async () => ({ factory: undefined, factoryData: undefined }),
		async getAddress() {
			return address;
		},
		async encodeCalls(calls) {
			if (calls.length > 1) {
				return encodeFunctionData({
					abi: accountABI,
					functionName: 'executeBatch',
					args: [
						calls.map((call) => call.to),
						calls.map((call) => call.value ?? 0n),
						calls.map((call) => call.data ?? '0x')
					]
				});
			}

			const call = calls.length === 0 ? undefined : calls[0];
			if (!call) throw new Error('No calls to encode');

			return encodeFunctionData({
				abi: executeSingleAbi,
				functionName: 'execute',
				args: [call.to, call.value ?? 0n, call.data ?? '0x']
			});
		},
		decodeCalls: async (callData) => {
			try {
				const decodedBatch = decodeFunctionData({ abi: executeBatch08Abi, data: callData });
				return decodedBatch.args[0].map((call) => ({
					to: call.target,
					data: call.data,
					value: call.value
				}));
			} catch {
				const decodedSingle = decodeFunctionData({ abi: executeSingleAbi, data: callData });
				return [
					{
						to: decodedSingle.args[0],
						value: decodedSingle.args[1],
						data: decodedSingle.args[2]
					}
				];
			}
		},
		async getNonce(args) {
			return getAccountNonce(client, {
				address: await this.getAddress(),
				entryPointAddress: entryPoint.address,
				key: nonceKey ?? args?.key ?? 0n
			});
		},
		async getStubSignature() {
			return P256_STUB_SIGNATURE;
		},
		async signUserOperation(parameters) {
			const { chainId = await getChainId(), ...userOperation } = parameters;
			const sender = userOperation.sender ?? (await this.getAddress());

			if (owner?.signTypedData) {
				const typedData = getUserOperationTypedData({
					chainId,
					entryPointAddress: entryPoint.address,
					userOperation: {
						...userOperation,
						sender,
						signature: '0x'
					}
				});
				return await owner.signTypedData(typedData);
			}

			const userOpHash = getUserOperationHash({
				entryPointVersion: ENTRY_POINT_VERSION,
				chainId,
				entryPointAddress,
				userOperation: { ...userOperation, sender, signature: '0x' }
			});

			await beforePasskeyPrompt(
				'Approve blockchain transaction',
				'Needed to sign this smart-account transaction with your passkey wallet.'
			);

			const webauthnData = await WebAuthnP256.sign({
				challenge: userOpHash,
				credentialId: resolvedCredential.id,
				rpId: window.location.hostname,
				userVerification: 'required'
			});

			return encodeWebAuthnSignature(webauthnData, {
				x: resolvedCredential.x,
				y: resolvedCredential.y
			});
		}
	});

	return baseSmartAccount;
}
