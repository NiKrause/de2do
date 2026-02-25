import { writable, get } from 'svelte/store';

// Store for current database address (OrbitDB address, e.g., "/orbitdb/zdpuA...")
// Moved here to break circular dependency: db-actions -> todo-list-manager -> p2p -> db-actions
export const currentDbAddressStore = writable(null);

// Store for current identity (moved here to break circular dependency)
// This allows getCurrentIdentityId to be in a module without circular deps
export const currentIdentityStore = writable(null);

// Store for peer ID (moved here to break circular dependency: db-actions -> p2p -> db-actions)
export const peerIdStore = writable(null);

// Delegated write authentication status for UI + e2e assertions.
// States: idle | awaiting | success | error
export const delegatedWriteAuthStore = writable({
	state: 'idle',
	action: null,
	at: null,
	message: ''
});

// Helper function to get current identity ID (no circular dependency!)
export function getCurrentIdentityId() {
	const identity = get(currentIdentityStore);
	return identity?.id || null;
}
