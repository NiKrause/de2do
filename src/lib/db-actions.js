import { writable, derived, get } from 'svelte/store';
import { systemToasts } from './toast-store.js';
import {
	currentDbAddressStore,
	currentIdentityStore,
	peerIdStore,
	delegatedWriteAuthStore
} from './stores.js';
import { authenticateWithWebAuthn, hasExistingCredentials } from './identity/webauthn-identity.js';

// Store for OrbitDB instances
export const orbitdbStore = writable(null);
export const todoDBStore = writable(null);

// Store for todos
export const todosStore = writable([]);

// Keep track of previous database to remove event listeners
let previousTodoDB = null;

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

export function getCurrentAccessControllerType() {
	const todoDB = get(todoDBStore);
	return todoDB?.access?.type || null;
}

function isDelegationActiveFor(todo, identityId) {
	const delegation = todo?.delegation;
	if (!delegation?.delegateDid || !identityId) return false;
	if (delegation.delegateDid !== identityId) return false;
	if (delegation.revokedAt) return false;
	if (delegation.expiresAt && Date.parse(delegation.expiresAt) < Date.now()) return false;
	return true;
}

function buildDelegationActionKey(taskKey, delegateDid) {
	const encodedDelegateDid = encodeURIComponent(delegateDid);
	return `delegation-action/${taskKey}/${encodedDelegateDid}/${Date.now()}_${Math.random()
		.toString(36)
		.slice(2, 9)}`;
}

function setDelegatedAuthState(state, action, message = '') {
	delegatedWriteAuthStore.set({
		state,
		action,
		at: new Date().toISOString(),
		message
	});
}

function scheduleDelegatedAuthReset() {
	if (typeof window === 'undefined') return;
	window.setTimeout(() => {
		delegatedWriteAuthStore.update((current) => {
			if (current.state === 'awaiting') return current;
			return { state: 'idle', action: null, at: null, message: '' };
		});
	}, 3000);
}

async function requireDelegatedWriteAuthentication(actionName) {
	// If no credentials exist we keep current behavior and let access control enforce auth failures.
	if (!hasExistingCredentials()) {
		return true;
	}

	const startedAt = Date.now();
	setDelegatedAuthState('awaiting', actionName, 'Confirm passkey to sign delegated write');
	try {
		const authResult = await authenticateWithWebAuthn();
		const elapsed = Date.now() - startedAt;
		if (elapsed < 250) {
			await new Promise((resolve) => setTimeout(resolve, 250 - elapsed));
		}
		setDelegatedAuthState('success', actionName, 'Delegated write signed');
		scheduleDelegatedAuthReset();
		return true;
	} catch (error) {
		setDelegatedAuthState(
			'error',
			actionName,
			error?.message || 'Delegated write authentication failed'
		);
		scheduleDelegatedAuthReset();
		return false;
	}
}

// Initialize database and load existing todos
export async function initializeDatabase(orbitdb, todoDB, preferences) {
	// Clear todos from previous database first
	todosStore.set([]);

	orbitdbStore.set(orbitdb);
	todoDBStore.set(todoDB);

	// Update currentDbAddressStore with the database address
	if (todoDB && todoDB.address) {
		currentDbAddressStore.set(todoDB.address);
		// Also expose to window immediately for e2e testing (in case reactive statements haven't run yet)
		if (typeof window !== 'undefined') {
			window.__todoDB__ = todoDB;
			window.__currentDbAddress__ = todoDB.address;
		}
	}

	// Remove event listeners from previous database before setting up new ones
	if (previousTodoDB && previousTodoDB !== todoDB) {
		removeDatabaseListeners(previousTodoDB);
	}

	// Set up event listeners FIRST - so they catch data as it syncs from peers/IPFS
	setupDatabaseListeners(todoDB);

	// Update reference to current database
	previousTodoDB = todoDB;

	// Then load existing todos (if any are already available)
	// If data arrives later via sync, the event listeners will trigger loadTodos()
	if (preferences.enablePersistentStorage || preferences.enableNetworkConnection) {
		await loadTodos();
	}
}

