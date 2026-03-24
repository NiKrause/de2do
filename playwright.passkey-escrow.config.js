import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/** Fresh cache dir per run so Chromium cannot reuse a cached index.html with old immutable chunk hashes. */
const passkeyChromeCacheDir = fs.mkdtempSync(path.join(tmpdir(), 'pw-passkey-chrome-'));

const configDir = path.dirname(fileURLToPath(import.meta.url));
const preferPnpm =
	fs.existsSync(path.join(configDir, 'pnpm-lock.yaml')) && process.env.PW_WEBSERVER_USE_NPM !== '1';
/** `pnpm` avoids npm warnings when pnpm env vars are inherited; override with PW_WEBSERVER_USE_NPM=1 or CI. */
const pm =
	process.env.CI === 'true' && process.env.PW_WEBSERVER_USE_NPM !== '0'
		? 'npm'
		: preferPnpm
			? 'pnpm'
			: 'npm';

const chromiumDevice = devices['Desktop Chrome'];

export default defineConfig({
	globalSetup: './e2e/global-setup-passkey-escrow.mjs',
	globalTeardown: './e2e/global-teardown-passkey-escrow.mjs',

	testDir: 'e2e',
	testMatch: '**/passkey-wallet-escrow.spec.js',

	timeout: 600_000,
	expect: { timeout: 45_000 },

	workers: 1,
	retries: process.env.CI ? 1 : 0,

	// Browser `baseURL` stays **localhost** (WebAuthn rpId); Chromium gets `--host-resolver-rules=MAP localhost 127.0.0.1`.
	// **webServer.url** must use **127.0.0.1**: Playwright polls this from Node; `localhost` often resolves to **::1** first
	// while `sirv` in `preview:test` listens on **127.0.0.1** only → ECONNREFUSED → "Timed out waiting … webServer".
	// Build runs in global-setup-passkey-escrow.mjs and exits first (lowers peak RAM vs docker + Vite together).
	webServer: {
		command: `${pm} run preview:test`,
		url: 'http://127.0.0.1:4174',
		timeout: 120_000,
		env: {
			...process.env,
			NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
				.filter(Boolean)
				.join(' ')
				.trim()
		},
		// Only reuse when explicitly set; avoids false "server up" and skipped preview after globalSetup.
		reuseExistingServer: process.env.PW_REUSE_PREVIEW === '1'
	},

	reporter: [
		['html'],
		['list'],
		['junit', { outputFile: 'test-results/junit-passkey-escrow.xml' }]
	],
	outputDir: 'test-results/passkey-escrow',

	projects: [
		{
			name: 'chromium',
			use: {
				...chromiumDevice,
				launchOptions: {
					...chromiumDevice.launchOptions,
					// PW_HEADED=1 — visible browser (debug hangs after virtual authenticator / goto).
					...(process.env.PW_HEADED === '1' ? { headless: false } : {}),
					...(process.env.PW_SLOW_MO
						? { slowMo: Math.max(0, Number(process.env.PW_SLOW_MO) || 0) }
						: {}),
					args: [
						...(chromiumDevice.launchOptions?.args ?? []),
						`--disk-cache-dir=${passkeyChromeCacheDir}`,
						// WebAuthn: origin must be localhost (valid rpId); preview listens on 127.0.0.1 only
						'--host-resolver-rules=MAP localhost 127.0.0.1'
					]
				},
				permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
				userAgent:
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		}
	],

	use: {
		baseURL: 'http://localhost:4174',
		serviceWorkers: 'block',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'retain-on-failure'
	}
});
