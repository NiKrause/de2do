import { writable } from 'svelte/store';

const defaultState = {
	active: false,
	address: null,
	name: null,
	displayName: '',
	source: '',
	wrongPassword: false,
	error: '',
	lastTriedMethod: null
};

export const inlineUnlockStore = writable({ ...defaultState });

export function requestInlineUnlock(request = {}) {
	inlineUnlockStore.set({
		...defaultState,
		active: true,
		...request
	});
}

export function updateInlineUnlock(patch = {}) {
	inlineUnlockStore.update((state) => ({
		...state,
		...patch,
		active: true
	}));
}

export function clearInlineUnlock() {
	inlineUnlockStore.set({ ...defaultState });
}