// Load all todos from the database
export async function loadTodos() {
	console.log('🔍 Loading todos...');
	const todoDB = get(todoDBStore);
	if (!todoDB) {
		console.warn('⚠️ TodoDB not available, skipping load');
		return;
	}

	// Show loading toast
	systemToasts.showLoadingTodos();

	try {
		console.log('🔍 Calling todoDB.all()...');
		const allTodos = await todoDB.all();
		console.log('🔍 Raw database entries:', allTodos); // Add this debug log

		if (!Array.isArray(allTodos)) {
			console.error('Expected array from todoDB.all()', {
				actualType: typeof allTodos,
				value: allTodos
			});
			return;
		}

		const todosArray = [];
		const delegationActions = [];

		for (const [index, todo] of allTodos.entries()) {
			if (!todo || typeof todo !== 'object') {
				console.warn(`⚠️ Invalid todo at index ${index}:`, todo);
				continue;
			}

			const key = todo.key;
			const value = todo.value || {};
			if (typeof key === 'string' && key.startsWith('delegation-action/')) {
				delegationActions.push({
					key,
					hash: todo.hash,
					...value
				});
				continue;
			}

			todosArray.push({
				id: todo.hash,
				key,
				...value
			});
		}

		const todosByKey = new Map(todosArray.map((todo) => [todo.key, todo]));
		const delegationActionsByTask = new Map();

		for (const action of delegationActions) {
			if (action.type !== 'delegation-action') continue;
			if (!['set-completed', 'patch-fields'].includes(action.action)) continue;
			if (typeof action.taskKey !== 'string') continue;
			if (action.action === 'set-completed' && typeof action.setCompleted !== 'boolean') continue;
			if (action.action === 'patch-fields' && (!action.patch || typeof action.patch !== 'object'))
				continue;

			const task = todosByKey.get(action.taskKey);
			if (!task) continue;

			if (!isDelegationActiveFor(task, action.delegateDid)) continue;

			const actionTime = Date.parse(action.performedAt || '');
			if (Number.isNaN(actionTime)) continue;

			const actionsForTask = delegationActionsByTask.get(action.taskKey) || [];
			actionsForTask.push(action);
			delegationActionsByTask.set(action.taskKey, actionsForTask);
		}

		for (const [taskKey, actionsForTask] of delegationActionsByTask.entries()) {
			const task = todosByKey.get(taskKey);
			if (!task) continue;

			actionsForTask.sort((a, b) => {
				const at = Date.parse(a.performedAt || '') || 0;
				const bt = Date.parse(b.performedAt || '') || 0;
				return at - bt;
			});

			for (const action of actionsForTask) {
				if (action.action === 'set-completed') {
					task.completed = action.setCompleted;
				}
				if (action.action === 'patch-fields') {
					if (typeof action.patch.text === 'string') {
						task.text = action.patch.text;
					}
					if (typeof action.patch.description === 'string') {
						task.description = action.patch.description;
					}
				}
				task.updatedAt = action.performedAt || task.updatedAt;
				task.updatedBy = action.performedBy || action.delegateDid || task.updatedBy;
			}
		}

		// Sort by createdAt descending (newest first)
		const sortedTodos = todosArray.sort((a, b) => {
			const dateA = new Date(a.createdAt || 0);
			const dateB = new Date(b.createdAt || 0);
			return dateB - dateA;
		});

		todosStore.set(sortedTodos);
		console.log('todos', sortedTodos);
		console.log('📋 Loaded todos:', sortedTodos.length);

		// Show success toast with todo count
		systemToasts.showTodosLoaded(sortedTodos.length);
	} catch (error) {
		console.error('Error loading todos:', error, {
			todoDBAddress: todoDB?.address,
			todoDBType: typeof todoDB
		});

		// Check if this is a decryption error (wrong password)
		if (error.message && error.message.includes('decrypt')) {
			console.error('❌ Decryption error detected - wrong password or encrypted database');
			systemToasts.showError('Failed to decrypt database entries. Wrong password?');
			// Note: The password was already accepted during open, but entries arrived later
			// We can't re-prompt here easily, so just show error
			// TODO: Consider implementing re-authentication flow
		} else {
			systemToasts.showError(`Failed to load todos: ${error.message}`);
		}
	}
}

