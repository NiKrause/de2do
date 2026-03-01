import {
	WebAuthnDIDProvider,
	WebAuthnVarsigProvider,
	addPRFToCredentialOptions,
	storeWebAuthnVarsigCredential,
	loadWebAuthnVarsigCredential,
	clearWebAuthnVarsigCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { getOrCreateVarsigIdentity, clearCachedVarsigIdentity } from './varsig-identity.js';
import { showToast } from '../toast-store.js';
import { DIDKey } from '@le-space/iso-did';
import { parseAttestationObject } from '@le-space/iso-passkeys';

// Legacy storage keys for WebAuthn credentials (kept for compatibility)
const STORAGE_KEY_CREDENTIAL_ID = 'webauthn_credential_id';
const STORAGE_KEY_CREDENTIAL_TYPE = 'webauthn_credential_type';
const STORAGE_KEY_USER_HANDLE = 'webauthn_user_handle';
const STORAGE_KEY_PREFERRED_AUTH_MODE = 'webauthn_preferred_auth_mode';

const WEBAUTHN_AUTH_MODES = {
	WORKER: 'worker',
	HARDWARE: 'hardware'
};

function toBase64(bytes) {
	if (!bytes || bytes.length === 0) return '';
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function persistCredentialMetadata({ type, credentialId, userId }) {
	try {
		const encodedId =
			credentialId instanceof Uint8Array
				? toBase64(credentialId)
				: typeof credentialId === 'string'
					? credentialId
					: '';
		if (encodedId) {
			localStorage.setItem(STORAGE_KEY_CREDENTIAL_ID, encodedId);
		}
		if (type) {
			localStorage.setItem(STORAGE_KEY_CREDENTIAL_TYPE, type);
		}
		if (userId) {
			const userHandleBase64 = toBase64(new TextEncoder().encode(userId));
			localStorage.setItem(STORAGE_KEY_USER_HANDLE, userHandleBase64);
		}
	} catch (error) {
		console.warn('Failed to persist WebAuthn credential metadata:', error);
	}
}

export function getPreferredWebAuthnMode() {
	try {
		const mode = localStorage.getItem(STORAGE_KEY_PREFERRED_AUTH_MODE);
		return mode === WEBAUTHN_AUTH_MODES.HARDWARE
			? WEBAUTHN_AUTH_MODES.HARDWARE
			: WEBAUTHN_AUTH_MODES.WORKER;
	} catch {
		return WEBAUTHN_AUTH_MODES.WORKER;
	}
}

export function setPreferredWebAuthnMode(mode) {
	if (mode !== WEBAUTHN_AUTH_MODES.WORKER && mode !== WEBAUTHN_AUTH_MODES.HARDWARE) {
		return;
	}
	try {
		localStorage.setItem(STORAGE_KEY_PREFERRED_AUTH_MODE, mode);
	} catch {
		// ignore
	}
}

function toArrayBuffer(value) {
	if (value instanceof ArrayBuffer) return value;
	if (ArrayBuffer.isView(value)) return value.buffer;
	return value;
}

function extractVarsigCredentialInfo(attestationObject) {
	const parsed = parseAttestationObject(toArrayBuffer(attestationObject));
	const coseKey = parsed.authData.credentialPublicKey;
	if (!coseKey) {
		throw new Error('Credential public key missing from attestation');
	}

	const getValue = (key) => (coseKey instanceof Map ? coseKey.get(key) : coseKey[key]);
	const kty = getValue(1);
	const alg = getValue(3);
	const crv = getValue(-1);

	if (kty === 1 && (alg === -50 || alg === -8) && crv === 6) {
		const publicKeyBytes = new Uint8Array(getValue(-2));
		if (publicKeyBytes.length !== 32) {
			throw new Error(`Invalid Ed25519 public key length: ${publicKeyBytes.length}`);
		}
		return { algorithm: 'Ed25519', publicKey: publicKeyBytes, kty, alg, crv };
	}

	if (kty === 2 && alg === -7 && crv === 1) {
		const x = new Uint8Array(getValue(-2));
		const y = new Uint8Array(getValue(-3));
		if (x.length !== 32 || y.length !== 32) {
			throw new Error(`Invalid P-256 coordinate length: x=${x.length} y=${y.length}`);
		}
		const publicKeyBytes = new Uint8Array(65);
		publicKeyBytes[0] = 0x04;
		publicKeyBytes.set(x, 1);
		publicKeyBytes.set(y, 33);
		return { algorithm: 'P-256', publicKey: publicKeyBytes, kty, alg, crv };
	}

	return { algorithm: null, publicKey: null, kty, alg, crv };
}

async function createWebAuthnVarsigCredentialWithPrf(options = {}) {
	const { userId, displayName, domain } = {
		userId: `orbitdb-user-${Date.now()}`,
		displayName: 'OrbitDB Varsig User',
		domain: window.location.hostname,
		...options
	};

	const publicKey = {
		rp: { name: 'OrbitDB Varsig Identity', id: domain },
		user: {
			id: crypto.getRandomValues(new Uint8Array(16)),
			name: userId,
			displayName
		},
		challenge: crypto.getRandomValues(new Uint8Array(32)),
		pubKeyCredParams: [
			{ type: 'public-key', alg: -50 },
			{ type: 'public-key', alg: -8 },
			{ type: 'public-key', alg: -7 }
		],
		attestation: 'none',
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred'
		}
	};

	const { credentialOptions } = addPRFToCredentialOptions(publicKey);
	const credential = await navigator.credentials.create({ publicKey: credentialOptions });
	if (!credential) {
		throw new Error('Passkey registration failed.');
	}

	const response = credential.response;
	const {
		algorithm,
		publicKey: publicKeyBytes,
		kty,
		alg,
		crv
	} = extractVarsigCredentialInfo(new Uint8Array(response.attestationObject));

	if (!publicKeyBytes || !algorithm) {
		throw new Error('No supported credential returned (expected Ed25519 or P-256).');
	}

	const credentialId = new Uint8Array(credential.rawId);
	const did = DIDKey.fromPublicKey(algorithm, publicKeyBytes).did;

	return {
		credentialId,
		publicKey: publicKeyBytes,
		did,
		algorithm,
		cose: { kty, alg, crv }
	};
}

/**
 * Check if WebAuthn is available in the current browser
 * @returns {boolean} True if WebAuthn is supported
 */
export function isWebAuthnAvailable() {
	return (
		typeof window !== 'undefined' &&
		window.PublicKeyCredential !== undefined &&
		typeof window.PublicKeyCredential === 'function' &&
		WebAuthnDIDProvider.isSupported()
	);
}

/**
 * Check if platform authenticator (biometric) is available
 * @returns {Promise<boolean>} True if platform authenticator is available
 */
export async function isPlatformAuthenticatorAvailable() {
	if (!isWebAuthnAvailable()) {
		return false;
	}

	try {
		return await WebAuthnDIDProvider.isPlatformAuthenticatorAvailable();
	} catch (error) {
		console.warn('Failed to check platform authenticator availability:', error);
		return false;
	}
}

/**
 * Get browser name for display purposes
 * @returns {string} Browser name
 */
function getBrowserName() {
	const userAgent = navigator.userAgent;
	if (userAgent.indexOf('Firefox') > -1) return 'Firefox';
	if (userAgent.indexOf('Chrome') > -1) return 'Chrome';
	if (userAgent.indexOf('Safari') > -1) return 'Safari';
	if (userAgent.indexOf('Edge') > -1) return 'Edge';
	return 'Unknown';
}

/**
 * Check if user has existing WebAuthn credentials
 * @returns {boolean} True if credentials exist
 */
export function hasExistingCredentials() {
	try {
		const varsigCredential = loadWebAuthnVarsigCredential();
		return Boolean(varsigCredential);
	} catch (error) {
		console.warn('Failed to check existing credentials:', error);
		return false;
	}
}

/**
 * Get stored credential information
 * @returns {Object|null} Credential info or null
 */
export function getStoredCredentialInfo() {
	try {
		const varsigCredential = loadWebAuthnVarsigCredential();
		if (varsigCredential) {
			return {
				credentialId: toBase64(varsigCredential.credentialId),
				credentialType: 'webauthn-varsig',
				userHandle: null
			};
		}

		const credentialId = localStorage.getItem(STORAGE_KEY_CREDENTIAL_ID);
		const credentialType = localStorage.getItem(STORAGE_KEY_CREDENTIAL_TYPE);
		const userHandle = localStorage.getItem(STORAGE_KEY_USER_HANDLE);

		if (!credentialId || !userHandle) {
			return null;
		}

		return {
			credentialId,
			credentialType: credentialType || 'unknown',
			userHandle
		};
	} catch (error) {
		console.warn('Failed to get stored credential info:', error);
		return null;
	}
}

async function createVarsigIdentityRecord({ userId, userName, domain }) {
	showToast('🔐 Passkey required: create varsig credential', 'default', 3000);
	const varsigCredential = await createWebAuthnVarsigCredentialWithPrf({
		userId,
		displayName: userName,
		domain
	});

	console.log('✅ WebAuthn varsig credential created');
	storeWebAuthnVarsigCredential(varsigCredential);
	persistCredentialMetadata({
		type: 'webauthn-varsig',
		credentialId: varsigCredential.credentialId,
		userId
	});

	const identity = await getOrCreateVarsigIdentity(varsigCredential);
	console.log('✅ OrbitDB varsig identity created:', {
		id: identity.id,
		type: identity.type
	});

	return {
		identity,
		credentialInfo: varsigCredential,
		type: 'webauthn-varsig'
	};
}

/**
 * Create a new WebAuthn credential and identity
 * @param {string} userName - Display name for the credential (e.g., "Simple Todo User")
 * @returns {Promise<Object>} Object with identity and credentialInfo
 */
export async function createWebAuthnIdentity(userName = 'Simple Todo User', options = {}) {
	if (!isWebAuthnAvailable()) {
		throw new Error('WebAuthn is not available in this browser');
	}

	const requestedMode =
		options.mode === WEBAUTHN_AUTH_MODES.HARDWARE
			? WEBAUTHN_AUTH_MODES.HARDWARE
			: WEBAUTHN_AUTH_MODES.WORKER;
	console.log(`🔐 Creating WebAuthn identity (${requestedMode} mode)...`);

	try {
		const userId = `simple-todo-user-${Date.now()}`;
		const domain = window.location.hostname;
		if (!WebAuthnVarsigProvider.isSupported()) {
			throw new Error('WebAuthn varsig provider is not supported on this device/browser.');
		}
		return await createVarsigIdentityRecord({ userId, userName, domain });
	} catch (error) {
		console.error('❌ Failed to create WebAuthn identity:', error);

		// Provide user-friendly error messages
		if (error.name === 'NotAllowedError') {
			throw new Error('Authentication was cancelled or not allowed. Please try again.');
		} else if (error.name === 'InvalidStateError') {
			throw new Error(
				'A credential for this device already exists. Please use the existing credential or clear your credentials.'
			);
		} else if (error.name === 'NotSupportedError') {
			throw new Error('WebAuthn is not supported on this device.');
		}

		throw error;
	}
}

/**
 * Authenticate with existing WebAuthn credentials
 * @returns {Promise<Object>} Object with identity and credentialInfo
 */
export async function authenticateWithWebAuthn() {
	if (!isWebAuthnAvailable()) {
		throw new Error('WebAuthn is not available in this browser');
	}

	const varsigCredential = loadWebAuthnVarsigCredential();
	if (varsigCredential) {
		const identity = await getOrCreateVarsigIdentity(varsigCredential);

		return {
			identity,
			credentialInfo: varsigCredential,
			type: 'webauthn-varsig'
		};
	}
	throw new Error(
		'No supported WebAuthn varsig credential found. Please re-create your passkey in the current mode.'
	);
}

/**
 * Clear stored WebAuthn credentials
 * Note: This only clears the metadata, not the actual credential from the browser
 */
export function clearWebAuthnCredentials() {
	try {
		clearWebAuthnVarsigCredential();
		clearCachedVarsigIdentity();

		// Also clear our own storage keys
		localStorage.removeItem(STORAGE_KEY_CREDENTIAL_ID);
		localStorage.removeItem(STORAGE_KEY_CREDENTIAL_TYPE);
		localStorage.removeItem(STORAGE_KEY_USER_HANDLE);
		console.log('✅ WebAuthn credentials cleared from storage');
	} catch (error) {
		console.warn('Failed to clear WebAuthn credentials:', error);
	}
}

/**
 * Get WebAuthn capability information for the current browser/device
 * @returns {Promise<Object>} Capability information
 */
export async function getWebAuthnCapabilities() {
	const available = isWebAuthnAvailable();
	let platformAuthenticator = false;
	let browserName = 'Unknown';
	let varsigSupported = false;
	let hasVarsigCredentials = false;
	const hasKeystoreCredentials = false;

	if (available) {
		platformAuthenticator = await isPlatformAuthenticatorAvailable();
		browserName = getBrowserName();
		varsigSupported = WebAuthnVarsigProvider.isSupported();
		try {
			hasVarsigCredentials = Boolean(loadWebAuthnVarsigCredential());
		} catch (error) {
			console.warn('Failed to read WebAuthn credential storage:', error);
		}
	}

	return {
		available,
		platformAuthenticator,
		browserName,
		hasExistingCredentials: hasExistingCredentials(),
		preferredMode: getPreferredWebAuthnMode(),
		varsigSupported,
		hasVarsigCredentials,
		hasKeystoreCredentials
	};
}
