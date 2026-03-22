/**
 * No-op replacement for `virtual:pwa-register` when `vite-plugin-pwa` is omitted (`--mode test`).
 * Keeps `build:test` / E2E preview working without a service worker.
 */
export function registerSW() {
	/* intentionally empty */
}