// Store event listener references so we can remove them later
const eventListeners = new WeakMap();

// Set up database event listeners
function setupDatabaseListeners(todoDB) {
	if (!todoDB) return;

	// Create event handler functions
	const updateHandler = async () => {
		console.log('🔄 Update event fired - database entries changed');
		await loadTodos();
	};

	const joinHandler = async (peerId, heads) => {
		console.log(`👤 Peer joined: ${peerId}, heads: ${heads?.length || 0}`);
		// Only reload if peer has new data to share
		if (heads && heads.length > 0) {
			console.log('📥 Peer has new data, reloading todos...');
			await loadTodos();
		}
	};

	// Store references to handlers for later removal
	eventListeners.set(todoDB, { updateHandler, joinHandler });

	// Listen for 'update' event - fires when entries are added/updated (local or from peers)
	// This is the main event for data synchronization
	todoDB.events.on('update', updateHandler);

	// Listen for 'join' event - fires when a peer connects
	// Only reload if the peer has new data (heads array has entries)
	todoDB.events.on('join', joinHandler);
}

// Remove database event listeners
function removeDatabaseListeners(todoDB) {
	if (!todoDB || !todoDB.events) return;

	const handlers = eventListeners.get(todoDB);
	if (!handlers) return;

	console.log('🧹 Removing event listeners from previous database');

	// Remove the specific handlers we added
	if (handlers.updateHandler) {
		todoDB.events.off('update', handlers.updateHandler);
	}
	if (handlers.joinHandler) {
		todoDB.events.off('join', handlers.joinHandler);
	}

	// Clean up the reference
	eventListeners.delete(todoDB);
}

// Add a new todo
export async function addTodo(
	text,
	assignee = null,
	description = '',
	priority = null,
	estimatedTime = null,
	estimatedCosts = {},
	delegationOptions = {}
) {
	console.log('🔍 Adding todo:', text);
	const todoDB = get(todoDBStore);
	const myPeerId = get(peerIdStore);
	const currentIdentity = get(currentIdentityStore);

	if (!todoDB || !myPeerId) {
		console.error('❌ Database or peer ID not available');
		return false;
	}

	if (!text || text.trim() === '') {
		console.error('❌ Todo text cannot be empty');
		return false;
	}

	const delegateDid = delegationOptions?.delegateDid || null;
	if (typeof delegateDid === 'string' && delegateDid.trim()) {
		const accessType = getCurrentAccessControllerType();
		if (accessType !== 'todo-delegation') {
			console.error('❌ Delegation blocked: current database uses legacy access controller', {
				accessType,
				delegateDid
			});
			return false;
		}
	}

	try {
		const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const expiresAt = delegationOptions?.expiresAt || null;
		const delegation =
			typeof delegateDid === 'string' && delegateDid.trim()
				? {
						delegateDid: delegateDid.trim(),
						grantedBy: currentIdentity?.id || null,
						grantedAt: new Date().toISOString(),
						expiresAt: expiresAt || null,
						revokedAt: null
					}
				: null;
		const todo = {
			text: text.trim(),
			description: description || '',
			priority: priority || null, // 'A', 'B', or 'C'
			completed: false,
			createdBy: myPeerId,
			assignee: assignee,
			estimatedTime: estimatedTime || null, // in minutes or hours
			estimatedCosts: estimatedCosts || {}, // { usd: 0, eth: 0, btc: 0 }
			delegation,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			createdByIdentity: currentIdentity?.id || null
		};
		console.log('🔍 Todo:', todo);
		await todoDB.put(todoId, todo);
		console.log('🔍 Todo added:', todoId);
		// Add this line to manually refresh the UI:
		await loadTodos();
		console.log('✅ Todo added:', todoId);
		return true;
	} catch (error) {
		console.error('❌ Error adding todo:', error);
		return false;
	}
}

