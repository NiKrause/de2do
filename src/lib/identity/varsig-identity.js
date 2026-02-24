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

export async function getOrCreateVarsigIdentity(credential) {
	const cached = loadCachedVarsigIdentity();
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

// Re-export package functions used by other app modules
export {
	verifyVarsigIdentity,
	createIpfsIdentityStorage,
	createWebAuthnVarsigIdentities,
	wrapWithVarsigVerification
};
