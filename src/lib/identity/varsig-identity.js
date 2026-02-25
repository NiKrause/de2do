import {
	WebAuthnVarsigProvider,
	createWebAuthnVarsigIdentity,
	encodeIdentityValue,
	verifyVarsigIdentity,
	createIpfsIdentityStorage,
	createWebAuthnVarsigIdentities,
	wrapWithVarsigVerification,
	DEFAULT_DOMAIN_LABELS
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { showToast } from '../toast-store.js';

function bytesToBase64url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
	const padded =
		str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (str.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

const STORAGE_KEY_IDENTITY = 'webauthn-varsig-orbitdb-identity';
let lastPasskeyToastAt = 0;

function bytesEqual(a, b) {
	if (a instanceof ArrayBuffer) a = new Uint8Array(a);
	if (b instanceof ArrayBuffer) b = new Uint8Array(b);
	if (ArrayBuffer.isView(a) && !(a instanceof Uint8Array)) {
		a = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
	}
	if (ArrayBuffer.isView(b) && !(b instanceof Uint8Array)) {
		b = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
	}
	if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function verifyWithFlexibleArgs(provider, fallbackPublicKey, signature, arg2, arg3) {
	// OrbitDB calls identities.verify(signature, publicKey, data).
	// Some callers may still pass verify(signature, data).
	const hasExplicitPublicKey = arg3 !== undefined;
	const publicKey = hasExplicitPublicKey ? arg2 : fallbackPublicKey;
	const data = hasExplicitPublicKey ? arg3 : arg2;
	return provider.verify(signature, publicKey, data, DEFAULT_DOMAIN_LABELS.entry);
}

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
		if (
			!parsed?.id ||
			!parsed?.publicKey ||
			!parsed?.signatures?.id ||
			!parsed?.signatures?.publicKey
		) {
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

export function clearCachedVarsigIdentity() {
	if (typeof window === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_KEY_IDENTITY);
		console.log('🧹 Cleared cached varsig identity');
	} catch (error) {
		console.warn('Failed to clear cached varsig identity:', error);
	}
}

export async function getOrCreateVarsigIdentity(credential) {
	let cached = loadCachedVarsigIdentity();
	if (cached && credential) {
		const didMismatch = Boolean(credential.did && cached.id !== credential.did);
		const publicKeyMismatch = Boolean(
			credential.publicKey &&
				cached.publicKey instanceof Uint8Array &&
				!bytesEqual(cached.publicKey, credential.publicKey)
		);
		if (didMismatch || publicKeyMismatch) {
			console.warn('⚠️ Cached varsig identity does not match current credential, recreating', {
				cachedId: cached.id,
				credentialDid: credential.did || null,
				didMismatch,
				publicKeyMismatch
			});
			clearCachedVarsigIdentity();
			cached = null;
		}
	}
	if (cached) {
		try {
			const valid = await verifyVarsigIdentity(cached);
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
						verify: (signature, arg2, arg3) =>
							verifyWithFlexibleArgs(provider, cached.publicKey, signature, arg2, arg3)
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
		verify: (signature, arg2, arg3) =>
			verifyWithFlexibleArgs(provider, identity.publicKey, signature, arg2, arg3)
	};
}

// Re-export package functions used by other app modules
export {
	verifyVarsigIdentity,
	createIpfsIdentityStorage,
	createWebAuthnVarsigIdentities,
	wrapWithVarsigVerification
};