// Update a todo
export async function updateTodo(todoId, updates) {
	const todoDB = get(todoDBStore);
	const currentIdentityId = get(currentIdentityStore)?.id || null;

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		// If todoId is numeric (array index), we need to find the actual database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(todoId)];
				if (todo && todo.key) {
					actualTodoId = todo.key;
				}
			}
		}

		const existingTodo = await todoDB.get(actualTodoId);
		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = existingTodo.value || existingTodo;

		const ownerIdentityId = todoData.createdByIdentity || null;
		const isOwner = !ownerIdentityId || ownerIdentityId === currentIdentityId;
		const delegatedWriter = isDelegationActiveFor(todoData, currentIdentityId);

		if (!isOwner && !delegatedWriter) {
			console.error('❌ Current identity has no permission to update todo fields');
			return false;
		}

		if (!isOwner && delegatedWriter) {
			const authOk = await requireDelegatedWriteAuthentication('patch-fields');
			if (!authOk) {
				console.error('❌ Delegated update cancelled: passkey authentication failed');
				return false;
			}

			const patch = {};
			if (typeof updates.text === 'string') patch.text = updates.text;
			if (typeof updates.description === 'string') patch.description = updates.description;
			if (Object.keys(patch).length === 0) {
				console.error('❌ Delegated updates are limited to text/description');
				return false;
			}

			const actionKey = buildDelegationActionKey(actualTodoId, currentIdentityId);
			console.log('📝 Attempting delegated patch action append', {
				actionKey,
				taskKey: actualTodoId,
				delegateDid: currentIdentityId,
				todoOwnerDid: ownerIdentityId,
				todoDelegation: todoData.delegation || null,
				dbAccessType: todoDB?.access?.type || null
			});
			await todoDB.put(actionKey, {
				type: 'delegation-action',
				action: 'patch-fields',
				taskKey: actualTodoId,
				delegateDid: currentIdentityId,
				performedBy: currentIdentityId,
				performedAt: new Date().toISOString(),
				patch,
				expiresAt: todoData.delegation?.expiresAt || null
			});
			await loadTodos();
			console.log('✅ Delegated todo patch action added:', actionKey);
			return true;
		}

		const updatedTodo = {
			...todoData,
			...updates,
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(actualTodoId, updatedTodo);
		console.log('✅ Todo updated:', todoId);
		await loadTodos();
		return true;
	} catch (error) {
		console.error('❌ Error updating todo:', error);
		return false;
	}
}

// Delete a todo
export async function deleteTodo(todoId) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		// If todoId is numeric (array index), we need to find the correct database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			// Get all todos to find the correct database key
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(todoId)];
				if (todo && todo.key) {
					actualTodoId = todo.key; // Use the key, not the hash
					console.log('🔍 Converted array index', todoId, 'to key:', actualTodoId);
				}
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(actualTodoId);
		console.log('🗑️ Todo deleted:', todoId, 'actual key:', actualTodoId);

		// Force a reload to ensure the UI is updated
		await loadTodos();

		return true;
	} catch (error) {
		console.error('❌ Error deleting todo:', error);
		return false;
	}
}

