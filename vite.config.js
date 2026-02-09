import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// update version in package.json and title
const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

// Get directory for resolve aliases
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Create build date
const buildDate = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString(); // YYYY-MM-DD HH:MM:SS format

export default defineConfig({
	plugins: [
		// Plugin to exclude .d.ts files from processing
		{
			name: 'exclude-dts',
			load(id) {
				if (id.endsWith('.d.ts')) {
					return 'export {}'; // Return empty module for .d.ts files
				}
			}
		},
		// Plugin to suppress source map warnings
		{
			name: 'suppress-sourcemap-warnings',
			configureServer() {
				const originalWarn = console.warn;
				console.warn = (...args) => {
					const message = args.join(' ');
					if (message.includes('Failed to load source map') && message.includes('@storacha')) {
						return; // Suppress source map warnings for @storacha packages
					}
					originalWarn.apply(console, args);
				};
			}
		},
		tailwindcss(),
		sveltekit(),
		nodePolyfills({
			include: [
				'path',
				'util',
				'buffer',
				'process',
				'events',
				'crypto',
				'os',
				'stream',
				'string_decoder'
			],
			globals: {
				Buffer: true,
				global: true,
				process: true
			},
			protocolImports: true
		}),
		VitePWA({
			// PWA configuration optimized for offline-first operation
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			workbox: {
				// Increase the maximum file size limit to 5MB to handle large P2P libraries
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
				// Precache all build assets (HTML, JS, CSS) for true offline support
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
				// Exclude OrbitDB and large files from precaching
				globIgnores: ['**/orbitdb/**', '**/ipfs/**', '**/node_modules/**'],
				// Manually add index.html to precache (SvelteKit fallback)
				additionalManifestEntries: [
					{ url: 'index.html', revision: null },
					{ url: '/', revision: null }
				],
				// Runtime caching strategies for dynamic content
				runtimeCaching: [
					{
						// For navigation requests, use cache first for instant offline loading
						urlPattern: ({ request }) => {
							// Only cache navigation requests, avoid OrbitDB/IPFS requests
							return (
								request.mode === 'navigate' &&
								!request.url.includes('/ipfs/') &&
								!request.url.includes('/orbitdb/')
							);
						},
						handler: 'CacheFirst',
						options: {
							cacheName: 'navigation-cache',
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						// For static assets, use cache first with background updates
						urlPattern: ({ request }) => {
							return (
								request.destination === 'style' ||
								request.destination === 'script' ||
								request.destination === 'font'
							);
						},
						handler: 'CacheFirst',
						options: {
							cacheName: 'assets-cache',
							expiration: {
								maxEntries: 100,
								maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
							}
						}
					},
					{
						// For images, use cache first with longer expiration
						urlPattern: ({ request }) => {
							return request.destination === 'image';
						},
						handler: 'CacheFirst',
						options: {
							cacheName: 'images-cache',
							expiration: {
								maxEntries: 60,
								maxAgeSeconds: 60 * 24 * 60 * 60 // 60 days
							}
						}
					}
				],
				// Skip waiting for immediate activation
				skipWaiting: true,
				clientsClaim: true,
				// Clean old caches on activation
				cleanupOutdatedCaches: true
			},
			// Use existing manifest.json
			manifest: false, // We'll use our custom manifest.json
			// Development options
			devOptions: {
				// EXPERIMENTAL/UNSTABLE dev-PWA toggle:
				// Enable only when explicitly requested to avoid Workbox "glob doesn't match"
				// warnings in normal dev/e2e runs where no dev precache build is present.
				enabled: process.env.PWA_DEV === 'true',
				type: 'module'
			}
		})
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__BUILD_DATE__: JSON.stringify(buildDate)
	},
	optimizeDeps: {
		// Exclude problematic packages that include .d.ts files in their bin
		exclude: ['cborg', '@storacha/blob-index'],
		// Include varint to ensure it's pre-bundled correctly
		include: ['varint'],
		// Configure esbuild to handle CommonJS modules like varint
		esbuildOptions: {
			format: 'esm',
			mainFields: ['module', 'main']
		}
	},
	resolve: {
		// Prevent Vite from trying to process .d.ts files
		extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.svelte'],
		// Alias Node.js modules that don't exist in browser to empty stubs
		alias: {
			// Stub out 'fs' module for browser compatibility
			// orbitdb-storacha-bridge imports fs but it's not used in browser code paths
			fs: resolve(__dirname, 'src/lib/browser-stubs/fs.js')
		}
	},
	// Handle CommonJS modules that don't have default exports
	build: {
		commonjsOptions: {
			include: [/varint/, /node_modules/],
			transformMixedEsModules: true
		}
	}
});
