import {
	WebAuthnDIDProvider,
	OrbitDBWebAuthnIdentityProvider,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential as clearCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';

// Storage keys for WebAuthn credentials
const STORAGE_KEY_CREDENTIAL_ID = 'webauthn_credential_id';
const STORAGE_KEY_CREDENTIAL_TYPE = 'webauthn_credential_type';
const STORAGE_KEY_USER_HANDLE = 'webauthn_user_handle';

/**
 * Check if WebAuthn is available in the current browser
 * @returns {boolean} True if WebAuthn is supported
 */
export function isWebAuthnAvailable() {
	return (
		typeof window !== 'undefined' &&
		window.PublicKeyCredential !== undefined &&
		typeof window.PublicKeyCredential === 'function'
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
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
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
		return (
			localStorage.getItem(STORAGE_KEY_CREDENTIAL_ID) !== null &&
			localStorage.getItem(STORAGE_KEY_USER_HANDLE) !== null
		);
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

	console.log('🔐 Creating WebAuthn identity...');

	try {
		// Create WebAuthn credential using the DID provider
		const userId = `simple-todo-user-${Date.now()}`;
		const credentialInfo = await WebAuthnDIDProvider.createCredential({
			userId,
			displayName: userName,
			domain: window.location.hostname
		});

		console.log('✅ WebAuthn credential created:', {
			credentialId: credentialInfo.credentialId,
			userId: credentialInfo.userId
		});

		// Store the credential for future use
		storeWebAuthnCredential(credentialInfo);

		// Also store in our own format for compatibility
		const userHandleBase64 = btoa(
			String.fromCharCode(...new TextEncoder().encode(credentialInfo.userId))
		);
		localStorage.setItem(STORAGE_KEY_CREDENTIAL_ID, credentialInfo.credentialId);
		localStorage.setItem(STORAGE_KEY_CREDENTIAL_TYPE, 'webauthn');
		localStorage.setItem(STORAGE_KEY_USER_HANDLE, userHandleBase64);

		// Create OrbitDB identity from the credential
		const identity = await OrbitDBWebAuthnIdentityProvider.createIdentity({
			webauthnCredential: credentialInfo
		});

		console.log('✅ OrbitDB identity created:', {
			id: identity.id,
			type: identity.type
		});

		return {
			identity,
			credentialInfo
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

	// Load credential from storage
	const storedCredential = loadWebAuthnCredential();
	if (!storedCredential) {
		throw new Error('No existing WebAuthn credentials found. Please create credentials first.');
	}

	console.log('🔐 Authenticating with WebAuthn...');

	try {
		// Create OrbitDB identity from stored credential
		const identity = await OrbitDBWebAuthnIdentityProvider.createIdentity({
			webauthnCredential: storedCredential
		});

		console.log('✅ WebAuthn authentication successful:', {
			id: identity.id,
			type: identity.type
		});

		return {
			identity,
			credentialInfo: storedCredential
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

	if (available) {
		platformAuthenticator = await isPlatformAuthenticatorAvailable();
		browserName = getBrowserName();
	}

	return {
		available,
		platformAuthenticator,
		browserName,
		hasExistingCredentials: hasExistingCredentials()
	};
}