// Toggle todo completion status
export async function toggleTodoComplete(todoId) {
	const todoDB = get(todoDBStore);
	const currentIdentityId = get(currentIdentityStore)?.id || null;

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🔍 Attempting to toggle todo with ID:', todoId); // Add this debug log

		// If todoId is numeric (array index), we need to find the actual database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			// Get all todos to find the correct database key
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(todoId)];
				if (todo && todo.hash) {
					actualTodoId = todo.hash;
					console.log('🔍 Converted array index', todoId, 'to hash:', actualTodoId);
				}
			}
		}

		const existingTodo = await todoDB.get(actualTodoId);
		console.log('🔍 Retrieved todo from database:', existingTodo); // Add this debug log

		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId, 'actual ID:', actualTodoId);
			// Let's also log all available todos to see what's in the database
			const allTodos = await todoDB.all();
			console.log('🔍 All available todos in database:', allTodos);
			return false;
		}

		const todoData = existingTodo.value || existingTodo;
		const currentCompleted = todoData.completed || false;
		const ownerIdentityId = todoData.createdByIdentity || null;
		const isOwner = !ownerIdentityId || ownerIdentityId === currentIdentityId;
		const delegatedWriter = isDelegationActiveFor(todoData, currentIdentityId);

		if (!isOwner && !delegatedWriter) {
			console.error('❌ Current identity has no permission to update todo completion');
			return false;
		}

		// Delegates write action entries; owners write canonical todo entries.
		if (!isOwner && delegatedWriter) {
			const authOk = await requireDelegatedWriteAuthentication('set-completed');
			if (!authOk) {
				console.error('❌ Delegated completion cancelled: passkey authentication failed');
				return false;
			}

			const actionKey = buildDelegationActionKey(actualTodoId, currentIdentityId);
			console.log('📝 Attempting delegated completion action append', {
				actionKey,
				taskKey: actualTodoId,
				delegateDid: currentIdentityId,
				todoOwnerDid: ownerIdentityId,
				todoDelegation: todoData.delegation || null,
				dbAccessType: todoDB?.access?.type || null
			});
			await todoDB.put(actionKey, {
				type: 'delegation-action',
				action: 'set-completed',
				taskKey: actualTodoId,
				delegateDid: currentIdentityId,
				performedBy: currentIdentityId,
				performedAt: new Date().toISOString(),
				setCompleted: !currentCompleted,
				expiresAt: todoData.delegation?.expiresAt || null
			});
			console.log('✅ Delegated completion action added:', actionKey);
			await loadTodos();
			return true;
		}

		const updatedTodo = {
			...todoData,
			completed: !currentCompleted,
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(actualTodoId, updatedTodo);
		console.log('✅ Todo toggled:', todoId, updatedTodo.completed);
		return true;
	} catch (error) {
		console.error('❌ Error toggling todo:', error);
		return false;
	}
}

// Update todo assignee
export async function updateTodoAssignee(todoId, assignee) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		const existingTodo = await todoDB.get(todoId);
		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = existingTodo.value || existingTodo;

		const updatedTodo = {
			...todoData,
			assignee: assignee,
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(todoId, updatedTodo);
		console.log('✅ Todo assignee updated:', todoId, assignee);
		return true;
	} catch (error) {
		console.error('❌ Error updating todo assignee:', error);
		return false;
	}
}

export async function revokeTodoDelegation(todoId) {
	const todoDB = get(todoDBStore);
	const currentIdentityId = get(currentIdentityStore)?.id || null;

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		const existingTodo = await todoDB.get(todoId);
		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId);
			return false;
		}

		const todoData = existingTodo.value || existingTodo;
		if (!todoData.delegation?.delegateDid) {
			console.warn('⚠️ Todo has no active delegation:', todoId);
			return false;
		}

		if (todoData.createdByIdentity && todoData.createdByIdentity !== currentIdentityId) {
			console.error('❌ Only the task owner can revoke delegation');
			return false;
		}

		const updatedTodo = {
			...todoData,
			delegation: {
				...todoData.delegation,
				revokedAt: new Date().toISOString(),
				revokedBy: currentIdentityId || null
			},
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(todoId, updatedTodo);
		await loadTodos();
		console.log('✅ Delegation revoked for todo:', todoId);
		return true;
	} catch (error) {
		console.error('❌ Error revoking delegation:', error);
		return false;
	}
}

// Get todos by assignee
export function getTodosByAssignee(assignee) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.assignee === assignee));
}

// Get todos by completion status
export function getTodosByStatus(completed) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.completed === completed));
}

// Get todos created by a specific peer
export function getTodosByCreator(creatorId) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.createdBy === creatorId));
}

// Delete the current database
export async function deleteCurrentDatabase() {
	const todoDB = get(todoDBStore);
	const orbitdb = get(orbitdbStore);

	if (!todoDB || !orbitdb) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🗑️ Deleting current database...');

		// Close the current database
		await todoDB.drop();
		// console.log('✅ Database closed')

		// Drop the database from OrbitDB
		// await orbitdb.close('todos')
		console.log('✅ Database dropped from OrbitDB');

		// Clear the stores
		todoDBStore.set(null);
		todosStore.set([]);

		console.log('✅ Database recreated successfully');
		return true;
	} catch (error) {
		console.error('❌ Error deleting database:', error);
		return false;
	}
}

// Make the function available globally for browser console access
if (typeof window !== 'undefined') {
	window.deleteCurrentDatabase = deleteCurrentDatabase;
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
