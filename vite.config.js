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

/**
 * P2Pass ships `.svelte` files with `<style>`; @tailwindcss/vite can treat the virtual CSS module as tied to
 * the parent `.svelte` id and feed content the CSS parser rejects ("Invalid declaration: onMount").
 * Those blocks are plain CSS (no @tailwind / @apply); skipping Tailwind here is safe.
 *
 */
function tailwindcssWithoutP2passSvelteCss(options) {
	const plugins = tailwindcss(options);
	for (const p of plugins) {
		const name = p?.name ?? '';
		if (!name.startsWith('@tailwindcss/vite:generate')) continue;
		const t = p.transform;
		if (!t || typeof t.handler !== 'function') continue;
		const original = t.handler;
		t.handler = async function (code, id, ...rest) {
			if (
				typeof id === 'string' &&
				id.includes('@le-space/p2pass') &&
				id.includes('.svelte')
			) {
				return;
			}
			return original.call(this, code, id, ...rest);
		};
	}
	return plugins;
}

export default defineConfig(({ mode }) => ({
	// P2Pass / WebAuthn standalone worker uses dynamic imports; Vite 7 default iife forbids code-splitting in workers.
	worker: {
		format: 'es'
	},
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
		...tailwindcssWithoutP2passSvelteCss(),
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
		// Omit PWA in `--mode test`: Workbox CacheFirst + new chunk hashes → 404 on /_app/immutable/*.js (white screen).
		...(mode === 'test'
			? []
			: [
					VitePWA({
						registerType: 'autoUpdate',
						injectRegister: 'auto',
						workbox: {
							maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
							globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
							globIgnores: ['**/orbitdb/**', '**/ipfs/**', '**/node_modules/**'],
							additionalManifestEntries: [
								{ url: 'index.html', revision: null },
								{ url: '/', revision: null }
							],
							runtimeCaching: [
								{
									urlPattern: ({ request }) => {
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
											maxAgeSeconds: 30 * 24 * 60 * 60
										},
										cacheableResponse: {
											statuses: [0, 200]
										}
									}
								},
								{
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
											maxAgeSeconds: 30 * 24 * 60 * 60
										}
									}
								},
								{
									urlPattern: ({ request }) => {
										return request.destination === 'image';
									},
									handler: 'CacheFirst',
									options: {
										cacheName: 'images-cache',
										expiration: {
											maxEntries: 60,
											maxAgeSeconds: 60 * 24 * 60 * 60
										}
									}
								}
							],
							skipWaiting: true,
							clientsClaim: true,
							cleanupOutdatedCaches: true
						},
						manifest: false,
						devOptions: {
							enabled: process.env.PWA_DEV_ENABLED === 'true',
							type: 'module'
						}
					})
				])
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__BUILD_DATE__: JSON.stringify(buildDate),
		__PWA_DEV_ENABLED__: JSON.stringify(process.env.PWA_DEV_ENABLED === 'true')
	},
	server: {
		proxy: {
			'/__bundler': {
				target: 'http://127.0.0.1:4337',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/__bundler/, '') || '/'
			},
			'/__paymaster': {
				target: 'http://127.0.0.1:3002',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/__paymaster/, '') || '/'
			}
		}
	},
	optimizeDeps: {
		// Exclude problematic packages that include .d.ts files in their bin
		exclude: [
			'cborg',
			'@storacha/blob-index',
			// Worker keystore: `new Worker(new URL('./ed25519-keystore.worker.js', import.meta.url))` must stay
			// beside the real source files. Pre-bundling into `.vite/deps` makes the browser request a missing sibling → 404.
			'@le-space/orbitdb-identity-provider-webauthn-did'
		],
		// Include varint to ensure it's pre-bundled correctly
		// `ms` is CJS-only (`module.exports`); without prebundle, browser ESM sees no `default` (debug → humanize).
		include: ['varint', 'ms', 'debug'],
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
			fs: resolve(__dirname, 'src/lib/browser-stubs/fs.js'),
			// Normalize @le-space aliases to top-level npm aliased installs.
			'@le-space/iso-did': resolve(__dirname, 'node_modules/iso-did'),
			'@le-space/iso-passkeys': resolve(__dirname, 'node_modules/iso-passkeys'),
			// PWA plugin is omitted in `mode === 'test'`; +layout.svelte still imports virtual:pwa-register.
			...(mode === 'test'
				? {
						'virtual:pwa-register': resolve(__dirname, 'src/lib/browser-stubs/pwa-register.js')
					}
				: {})
		}
	},
	// Handle CommonJS modules that don't have default exports
	build: {
		commonjsOptions: {
			include: [/varint/, /node_modules/],
			transformMixedEsModules: true
		}
	}
}));
