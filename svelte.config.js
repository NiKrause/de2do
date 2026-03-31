import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// orbitdb-storacha-bridge has legacy "svelte" in package.json without exports.svelte; silence until upstream fixes.
	vitePlugin: {
		experimental: {
			disableSvelteResolveWarnings: true
		}
	},
	kit: {
		adapter: adapter({
			// Enable fallback to index.html for client-side routing
			// This is required for IPFS hosting and dynamic routes like /embed/[address]
			fallback: 'index.html',
			// Pre-render only the root page, let client-side handle dynamic routes
			precompress: false,
			strict: false
		}),
		prerender: {
			// Only prerender the root page, dynamic routes will be handled client-side
			entries: ['/'],
			handleUnseenRoutes: 'ignore' // or 'fail' to fail on unseen routes
		}
	}
};

export default config;
