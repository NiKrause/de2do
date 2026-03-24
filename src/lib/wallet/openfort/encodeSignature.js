import { encodeAbiParameters, toHex } from 'viem';
import { KeyType } from './const.js';

export function encodeWebAuthnSignature(webauthnData, pubKey) {
	return encodeAbiParameters(
		[
			{ name: 'keyType', type: 'uint8' },
			{ name: 'requireUserVerification', type: 'bool' },
			{ name: 'authenticatorData', type: 'bytes' },
			{ name: 'clientDataJSON', type: 'string' },
			{ name: 'challengeIndex', type: 'uint256' },
			{ name: 'typeIndex', type: 'uint256' },
			{ name: 'r', type: 'bytes32' },
			{ name: 's', type: 'bytes32' },
			{
				name: 'pubKey',
				type: 'tuple',
				components: [
					{ name: 'x', type: 'uint256' },
					{ name: 'y', type: 'uint256' }
				]
			}
		],
		[
			KeyType.WEBAUTHN,
			webauthnData.metadata.userVerificationRequired,
			webauthnData.metadata.authenticatorData,
			webauthnData.metadata.clientDataJSON,
			BigInt(webauthnData.metadata.challengeIndex),
			BigInt(webauthnData.metadata.typeIndex),
			toHex(webauthnData.signature.r),
			toHex(webauthnData.signature.s),
			{
				x: BigInt(pubKey.x),
				y: BigInt(pubKey.y)
			}
		]
	);
}
