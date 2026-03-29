import {
	WebAuthnDIDProvider,
	WebAuthnVarsigProvider,
	checkExtensionSupport,
	loadWebAuthnCredential,
	loadWebAuthnVarsigCredential,
	clearWebAuthnVarsigCredential,
	storeWebAuthnVarsigCredential,
	createDidLargeBlobPayload,
	parseDidLargeBlobPayload,
	createVarsigLargeBlobPayload,
	parseVarsigLargeBlobPayload,
	readLargeBlobMetadata,
	writeLargeBlobMetadata,
	loadWebAuthnCredentialSafe,
	storeWebAuthnCredentialSafe,
	clearWebAuthnCredentialSafe,
	extractPrfSeedFromCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { getOrCreateVarsigIdentity, clearCachedVarsigIdentity } from './varsig-identity.js';

const STORAGE_KEY_PREFERRED_AUTH_MODE = 'webauthn_preferred_auth_mode';
const STORAGE_KEY_WORKER_CREDENTIAL = 'webauthn-worker-credential';

export const WEBAUTHN_AUTH_MODES = {
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

function normalizeMode(mode) {
	if (mode == null || mode === '') {
		return WEBAUTHN_AUTH_MODES.WORKER;
	}
	const m = String(mode).toLowerCase();
	// orbitdb-ui historically persisted preferred mode as "varsig"
	if (m === 'varsig' || m === 'hardware') {
		return WEBAUTHN_AUTH_MODES.HARDWARE;
	}
	return WEBAUTHN_AUTH_MODES.WORKER;
}

function createPasskeyUserId(label) {
	const normalized = String(label || 'Simple Todo')
		.trim()
		.slice(0, 64);
	return normalized || 'Simple Todo';
}

function getBrowserName() {
	const userAgent = navigator.userAgent;
	if (userAgent.indexOf('Firefox') > -1) return 'Firefox';
	if (userAgent.indexOf('Chrome') > -1) return 'Chrome';
	if (userAgent.indexOf('Safari') > -1) return 'Safari';
	if (userAgent.indexOf('Edge') > -1) return 'Edge';
	return 'Unknown';
}

function loadStoredWorkerCredential() {
	try {
		const safeCredential = loadWebAuthnCredentialSafe(STORAGE_KEY_WORKER_CREDENTIAL);
		if (safeCredential) return safeCredential;
		const legacyCredential = loadWebAuthnCredential('webauthn-credential');
		if (legacyCredential) {
			storeWebAuthnCredentialSafe(legacyCredential, STORAGE_KEY_WORKER_CREDENTIAL);
			return legacyCredential;
		}
	} catch (error) {
		console.warn('Failed to load worker WebAuthn credential:', error);
	}
	return null;
}

function storeWorkerCredential(credential) {
	storeWebAuthnCredentialSafe(credential, STORAGE_KEY_WORKER_CREDENTIAL);
}

function clearWorkerCredential() {
	clearWebAuthnCredentialSafe(STORAGE_KEY_WORKER_CREDENTIAL);
	try {
		localStorage.removeItem('webauthn-credential');
		localStorage.removeItem('webauthn_credential_info');
	} catch {
		// ignore
	}
}

function getStoredCredentialRecords() {
	const workerCredential = loadStoredWorkerCredential();
	const hardwareCredential = (() => {
		try {
			return loadWebAuthnVarsigCredential();
		} catch (error) {
			console.warn('Failed to load varsig WebAuthn credential:', error);
			return null;
		}
	})();

	return [
		workerCredential && {
			authMode: WEBAUTHN_AUTH_MODES.WORKER,
			type: 'webauthn',
			credentialInfo: workerCredential
		},
		hardwareCredential && {
			authMode: WEBAUTHN_AUTH_MODES.HARDWARE,
			type: 'webauthn-varsig',
			credentialInfo: hardwareCredential
		}
	].filter(Boolean);
}

function pickStoredCredential(preferredMode = getPreferredWebAuthnMode()) {
	const stored = getStoredCredentialRecords();
	return (
		stored.find((record) => record.authMode === normalizeMode(preferredMode)) || stored[0] || null
	);
}

async function storeRecoverableMetadata(record) {
	try {
		const support = await checkExtensionSupport();
		if (!support?.largeBlob) return false;
		const payload =
			record.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
				? createVarsigLargeBlobPayload(record.credentialInfo)
				: createDidLargeBlobPayload(record.credentialInfo, record.credentialInfo?.did || null);
		await writeLargeBlobMetadata({
			credentialId:
				record.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
					? record.credentialInfo.credentialId
					: record.credentialInfo.rawCredentialId,
			rpId: window.location.hostname,
			payload
		});
		return true;
	} catch (error) {
		console.warn('Failed to persist recoverable WebAuthn metadata to largeBlob:', error);
		return false;
	}
}

function storeCredentialRecord(record) {
	if (record.authMode === WEBAUTHN_AUTH_MODES.HARDWARE) {
		storeWebAuthnVarsigCredential(record.credentialInfo);
		return;
	}
	storeWorkerCredential(record.credentialInfo);
}

function formatStoredCredential(record) {
	const credential = record.credentialInfo;
	const credentialId =
		record.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
			? credential.credentialId
			: credential.rawCredentialId;
	return {
		authMode: record.authMode,
		type: record.type,
		did: credential.did || null,
		credentialId: credentialId ? toBase64(credentialId) : null
	};
}

function matchStoredCredentialByRawId(rawId) {
	return (
		getStoredCredentialRecords().find((record) => {
			const credential = record.credentialInfo;
			const recordId =
				record.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
					? credential.credentialId
					: credential.rawCredentialId;
			return bytesEqual(recordId, rawId);
		}) || null
	);
}

function parseRecoverableBlob(blob) {
	if (!blob) return null;
	try {
		return {
			authMode: WEBAUTHN_AUTH_MODES.HARDWARE,
			type: 'webauthn-varsig',
			credentialInfo: parseVarsigLargeBlobPayload(blob)
		};
	} catch {
		// try worker mode next
	}
	try {
		return {
			authMode: WEBAUTHN_AUTH_MODES.WORKER,
			type: 'webauthn',
			credentialInfo: parseDidLargeBlobPayload(blob)
		};
	} catch {
		return null;
	}
}

export function getPreferredWebAuthnMode() {
	try {
		return normalizeMode(localStorage.getItem(STORAGE_KEY_PREFERRED_AUTH_MODE));
	} catch {
		return WEBAUTHN_AUTH_MODES.WORKER;
	}
}

export function setPreferredWebAuthnMode(mode) {
	try {
		localStorage.setItem(STORAGE_KEY_PREFERRED_AUTH_MODE, normalizeMode(mode));
	} catch {
		// ignore
	}
}

export function isWebAuthnAvailable() {
	return (
		typeof window !== 'undefined' &&
		window.PublicKeyCredential !== undefined &&
		typeof window.PublicKeyCredential === 'function' &&
		WebAuthnDIDProvider.isSupported()
	);
}

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

export function hasExistingCredentials() {
	return getStoredCredentialRecords().length > 0;
}

export function getStoredCredentialInfo() {
	const record = pickStoredCredential();
	if (!record) return null;
	return formatStoredCredential(record);
}

export function getStoredCredentialInfos() {
	return getStoredCredentialRecords().map(formatStoredCredential);
}

export function getStoredWebAuthnCredential(mode) {
	return pickStoredCredential(mode);
}

async function createWorkerCredential(userName) {
	const credentialInfo = await WebAuthnDIDProvider.createCredential({
		userId: createPasskeyUserId(userName),
		displayName: userName,
		encryptKeystore: true,
		keystoreEncryptionMethod: 'prf',
		domain: window.location.hostname,
		discoverableCredentials: true
	});
	const record = {
		authMode: WEBAUTHN_AUTH_MODES.WORKER,
		type: 'webauthn',
		credentialInfo
	};
	storeCredentialRecord(record);
	await storeRecoverableMetadata(record);
	return {
		identity: null,
		credentialInfo,
		type: record.type,
		authMode: record.authMode
	};
}

async function createHardwareCredential(userName) {
	const credentialInfo = await WebAuthnVarsigProvider.createCredential({
		userId: createPasskeyUserId(userName),
		displayName: userName,
		discoverableCredentials: true
	});
	const record = {
		authMode: WEBAUTHN_AUTH_MODES.HARDWARE,
		type: 'webauthn-varsig',
		credentialInfo
	};
	storeCredentialRecord(record);
	await storeRecoverableMetadata(record);
	const identity = await getOrCreateVarsigIdentity(credentialInfo);
	return {
		identity,
		credentialInfo,
		type: record.type,
		authMode: record.authMode
	};
}

export async function createWebAuthnIdentity(userName = 'Simple Todo User', options = {}) {
	if (!isWebAuthnAvailable()) {
		throw new Error('WebAuthn is not available in this browser');
	}
	const requestedMode = normalizeMode(options.mode);
	setPreferredWebAuthnMode(requestedMode);
	try {
		return requestedMode === WEBAUTHN_AUTH_MODES.HARDWARE
			? await createHardwareCredential(userName)
			: await createWorkerCredential(userName);
	} catch (error) {
		console.error('Failed to create WebAuthn identity:', error);
		if (error.name === 'NotAllowedError') {
			throw new Error('Authentication was cancelled or not allowed. Please try again.');
		}
		if (error.name === 'InvalidStateError') {
			throw new Error(
				'A credential for this device already exists. Use the existing credential or clear local metadata first.'
			);
		}
		if (error.name === 'NotSupportedError') {
			throw new Error('WebAuthn is not supported on this device.');
		}
		throw error;
	}
}

export async function useExistingWebAuthnCredential(options = {}) {
	if (!isWebAuthnAvailable()) {
		throw new Error('WebAuthn is not available in this browser');
	}

	const requestedMode = options.mode ? normalizeMode(options.mode) : null;
	const stored = requestedMode ? pickStoredCredential(requestedMode) : pickStoredCredential();
	if (stored) {
		setPreferredWebAuthnMode(stored.authMode);
		return {
			...stored,
			recoveredFrom: 'local',
			identity:
				stored.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
					? await getOrCreateVarsigIdentity(stored.credentialInfo)
					: null
		};
	}

	const { assertion, blob } = await readLargeBlobMetadata({
		rpId: window.location.hostname,
		discoverableCredentials: true
	});
	if (!assertion) {
		throw new Error('No existing passkey was returned by WebAuthn.');
	}

	const parsed = parseRecoverableBlob(blob);
	if (parsed && (!requestedMode || parsed.authMode === requestedMode)) {
		storeCredentialRecord(parsed);
		setPreferredWebAuthnMode(parsed.authMode);
		return {
			...parsed,
			recoveredFrom: 'discoverable',
			identity:
				parsed.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
					? await getOrCreateVarsigIdentity(parsed.credentialInfo)
					: null
		};
	}

	const fallback = matchStoredCredentialByRawId(new Uint8Array(assertion.rawId));
	if (fallback && (!requestedMode || fallback.authMode === requestedMode)) {
		setPreferredWebAuthnMode(fallback.authMode);
		return {
			...fallback,
			recoveredFrom: 'matched-local',
			identity:
				fallback.authMode === WEBAUTHN_AUTH_MODES.HARDWARE
					? await getOrCreateVarsigIdentity(fallback.credentialInfo)
					: null
		};
	}

	throw new Error(
		'Passkey found, but no recoverable metadata was found in largeBlob or local storage.'
	);
}

export async function authenticateWithWebAuthn(options = {}) {
	const stored = options.mode ? pickStoredCredential(options.mode) : pickStoredCredential();
	if (!stored) {
		throw new Error('No stored WebAuthn credential found on this device.');
	}
	if (stored.authMode === WEBAUTHN_AUTH_MODES.HARDWARE) {
		const identity = await getOrCreateVarsigIdentity(stored.credentialInfo);
		return { ...stored, identity };
	}
	await extractPrfSeedFromCredential(stored.credentialInfo, {
		rpId: window.location.hostname
	});
	return { ...stored, identity: null };
}

export function clearWebAuthnCredentials(mode = null) {
	const normalizedMode = mode ? normalizeMode(mode) : null;
	try {
		if (!normalizedMode || normalizedMode === WEBAUTHN_AUTH_MODES.WORKER) {
			clearWorkerCredential();
		}
		if (!normalizedMode || normalizedMode === WEBAUTHN_AUTH_MODES.HARDWARE) {
			clearWebAuthnVarsigCredential();
			clearCachedVarsigIdentity();
		}
	} catch (error) {
		console.warn('Failed to clear WebAuthn credentials:', error);
	}
}

export async function getWebAuthnCapabilities() {
	const available = isWebAuthnAvailable();
	let platformAuthenticator = false;
	let browserName = 'Unknown';
	let varsigSupported = false;

	if (available) {
		platformAuthenticator = await isPlatformAuthenticatorAvailable();
		browserName = getBrowserName();
		varsigSupported = WebAuthnVarsigProvider.isSupported();
	}

	return {
		available,
		platformAuthenticator,
		browserName,
		hasExistingCredentials: hasExistingCredentials(),
		preferredMode: getPreferredWebAuthnMode(),
		varsigSupported,
		storedCredentials: getStoredCredentialInfos(),
		canUseExistingCredential: available
	};
}
