import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	// Global setup and teardown for relay server
	globalSetup: './e2e/global-setup.js',
	globalTeardown: './e2e/global-teardown.js',

	// Web server configuration
	webServer: {
		// Build first in CI, reuse existing build locally
		command: process.env.CI
			? 'npm run build && npm run preview -- --host 127.0.0.1 --port 4174'
			: 'npm run preview -- --host 127.0.0.1 --port 4174',
		port: 4174,
		// Use the test environment file and set development mode
		env: {
			// VITE_ENV_FILE: '.env.development',
			VITE_NODE_ENV: 'development'
		},
		// Wait for server to be ready (increased for build time)
		timeout: 120000, // Increased timeout to allow for build + server startup
		reuseExistingServer: !process.env.CI
	},

	// Test configuration
	testDir: 'e2e',
	timeout: 60000, // 60 seconds per test
	expect: {
		// Increase timeout for P2P operations
		timeout: 15000
	},

	// Browser projects - Only Chromium for P2P/WebRTC compatibility
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Enable features needed for P2P
				launchOptions: {
					args: [
						// '--enable-features=NetworkService,NetworkServiceLogging',
						// '--disable-features=VizDisplayCompositor',
						// '--disable-web-security',
						// '--allow-running-insecure-content',
						// '--use-fake-ui-for-media-stream',
						// '--use-fake-device-for-media-stream'
					]
				},
				// Grant permissions needed for WebRTC
				permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
				// Set user agent to avoid blocking
				userAgent:
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		}
		// {
		// 	name: 'firefox',
		// 	use: {
		// 		...devices['Desktop Firefox'],
		// 		// Enable WebRTC and STUN in Firefox for Playwright
		// 		// Note: Firefox doesn't support Playwright's permissions API like Chromium
		// 		// Instead, we use firefoxUserPrefs to configure permissions
		// 		launchOptions: {
		// 			firefoxUserPrefs: {
		// 				// Core WebRTC enablement
		// 				'"'"'media.peerconnection.enabled'"'"': true,
		// 				'"'"'media.navigator.enabled'"'"': true,
		// 				'"'"'media.navigator.permission.disabled'"'"': true,

		// 				// CRITICAL: Allow host candidates and disable obfuscation
		// 				'"'"'media.peerconnection.ice.default_address_only'"'"': false,
		// 				'"'"'media.peerconnection.ice.no_host'"'"': false,
		// 				'"'"'media.peerconnection.ice.obfuscate_host_addresses'"'"': false, // NEW! Critical for host IPs
		// 				'"'"'media.peerconnection.ice.obfuscate_host_addresses.blocklist'"'"': '', // NEW! Empty blocklist

		// 				// Enable ICE protocols
		// 				'"'"'media.peerconnection.ice.tcp'"'"': true,
		// 				'"'"'media.peerconnection.ice.relay_only'"'"': false,
		// 				'"'"'media.peerconnection.ice.loopback'"'"': true, // Enable loopback candidates for localhost
		// 				'"'"'media.peerconnection.ice.link_local'"'"': true, // Enable link-local addresses

		// 				// Disable ALL privacy protections that interfere with ICE
		// 				'"'"'media.peerconnection.ice.proxy_only_if_behind_proxy'"'"': false,
		// 				'"'"'media.peerconnection.identity.enabled'"'"': true,
		// 				'"'"'privacy.resistFingerprinting'"'"': false, // NEW! Disable fingerprinting protection

		// 				// Allow insecure connections for localhost testing
		// 				'"'"'media.getusermedia.insecure.enabled'"'"': true, // NEW! Allow getUserMedia on http://

		// 				// Connection settings
		// 				'"'"'media.peerconnection.use_document_iceservers'"'"': true,

		// 				// Enable necessary permissions without prompts
		// 				'"'"'permissions.default.camera'"'"': 1,
		// 				'"'"'permissions.default.microphone'"'"': 1,
		// 				'"'"'permissions.default.desktop-notification'"'"': 1,

		// 				// Disable security restrictions for testing
		// 				'"'"'network.http.referer.disallowCrossSiteRelaxingDefault'"'"': false, // NEW!
		// 				'"'"'security.fileuri.strict_origin_policy'"'"': false // NEW!
		// 			}
		// 		}
		// 	}
		// },
		// {
		// 	name: 'webkit',
		// 	use: { ...devices['Desktop Safari'] }
		// }
	],

	// Reporter configuration
	reporter: [['html'], ['list'], ['junit', { outputFile: 'test-results/junit.xml' }]],

	// Output directory
	outputDir: 'test-results/',

	// Retry configuration
	retries: process.env.CI ? 2 : 0,

	// Worker configuration
	workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : (process.env.CI ? 1 : 2),

	// Use baseURL for all tests
	use: {
		baseURL: 'http://127.0.0.1:4174',
		// Take screenshots on failure
		screenshot: 'only-on-failure',
		// Record video on failure
		video: 'retain-on-failure',
		// Collect trace on failure
		trace: 'retain-on-failure'
	}
});
