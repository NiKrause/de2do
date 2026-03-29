import { writable } from 'svelte/store';

/** Panel-open hint for P2Pass mount (e.g. “P2P initializing” overlay when opened before ready). */
export const p2passPanelOpenStore = writable(false);
