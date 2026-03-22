declare global {
	const __APP_VERSION__: string;
	const __BUILD_DATE__: string;
	interface Window {
		/** Set in `+layout.svelte` when `vite build --mode test` so Playwright reads the same RPC/escrow as the bundle. */
		__PASSKEY_E2E_CHAIN__?: {
			escrowAddress: string | null;
			rpcUrl: string | null;
			chainId: string | null;
		};
	}
	namespace App {}
}
export {};
