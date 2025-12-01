import { writable } from 'svelte/store';

/**
 * Password manager state store
 */
function createPasswordManagerStore() {
	const { subscribe, set, update } = writable({
		showModal: false,
		dbName: '',
		retryCount: 0,
		pendingResolve: null,
		pendingReject: null
	});

	return {
		subscribe,

		/**
		 * Request password for a database
		 * @param {string} dbName - Database name to show in modal
		 * @returns {Promise<string>} Promise that resolves with password or rejects on cancel
		 */
		requestPassword(dbName) {
			return new Promise((resolve, reject) => {
				update((state) => ({
					...state,
					showModal: true,
					dbName,
					// Don't reset retryCount - preserve it if we're in a retry flow
					// Only reset on first password request (when retryCount is already 0)
					pendingResolve: resolve,
					pendingReject: reject
				}));
			});
		},

		/**
		 * Submit password
		 * @param {string} password - Entered password
		 */
		submitPassword(password) {
			update((state) => {
				if (state.pendingResolve) {
					state.pendingResolve(password);
				}
				return {
					...state,
					showModal: false,
					pendingResolve: null,
					pendingReject: null
				};
			});
		},

		/**
		 * Cancel password entry
		 */
		cancel() {
			update((state) => {
				if (state.pendingReject) {
					state.pendingReject(new Error('Password entry cancelled'));
				}
				return {
					...state,
					showModal: false,
					retryCount: 0,
					pendingResolve: null,
					pendingReject: null
				};
			});
		},

		/**
		 * Increment retry count
		 * @returns {number} New retry count
		 */
		incrementRetry() {
			let newCount = 0;
			update((state) => {
				newCount = state.retryCount + 1;
				return {
					...state,
					retryCount: newCount
				};
			});
			return newCount;
		},

		/**
		 * Reset retry count
		 */
		resetRetry() {
			update((state) => ({
				...state,
				retryCount: 0
			}));
		}
	};
}

export const passwordManager = createPasswordManagerStore();

/**
 * Request password with retry logic
 * @param {string} dbName - Database name
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<string>} Password or throws error
 */
export async function requestPasswordWithRetry(dbName, maxRetries = 3) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const password = await passwordManager.requestPassword(dbName);
			passwordManager.resetRetry();
			return password;
		} catch (err) {
			if (err.message === 'Password entry cancelled') {
				throw err;
			}

			if (attempt < maxRetries) {
				passwordManager.incrementRetry();
			} else {
				throw new Error('Maximum password attempts exceeded');
			}
		}
	}
}
