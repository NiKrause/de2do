import {
	WebAuthnDIDProvider,
	OrbitDBWebAuthnIdentityProvider,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential as clearCredential,
	WebAuthnVarsigProvider,
	storeWebAuthnVarsigCredential,
	loadWebAuthnVarsigCredential,
	clearWebAuthnVarsigCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { getOrCreateVarsigIdentity } from './varsig-identity.js';
import { showToast } from '../toast-store.js';

// Legacy storage keys for WebAuthn credentials (kept for compatibility)
const STORAGE_KEY_CREDENTIAL_ID = 'webauthn_credential_id';
const STORAGE_KEY_CREDENTIAL_TYPE = 'webauthn_credential_type';
const STORAGE_KEY_USER_HANDLE = 'webauthn_user_handle';

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

		const webauthnCredential = loadWebAuthnCredential();
		if (webauthnCredential) {
			return {
				credentialId: webauthnCredential.credentialId || '',
				credentialType: 'webauthn-keystore',
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
				const varsigCredential = await WebAuthnVarsigProvider.createCredential({
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
		persistCredentialMetadata({
			type: 'webauthn-keystore',
			credentialId: credentialInfo.credentialId,
			userId
		});

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
