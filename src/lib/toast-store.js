import { writable } from 'svelte/store';

// Toast store for system-wide notifications
export const toastStore = writable(null);

// Helper function to show toast messages
export function showToast(message, type = 'default', duration = 3000) {
	toastStore.set({ message, type, duration });
}

// Add methods to the toastStore
toastStore.show = showToast;
toastStore.clear = () => toastStore.set(null);

// Predefined toast types for system events
export const toastTypes = {
	// P2P System Events
	P2P_CREATED: { message: '🚀 P2P system initialized', type: 'success', duration: 2000 },
	LIBP2P_CREATED: { message: '⚡ libp2p node created', type: 'success', duration: 2000 },
	HELIA_CREATED: { message: '🌐 Helia IPFS node created', type: 'success', duration: 2000 },
	ORBITDB_CREATED: { message: '🛰️ OrbitDB instance created', type: 'success', duration: 2000 },

	// Connection Events
	PEER_CONNECTED: { message: '👥 New peer connected', type: 'success', duration: 3000 },
	PEER_DISCONNECTED: { message: '👋 Peer disconnected', type: 'warning', duration: 3000 },
	CONNECTION_OPENED: { message: '🔗 P2P connection opened', type: 'success', duration: 2000 },
	CONNECTION_CLOSED: { message: '🔌 P2P connection closed', type: 'warning', duration: 2000 },

	// Database Events
	DATABASE_LOADED: { message: '📚 Database loaded successfully', type: 'success', duration: 2000 },
	LOADING_TODOS: { message: '🔍 Loading todos from database...', type: 'default', duration: 1500 },
	TODOS_LOADED: { message: '✅ Todos loaded from database', type: 'success', duration: 2000 },

	// Storage Events
	STORAGE_PERSISTENT: { message: '💾 Persistent storage enabled', type: 'success', duration: 2000 },
	STORAGE_MEMORY: { message: '🧠 Using in-memory storage', type: 'warning', duration: 2000 },
	STORAGE_TEST_FAILED: {
		message: '⚠️ Storage test failed, using fallback',
		type: 'warning',
		duration: 3000
	}
};

// Convenience functions for common system events
export const systemToasts = {
	showP2PCreated: () =>
		showToast(
			toastTypes.P2P_CREATED.message,
			toastTypes.P2P_CREATED.type,
			toastTypes.P2P_CREATED.duration
		),
	showLibp2pCreated: () =>
		showToast(
			toastTypes.LIBP2P_CREATED.message,
			toastTypes.LIBP2P_CREATED.type,
			toastTypes.LIBP2P_CREATED.duration
		),
	showHeliaCreated: () =>
		showToast(
			toastTypes.HELIA_CREATED.message,
			toastTypes.HELIA_CREATED.type,
			toastTypes.HELIA_CREATED.duration
		),
	showOrbitDBCreated: () =>
		showToast(
			toastTypes.ORBITDB_CREATED.message,
			toastTypes.ORBITDB_CREATED.type,
			toastTypes.ORBITDB_CREATED.duration
		),
	showPeerConnected: (peerId) =>
		showToast(`👥 Peer connected: ${peerId?.slice(-8) || 'unknown'}`, 'success', 3000),
	showPeerDisconnected: (peerId) =>
		showToast(`👋 Peer disconnected: ${peerId?.slice(-8) || 'unknown'}`, 'warning', 3000),
	showConnectionOpened: () =>
		showToast(
			toastTypes.CONNECTION_OPENED.message,
			toastTypes.CONNECTION_OPENED.type,
			toastTypes.CONNECTION_OPENED.duration
		),
	showConnectionClosed: () =>
		showToast(
			toastTypes.CONNECTION_CLOSED.message,
			toastTypes.CONNECTION_CLOSED.type,
			toastTypes.CONNECTION_CLOSED.duration
		),
	showDatabaseLoaded: () =>
		showToast(
			toastTypes.DATABASE_LOADED.message,
			toastTypes.DATABASE_LOADED.type,
			toastTypes.DATABASE_LOADED.duration
		),
	showLoadingTodos: () =>
		showToast(
			toastTypes.LOADING_TODOS.message,
			toastTypes.LOADING_TODOS.type,
			toastTypes.LOADING_TODOS.duration
		),
	showTodosLoaded: (count) => showToast(`✅ ${count} todos loaded from database`, 'success', 2000),
	showStoragePersistent: () =>
		showToast(
			toastTypes.STORAGE_PERSISTENT.message,
			toastTypes.STORAGE_PERSISTENT.type,
			toastTypes.STORAGE_PERSISTENT.duration
		),
	showStorageMemory: () =>
		showToast(
			toastTypes.STORAGE_MEMORY.message,
			toastTypes.STORAGE_MEMORY.type,
			toastTypes.STORAGE_MEMORY.duration
		),
	showStorageTestFailed: () =>
		showToast(
			toastTypes.STORAGE_TEST_FAILED.message,
			toastTypes.STORAGE_TEST_FAILED.type,
			toastTypes.STORAGE_TEST_FAILED.duration
		),
	showError: (message) => showToast(message, 'error', 5000)
};
