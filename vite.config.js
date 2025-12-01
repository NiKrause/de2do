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
			// PWA configuration optimized for mobile browsers and IndexedDB
			registerType: 'autoUpdate',
			workbox: {
				// Increase the maximum file size limit to 5MB to handle large P2P libraries
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
				// Use network-first strategy to avoid interfering with OrbitDB/libp2p
				runtimeCaching: [
					{
						urlPattern: ({ request }) => {
							// Only cache navigation requests, avoid OrbitDB/IPFS requests
							return (
								request.mode === 'navigate' &&
								!request.url.includes('/ipfs/') &&
								!request.url.includes('/orbitdb/')
							);
						},
						handler: 'NetworkFirst',
						options: {
							cacheName: 'navigation-cache',
							networkTimeoutSeconds: 3,
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: ({ request }) => {
							return request.destination === 'style' || request.destination === 'script';
						},
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'assets-cache'
						}
					}
				],
				// Skip waiting for immediate activation
				skipWaiting: true,
				clientsClaim: true,
				// Exclude OrbitDB and large files from precaching
				globIgnores: ['**/orbitdb/**', '**/ipfs/**', '**/node_modules/**']
			},
			// Use existing manifest.json
			manifest: false, // We'll use our custom manifest.json
			// Development options
			devOptions: {
				enabled: process.env.NODE_ENV === 'development',
				type: 'module'
			}
			// Enable periodic SW updates (removed - not available in current version)
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
