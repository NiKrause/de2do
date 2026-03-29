import { writable } from 'svelte/store';

/** Shared open state for the P2Pass panel (footer toggle + StorachaFab). */
export const p2passPanelOpenStore = writable(false);

export function toggleP2PassPanel() {
	p2passPanelOpenStore.update((v) => !v);
}
