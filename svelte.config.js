import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
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
			// SPA build: we rely on adapter-static's `fallback` for all routes (including `/`).
			// This avoids generating `build/index.html` via prerender and then overwriting it
			// with the fallback (which triggers a build warning).
			entries: [],
			handleUnseenRoutes: 'ignore' // or 'fail' to fail on unseen routes
		}
	}
};

export default config;
