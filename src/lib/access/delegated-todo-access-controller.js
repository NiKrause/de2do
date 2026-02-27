import { OrbitDBAccessController } from '@orbitdb/core';
import { OrbitDBWebAuthnIdentityProviderFunction } from '@le-space/orbitdb-identity-provider-webauthn-did';

const type = 'todo-delegation';

function isUnsupportedVarsigHeaderError(error) {
	return String(error?.message || '').toLowerCase().includes('unsupported varsig header');
}

async function verifyIdentityWithFallback(identities, writerIdentity) {
	try {
		if (await identities.verifyIdentity(writerIdentity)) {
			return true;
		}
	} catch (error) {
		if (!isUnsupportedVarsigHeaderError(error)) {
			throw error;
		}
	}

	// Mixed-mode fallback: varsig-only verifier may reject worker WebAuthn identities.
	try {
		if (
			writerIdentity?.type === 'webauthn' &&
			typeof OrbitDBWebAuthnIdentityProviderFunction.verifyIdentity === 'function'
		) {
			return await OrbitDBWebAuthnIdentityProviderFunction.verifyIdentity(writerIdentity);
		}
	} catch {
		// continue
	}

	const fallbackVerify = identities?.verifyIdentityFallback;
	if (typeof fallbackVerify === 'function') {
		try {
			return await fallbackVerify(writerIdentity);
		} catch {
			// continue
		}
	}

	return false;
}

function parseDelegationActionKey(key) {
	if (typeof key !== 'string') return null;
	const match = /^delegation-action\/([^/]+)\/([^/]+)\/[^/]+$/.exec(key);
	if (!match) return null;
	try {
		return {
			taskKey: match[1],
			delegateDid: decodeURIComponent(match[2])
		};
	} catch {
		return null;
	}
}

const DelegatedTodoAccessController =
	({ write } = {}) =>
	async ({ orbitdb, identities, address, name }) => {
		const baseFactory = OrbitDBAccessController({ write });
		const baseAccess = await baseFactory({ orbitdb, identities, address, name });

		const canAppend = async (entry) => {
			if (await baseAccess.canAppend(entry)) {
				return true;
			}

			const payload = entry?.payload;
			if (!payload || payload.op !== 'PUT') {
				console.warn('🚫 Delegated AC rejected: not a PUT payload', {
					op: payload?.op,
					key: payload?.key
				});
				return false;
			}

			const parsedKey = parseDelegationActionKey(payload.key);
			if (!parsedKey) {
				console.warn('🚫 Delegated AC rejected: key is not delegation-action format', {
					key: payload.key
				});
				return false;
			}

			const value = payload.value;
			if (!value || value.type !== 'delegation-action') {
				console.warn('🚫 Delegated AC rejected: invalid action envelope', {
					key: payload.key,
					type: value?.type
				});
				return false;
			}
			if (!['set-completed', 'patch-fields'].includes(value.action)) {
				console.warn('🚫 Delegated AC rejected: unsupported delegation action', {
					key: payload.key,
					action: value.action
				});
				return false;
			}
			if (value.action === 'set-completed' && typeof value.setCompleted !== 'boolean') {
				console.warn('🚫 Delegated AC rejected: set-completed missing boolean payload', {
					key: payload.key,
					setCompleted: value.setCompleted
				});
				return false;
			}
			if (value.action === 'patch-fields') {
				if (!value.patch || typeof value.patch !== 'object') {
					console.warn('🚫 Delegated AC rejected: patch-fields missing patch object', {
						key: payload.key
					});
					return false;
				}
				const allowedPatchKeys = ['text', 'description'];
				const patchKeys = Object.keys(value.patch);
				if (patchKeys.length === 0) {
					console.warn('🚫 Delegated AC rejected: empty patch payload', { key: payload.key });
					return false;
				}
				if (!patchKeys.every((k) => allowedPatchKeys.includes(k))) {
					console.warn('🚫 Delegated AC rejected: patch contains unsupported fields', {
						key: payload.key,
						patchKeys
					});
					return false;
				}
				if (value.patch.text !== undefined && typeof value.patch.text !== 'string') {
					console.warn('🚫 Delegated AC rejected: patch.text must be string', {
						key: payload.key,
						textType: typeof value.patch.text
					});
					return false;
				}
				if (value.patch.description !== undefined && typeof value.patch.description !== 'string')
					return false;
			}
			if (value.taskKey !== parsedKey.taskKey) {
				console.warn('🚫 Delegated AC rejected: taskKey mismatch', {
					key: payload.key,
					taskKey: value.taskKey,
					expectedTaskKey: parsedKey.taskKey
				});
				return false;
			}
			if (value.delegateDid !== parsedKey.delegateDid) {
				console.warn('🚫 Delegated AC rejected: delegateDid mismatch', {
					key: payload.key,
					delegateDid: value.delegateDid,
					expectedDelegateDid: parsedKey.delegateDid
				});
				return false;
			}

			if (value.expiresAt && Date.parse(value.expiresAt) < Date.now()) {
				console.warn('🚫 Delegated AC rejected: delegation action expired', {
					key: payload.key,
					expiresAt: value.expiresAt
				});
				return false;
			}

			const writerIdentity = await identities.getIdentity(entry.identity);
			if (!writerIdentity) {
				console.warn('🚫 Delegated AC rejected: writer identity not found', {
					key: payload.key,
					entryIdentity: entry.identity
				});
				return false;
			}
			if (!(await verifyIdentityWithFallback(identities, writerIdentity))) {
				console.warn('🚫 Delegated AC rejected: writer identity verification failed', {
					key: payload.key,
					entryIdentity: entry.identity,
					writerId: writerIdentity.id,
					writerType: writerIdentity.type
				});
				return false;
			}

			const writerMatchesDelegate = writerIdentity.id === value.delegateDid;
			if (!writerMatchesDelegate) {
				console.warn('🚫 Delegated AC rejected: entry writer does not match delegate DID', {
					key: payload.key,
					writerId: writerIdentity.id,
					delegateDid: value.delegateDid
				});
			}
			return writerMatchesDelegate;
		};

		return {
			...baseAccess,
			type,
			canAppend
		};
	};

DelegatedTodoAccessController.type = type;

export default DelegatedTodoAccessController;
