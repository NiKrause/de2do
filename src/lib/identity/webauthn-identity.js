import {
	WebAuthnDIDProvider,
	OrbitDBWebAuthnIdentityProvider,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential as clearCredential,
	WebAuthnVarsigProvider,
	addPRFToCredentialOptions,
	storeWebAuthnVarsigCredential,
	loadWebAuthnVarsigCredential,
	clearWebAuthnVarsigCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { getOrCreateVarsigIdentity } from './varsig-identity.js';
import { showToast } from '../toast-store.js';
import { DIDKey } from 'iso-did';
import { parseAttestationObject } from 'iso-passkeys';

function shouldFallbackToKeystore(error) {
	if (!error) return false;
	const name = error.name || '';
	const message = String(error.message || '');
	return (
		name === 'NotSupportedError' ||
		message.includes('not supported') ||
		message.includes('No supported credential')
	);
}

function toArrayBuffer(value) {
	if (value instanceof ArrayBuffer) return value;
	if (ArrayBuffer.isView(value)) return value.buffer;
	return value;
}

function getOrCreateStableWebAuthnUserId() {
	const storageKey = 'webauthn_user_id_v1';
	if (typeof window === 'undefined') {
		return `webauthn-user-${Date.now()}`;
	}

	try {
		const existing = localStorage.getItem(storageKey);
		if (existing) return existing;

		const bytes = crypto.getRandomValues(new Uint8Array(16));
		let binary = '';
		for (let i = 0; i < bytes.length; i += 1) {
			binary += String.fromCharCode(bytes[i]);
		}
		const created = btoa(binary);
		localStorage.setItem(storageKey, created);
		return created;
	} catch {
		return `webauthn-user-${Date.now()}`;
	}
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

function mapPublicKeyAlgorithm(alg) {
	if (alg === -50 || alg === -8) return 'Ed25519';
	if (alg === -7) return 'P-256';
	return null;
}

async function createWebAuthnVarsigCredentialWithPrf(options = {}) {
	const { userId, displayName, domain } = {
		userId: getOrCreateStableWebAuthnUserId(),
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
			residentKey: 'required',
			requireResidentKey: true,
			userVerification: 'required'
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

export async function recoverDiscoverableVarsigCredential() {
	if (!isWebAuthnAvailable()) {
		return null;
	}

	const rpId = window.location.hostname;
	const publicKey = {
		challenge: crypto.getRandomValues(new Uint8Array(32)),
		rpId,
		userVerification: 'required'
	};

	try {
		const credential = await navigator.credentials.get({ publicKey });
		if (!credential) return null;

		const rawId = credential.rawId ? new Uint8Array(credential.rawId) : null;
		if (!rawId) return null;

		let publicKeyBytes = null;
		let algorithm = null;
		let cose = {};

		const response = credential.response;

		if (response?.getPublicKey && response?.getPublicKeyAlgorithm) {
			const pubKeyBuffer = response.getPublicKey();
			const pubKeyAlg = response.getPublicKeyAlgorithm();
			if (pubKeyBuffer) {
				publicKeyBytes = new Uint8Array(pubKeyBuffer);
			}
			algorithm = mapPublicKeyAlgorithm(pubKeyAlg);
			cose = { alg: pubKeyAlg };
		} else if (response?.attestationObject) {
			const extracted = extractVarsigCredentialInfo(new Uint8Array(response.attestationObject));
			publicKeyBytes = extracted.publicKey;
			algorithm = extracted.algorithm;
			cose = { kty: extracted.kty, alg: extracted.alg, crv: extracted.crv };
		}

		if (!publicKeyBytes || !algorithm) {
			console.warn('Discoverable credential missing public key; cannot recover varsig credential.');
			return null;
		}

		const did = DIDKey.fromPublicKey(algorithm, publicKeyBytes).did;
		const recovered = {
			credentialId: rawId,
			publicKey: publicKeyBytes,
			did,
			algorithm,
			cose
		};

		storeWebAuthnVarsigCredential(recovered);
		console.log('🔄 Recovered discoverable WebAuthn varsig credential.');
		return recovered;
	} catch (error) {
		if (error?.name === 'NotAllowedError') {
			console.log('ℹ️ Discoverable WebAuthn recovery cancelled by user.');
			return null;
		}
		console.warn('Failed to recover discoverable WebAuthn credential:', error);
		return null;
	}
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
		const webauthnCredential = loadWebAuthnCredential();
		return Boolean(varsigCredential || webauthnCredential);
	} catch (error) {
		console.warn('Failed to check existing credentials:', error);
		return false;
	}
}

/**
 * Get stored credential information
 * @returns {Object|null} Credential info or null
 */
/**
 * Create a new WebAuthn credential and identity
 * @param {string} userName - Display name for the credential (e.g., "Simple Todo User")
 * @returns {Promise<Object>} Object with identity and credentialInfo
 */
export async function createWebAuthnIdentity(userName = 'Simple Todo User') {
	if (!isWebAuthnAvailable()) {
		throw new Error('WebAuthn is not available in this browser');
	}

	console.log('🔐 Creating WebAuthn identity (varsig preferred)...');

	try {
		const userId = `simple-todo-user-${Date.now()}`;
		const domain = window.location.hostname;

		if (WebAuthnVarsigProvider.isSupported()) {
			try {
				showToast('🔐 Passkey required: create varsig credential', 'default', 3000);
				const varsigCredential = await createWebAuthnVarsigCredentialWithPrf({
					userId,
					displayName: userName,
					domain
				});

				console.log('✅ WebAuthn varsig credential created');
				storeWebAuthnVarsigCredential(varsigCredential);

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
			} catch (error) {
				if (!shouldFallbackToKeystore(error)) {
					throw error;
				}
				console.warn('⚠️ Varsig unavailable, falling back to encrypted keystore:', error);
			}
		}

		showToast('🔐 Passkey required: create WebAuthn credential', 'default', 3000);
		const credentialInfo = await WebAuthnDIDProvider.createCredential({
			userId,
			displayName: userName,
			domain,
			encryptKeystore: true,
			keystoreEncryptionMethod: 'prf'
		});

		console.log('✅ WebAuthn credential created (keystore fallback):', {
			credentialId: credentialInfo.credentialId,
			userId: credentialInfo.userId
		});

		storeWebAuthnCredential(credentialInfo);

		const identity = await OrbitDBWebAuthnIdentityProvider.createIdentity({
			webauthnCredential: credentialInfo
		});

		console.log('✅ OrbitDB identity created (keystore fallback):', {
			id: identity.id,
			type: identity.type
		});

		return {
			identity,
			credentialInfo,
			type: 'webauthn-keystore'
		};
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

	const storedCredential = loadWebAuthnCredential();
	if (!storedCredential) {
		throw new Error('No existing WebAuthn credentials found. Please create credentials first.');
	}

	console.log('🔐 Authenticating with WebAuthn (keystore fallback)...');

	try {
		const identity = await OrbitDBWebAuthnIdentityProvider.createIdentity({
			webauthnCredential: storedCredential
		});

		console.log('✅ WebAuthn authentication successful:', {
			id: identity.id,
			type: identity.type
		});

		return {
			identity,
			credentialInfo: storedCredential,
			type: 'webauthn-keystore'
		};
	} catch (error) {
		console.error('❌ Failed to authenticate with WebAuthn:', error);

		// Provide user-friendly error messages
		if (error.name === 'NotAllowedError') {
			throw new Error('Authentication was cancelled. Please try again.');
		} else if (error.name === 'InvalidStateError') {
			throw new Error('Invalid authentication state. Your credentials may be corrupted.');
		}

		throw error;
	}
}

/**
 * Clear stored WebAuthn credentials
 * Note: This only clears the metadata, not the actual credential from the browser
 */
export function clearWebAuthnCredentials() {
	try {
		// Clear using the library function
		clearCredential();
		clearWebAuthnVarsigCredential();

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
	let hasKeystoreCredentials = false;

	if (available) {
		platformAuthenticator = await isPlatformAuthenticatorAvailable();
		browserName = getBrowserName();
		varsigSupported = WebAuthnVarsigProvider.isSupported();
		try {
			hasVarsigCredentials = Boolean(loadWebAuthnVarsigCredential());
			hasKeystoreCredentials = Boolean(loadWebAuthnCredential());
		} catch (error) {
			console.warn('Failed to read WebAuthn credential storage:', error);
		}
	}

	return {
		available,
		platformAuthenticator,
		browserName,
		hasExistingCredentials: hasExistingCredentials(),
		varsigSupported,
		hasVarsigCredentials,
		hasKeystoreCredentials
	};
}
