import * as Block from 'multiformats/block';
import * as dagCbor from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import { concat, bytesToBase64url, base64urlToBytes } from 'iso-webauthn-varsig';
import { CID } from 'multiformats/cid';
import { WebAuthnVarsigProvider } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { createWebAuthnVarsigIdentity } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { showToast } from '../toast-store.js';

const STORAGE_KEY_IDENTITY = 'webauthn-varsig-orbitdb-identity';
const IDENTITY_CODEC = dagCbor;
const IDENTITY_HASHER = sha256;
const IDENTITY_HASH_ENCODING = base58btc;
const encoder = new TextEncoder();
const DEFAULT_DOMAIN_LABELS = {
	id: 'orbitdb-id:',
	publicKey: 'orbitdb-pubkey:',
	entry: 'orbitdb-entry:'
};
let lastPasskeyToastAt = 0;

function showPasskeyPrompt(reason) {
	const now = Date.now();
	if (now - lastPasskeyToastAt < 1500) return;
	lastPasskeyToastAt = now;
	showToast(`🔐 Passkey required: ${reason}`, 'default', 3000);
}

function serializeIdentity(identity) {
	return JSON.stringify({
		id: identity.id,
		publicKey: bytesToBase64url(identity.publicKey),
		signatures: {
			id: bytesToBase64url(identity.signatures.id),
			publicKey: bytesToBase64url(identity.signatures.publicKey)
		},
		type: identity.type,
		hash: identity.hash,
		bytes: bytesToBase64url(identity.bytes)
	});
}

function deserializeIdentity(payload) {
	if (!payload) return null;
	try {
		const parsed = JSON.parse(payload);
		if (!parsed?.id || !parsed?.publicKey || !parsed?.signatures?.id || !parsed?.signatures?.publicKey) {
			return null;
		}
		return {
			id: parsed.id,
			publicKey: base64urlToBytes(parsed.publicKey),
			signatures: {
				id: base64urlToBytes(parsed.signatures.id),
				publicKey: base64urlToBytes(parsed.signatures.publicKey)
			},
			type: parsed.type || 'webauthn-varsig',
			hash: parsed.hash,
			bytes: parsed.bytes ? base64urlToBytes(parsed.bytes) : null
		};
	} catch {
		return null;
	}
}

async function encodeIdentityValue(value) {
	const { cid, bytes } = await Block.encode({
		value,
		codec: IDENTITY_CODEC,
		hasher: IDENTITY_HASHER
	});
	return {
		hash: cid.toString(IDENTITY_HASH_ENCODING),
		bytes: Uint8Array.from(bytes)
	};
}

async function verifyCachedIdentity(identity) {
	const provider = new WebAuthnVarsigProvider({
		credentialId: new Uint8Array(),
		publicKey: identity.publicKey,
		algorithm: identity.publicKey.length === 32 ? 'Ed25519' : 'P-256'
	});
	const idBytes = encoder.encode(identity.id);
	const idValid = await provider.verify(
		identity.signatures.id,
		identity.publicKey,
		idBytes,
		DEFAULT_DOMAIN_LABELS.id
	);
	if (!idValid) return false;
	const pubKeyPayload = concat([identity.publicKey, identity.signatures.id]);
	return provider.verify(
		identity.signatures.publicKey,
		identity.publicKey,
		pubKeyPayload,
		DEFAULT_DOMAIN_LABELS.publicKey
	);
}

export function loadCachedVarsigIdentity() {
	if (typeof window === 'undefined') return null;
	const stored = localStorage.getItem(STORAGE_KEY_IDENTITY);
	const identity = deserializeIdentity(stored);
	if (identity) {
		console.log('🔐 Varsig identity cache loaded', {
			id: identity.id,
			type: identity.type,
			hash: identity.hash
		});
	}
	return identity;
}

export function storeCachedVarsigIdentity(identity) {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY_IDENTITY, serializeIdentity(identity));
		console.log('🔐 Varsig identity cached');
	} catch (error) {
		console.warn('Failed to store varsig identity:', error);
	}
}

