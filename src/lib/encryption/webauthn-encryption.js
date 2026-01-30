import {
	WebAuthnDIDProvider,
	generateSecretKey,
	wrapSKWithPRF,
	unwrapSKWithPRF,
	loadWebAuthnVarsigCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';

const STORAGE_PREFIX = 'simple-encryption-sk-v1:';

function toStorageKey(credential) {
	if (!credential) return null;
	if (credential.credentialId) {
		return `${STORAGE_PREFIX}${credential.credentialId}`;
	}
	if (credential.rawCredentialId) {
		let binary = '';
		for (let i = 0; i < credential.rawCredentialId.length; i += 1) {
			binary += String.fromCharCode(credential.rawCredentialId[i]);
		}
		return `${STORAGE_PREFIX}${btoa(binary)}`;
	}
	return null;
}

function decodeBytes(value) {
	if (!Array.isArray(value)) return null;
	return new Uint8Array(value);
}

export function isWebAuthnEncryptionAvailable() {
	if (typeof window === 'undefined') return false;
	return WebAuthnDIDProvider.isSupported();
}

export async function getWebAuthnEncryptionKey({ allowCreate = true } = {}) {
	if (typeof window === 'undefined') return null;
	if (!WebAuthnDIDProvider.isSupported()) return null;

	const varsigCredential = loadWebAuthnVarsigCredential();
	if (!varsigCredential?.credentialId) {
		return null;
	}

	const credential = { rawCredentialId: varsigCredential.credentialId };

	const storageKey = toStorageKey(credential);
	const rpId = window.location.hostname;

	if (storageKey) {
		const stored = localStorage.getItem(storageKey);
		if (stored) {
			try {
				const parsed = JSON.parse(stored);
				const wrappedSK = decodeBytes(parsed.wrappedSK);
				const wrappingIV = decodeBytes(parsed.wrappingIV);
				const salt = decodeBytes(parsed.salt);
				if (wrappedSK && wrappingIV && salt) {
					return await unwrapSKWithPRF(
						credential.rawCredentialId,
						wrappedSK,
						wrappingIV,
						salt,
						rpId
					);
				}
			} catch (error) {
				console.warn('Failed to unwrap WebAuthn encryption key:', error);
			}
		}
	}

	if (!allowCreate) {
		return null;
	}

	try {
		const sk = generateSecretKey();
		const { wrappedSK, wrappingIV, salt } = await wrapSKWithPRF(
			credential.rawCredentialId,
			sk,
			rpId,
			undefined
		);
		if (storageKey) {
			localStorage.setItem(
				storageKey,
				JSON.stringify({
					wrappedSK: Array.from(wrappedSK),
					wrappingIV: Array.from(wrappingIV),
					salt: Array.from(salt),
					method: 'prf'
				})
			);
		}
		return sk;
	} catch (error) {
		console.warn('Failed to create WebAuthn encryption key:', error);
		return null;
	}
}
