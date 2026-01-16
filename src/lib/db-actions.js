import { writable, derived, get } from 'svelte/store';
import { systemToasts } from './toast-store.js';
import { currentDbAddressStore, peerIdStore } from './stores.js';

// Store for OrbitDB instances
export const orbitdbStore = writable(null);
export const todoDBStore = writable(null);

// Store for todos
export const todosStore = writable([]);

// Keep track of previous database to remove event listeners
let previousTodoDB = null;

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

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

		// Handle both array and object structures
		let todosArray;
		if (!Array.isArray(allTodos)) {
			console.error('Expected array from todoDB.all()', {
				actualType: typeof allTodos,
				value: allTodos
			});
			return;
		}

		todosArray = allTodos
			.map((todo, index) => {
				if (!todo || typeof todo !== 'object') {
					console.warn(`⚠️ Invalid todo at index ${index}:`, todo);
					return null;
				}

				// Skip entries with undefined values - these are encrypted entries
				// that can't be decrypted (database opened without encryption)
				if (todo.value === undefined) {
					console.log(`🔒 Skipping encrypted entry at index ${index} (value is undefined)`);
					return null;
				}

				// Skip entries where value is not an object
				if (todo.value !== null && typeof todo.value !== 'object') {
					console.warn(`⚠️ Invalid todo value at index ${index}:`, todo.value);
					return null;
				}

				return {
					id: todo.hash,
					key: todo.key,
					...todo.value // Access the nested value property
				};
			})
			.filter(Boolean); // Remove null entries

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

		const errorMessage = error?.message || '';
		
		// Check if this is a decryption error (wrong password or encrypted database opened without encryption)
		// This can happen when:
		// 1. Database is encrypted but opened without password
		// 2. Wrong password was used
		// 3. OrbitDB throws TypeError when trying to read entry.value from undecryptable entries
		if (
			errorMessage.includes('decrypt') ||
			(error instanceof TypeError && /reading 'value'/.test(errorMessage))
		) {
			console.error('❌ Decryption error detected - encrypted database opened without password');
			// Don't show error toast - this is expected when opening encrypted DB without password
			// Just set empty todos array
			todosStore.set([]);
			return;
		} else {
			systemToasts.showError(`Failed to load todos: ${errorMessage}`);
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
	estimatedCosts = {}
) {
	console.log('🔍 Adding todo:', text);
	const todoDB = get(todoDBStore);
	const myPeerId = get(peerIdStore);

	if (!todoDB || !myPeerId) {
		console.error('❌ Database or peer ID not available');
		return false;
	}

	if (!text || text.trim() === '') {
		console.error('❌ Todo text cannot be empty');
		return false;
	}

	try {
		const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const todo = {
			text: text.trim(),
			description: description || '',
			priority: priority || null, // 'A', 'B', or 'C'
			completed: false,
			createdBy: myPeerId,
			assignee: assignee,
			estimatedTime: estimatedTime || null, // in minutes or hours
			estimatedCosts: estimatedCosts || {}, // { usd: 0, eth: 0, btc: 0 }
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
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

		// Access the nested value property for the todo data
		const todoData = existingTodo.value || existingTodo;
		const currentCompleted = todoData.completed || false;

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
