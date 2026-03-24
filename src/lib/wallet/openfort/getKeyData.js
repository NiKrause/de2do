import { encodeAbiParameters } from 'viem';
import { KeyControl, KeyType } from './const.js';

export async function getWebAuthnMK(x, y) {
	const now = Math.floor(Date.now() / 1000);
	const validUntil = BigInt(now + 6000 * 60 * 24 * 30);
	const encodedKey = encodeAbiParameters(
		[
			{ name: 'x', type: 'bytes32' },
			{ name: 'y', type: 'bytes32' }
		],
		[x, y]
	);

	const masterKeyData = {
		keyType: KeyType.WEBAUTHN,
		validUntil,
		validAfter: 0n,
		limits: 0n,
		key: encodedKey,
		keyControl: KeyControl.SELF
	};

	const selectors = [
		'0xa9059cbb', // transfer(address,uint256)
		'0x40c10f19' // mint(address,uint256)
	];

	const sessionKeyData = {
		keyType: KeyType.EOA,
		validUntil: 0n,
		validAfter: 0n,
		limits: 0n,
		key: '0x',
		keyControl: KeyControl.SELF
	};

	return { masterKeyData, sessionKeyData, selectors, validUntil };
}