export async function getOrCreateVarsigIdentity(credential) {
	const cached = loadCachedVarsigIdentity();
	if (cached) {
		try {
			const valid = await verifyCachedIdentity(cached);
			console.log('🔐 Varsig cached identity valid:', valid);
			if (valid) {
				let bytes = cached.bytes;
				let hash = cached.hash;
				if (!bytes || !hash) {
					const encoded = await encodeIdentityValue({
						id: cached.id,
						publicKey: cached.publicKey,
						signatures: cached.signatures,
						type: cached.type || 'webauthn-varsig'
					});
					bytes = encoded.bytes;
					hash = encoded.hash;
				}
				const provider = new WebAuthnVarsigProvider(credential);
				const restored = {
					...cached,
					bytes,
					hash,
					sign: (_identity, data) => {
						showPasskeyPrompt('sign database entry');
						return provider.sign(data, DEFAULT_DOMAIN_LABELS.entry);
					},
					verify: (signature, data) =>
						provider.verify(signature, cached.publicKey, data, DEFAULT_DOMAIN_LABELS.entry)
				};
				console.log('🔐 Varsig identity restored from cache', {
					id: restored.id,
					type: restored.type,
					hash: restored.hash
				});
				return restored;
			}
		} catch (error) {
			console.warn('Cached varsig identity verification failed, recreating:', error);
		}
	}

	showPasskeyPrompt('create varsig identity (2 confirmations)');
	const identity = await createWebAuthnVarsigIdentity({ credential });
	storeCachedVarsigIdentity(identity);
	console.log('🔐 Varsig identity created and cached', {
		id: identity.id,
		type: identity.type,
		hash: identity.hash
	});
	const provider = new WebAuthnVarsigProvider(credential);
	return {
		...identity,
		sign: (_identity, data) => {
			showPasskeyPrompt('sign database entry');
			return provider.sign(data, DEFAULT_DOMAIN_LABELS.entry);
		},
		verify: (signature, data) =>
			provider.verify(signature, identity.publicKey, data, DEFAULT_DOMAIN_LABELS.entry)
	};
}

async function decodeIdentityFromBytes(bytes) {
	const { value } = await Block.decode({
		bytes,
		codec: IDENTITY_CODEC,
		hasher: IDENTITY_HASHER
	});
	const decoded = value;
	const { hash: decodedHash } = await encodeIdentityValue({
		id: decoded.id,
		publicKey: decoded.publicKey,
		signatures: decoded.signatures,
		type: decoded.type
	});
	return {
		id: decoded.id,
		publicKey: decoded.publicKey,
		signatures: decoded.signatures,
		type: decoded.type,
		hash: decodedHash,
		bytes,
		sign: async () => {
			throw new Error('Remote identity cannot sign');
		},
		verify: (signature, data) => {
			const provider = new WebAuthnVarsigProvider({
				credentialId: new Uint8Array(),
				publicKey: decoded.publicKey,
				algorithm: decoded.publicKey.length === 32 ? 'Ed25519' : 'P-256'
			});
			return provider.verify(signature, decoded.publicKey, data, DEFAULT_DOMAIN_LABELS.entry);
		}
	};
}

export function createWebAuthnVarsigIdentitiesWithStorage(identity, storage, credential) {
	const identityByHash = new Map([[identity.hash, identity]]);
	const provider = new WebAuthnVarsigProvider(credential);

	if (storage?.put) {
		storage.put(identity.hash, identity.bytes);
	}

	const verify = (signature, publicKey, data) =>
		provider.verify(signature, publicKey, data, DEFAULT_DOMAIN_LABELS.entry);

	const verifyIdentity = async (identityToVerify) => {
		if (!identityToVerify) return false;
		const idBytes = encoder.encode(identityToVerify.id);
		const idValid = await provider.verify(
			identityToVerify.signatures.id,
			identityToVerify.publicKey,
			idBytes,
			DEFAULT_DOMAIN_LABELS.id
		);
		if (!idValid) return false;
		const pubKeyPayload = concat([
			identityToVerify.publicKey,
			identityToVerify.signatures.id
		]);
		return provider.verify(
			identityToVerify.signatures.publicKey,
			identityToVerify.publicKey,
			pubKeyPayload,
			DEFAULT_DOMAIN_LABELS.publicKey
		);
	};

	const getIdentity = async (hash) => {
		const cached = identityByHash.get(hash);
		if (cached) return cached;
		if (!storage?.get) return null;
		const bytes = await storage.get(hash);
		if (!bytes) return null;
		const decoded = await decodeIdentityFromBytes(bytes);
		identityByHash.set(decoded.hash, decoded);
		return decoded;
	};

	const addIdentity = (newIdentity) => {
		if (!newIdentity?.hash) return;
		identityByHash.set(newIdentity.hash, newIdentity);
		if (storage?.put) {
			storage.put(newIdentity.hash, newIdentity.bytes);
		}
	};

	return {
		createIdentity: async () => identity,
		verifyIdentity,
		getIdentity,
		addIdentity,
		sign: (identityInstance, data) => identityInstance.sign(identityInstance, data),
		verify,
		keystore: null
	};
}

export function createIpfsIdentityStorage(ipfs) {
	if (!ipfs?.blockstore) return null;
	return {
		get: async (hash) => {
			try {
				const cid = CID.parse(hash);
				return await ipfs.blockstore.get(cid);
			} catch {
				return undefined;
			}
		},
		put: async (hash, bytes) => {
			const cid = CID.parse(hash);
			await ipfs.blockstore.put(cid, bytes);
		}
	};
}
