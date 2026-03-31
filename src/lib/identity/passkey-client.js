import {
	authenticateWithWebAuthn as baseAuthenticateWithWebAuthn,
	clearWebAuthnCredentials,
	createWebAuthnIdentity as baseCreateWebAuthnIdentity,
	getStoredCredentialInfos,
	getWebAuthnCapabilities,
	hasExistingCredentials,
	setPreferredWebAuthnMode,
	useExistingWebAuthnCredential as baseUseExistingWebAuthnCredential
} from './webauthn-identity.js';
import { beforePasskeyPrompt } from '../passkey-notice.js';

function authModeLabel(mode) {
	return mode === 'hardware' ? 'hardware identity' : 'worker identity';
}

export async function createWebAuthnIdentity(userName = 'De2do User', options = {}) {
	const mode = options?.mode === 'hardware' ? 'hardware' : 'worker';
	const details =
		mode === 'hardware'
			? 'Needed to create your hardware-backed identity. Your authenticator may ask twice.'
			: 'Needed to create your local passkey-backed identity for this app.';
	await beforePasskeyPrompt('Create passkey', details);
	return await baseCreateWebAuthnIdentity(userName, options);
}

export async function useExistingWebAuthnCredential(options = {}) {
	const mode = options?.mode === 'hardware' ? 'hardware' : 'worker';
	await beforePasskeyPrompt(
		'Use existing passkey',
		`Needed to unlock or recover your ${authModeLabel(mode)} on this device.`
	);
	return await baseUseExistingWebAuthnCredential(options);
}

export async function authenticateWithWebAuthn(options = {}) {
	const mode = options?.mode === 'hardware' ? 'hardware' : 'worker';
	await beforePasskeyPrompt(
		'Confirm passkey',
		`Needed to approve this action with your ${authModeLabel(mode)}.`
	);
	return await baseAuthenticateWithWebAuthn(options);
}

export {
	clearWebAuthnCredentials,
	getStoredCredentialInfos,
	getWebAuthnCapabilities,
	hasExistingCredentials,
	setPreferredWebAuthnMode
};
