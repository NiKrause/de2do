import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

// BrowserStack configuration
const BS_LOCAL_ENABLED = process.env.BROWSERSTACK_BUILD_NAME ? true : false;
const BS_USERNAME = process.env.BROWSERSTACK_USERNAME;
const BS_ACCESS_KEY = process.env.BROWSERSTACK_ACCESS_KEY;
const BS_BUILD_NAME = process.env.BROWSERSTACK_BUILD_NAME || `playwright-build-${Date.now()}`;

// Common BrowserStack capabilities
const browserstackCapabilities = {
	'browserstack.username': BS_USERNAME,
	'browserstack.accessKey': BS_ACCESS_KEY,
	'browserstack.buildName': BS_BUILD_NAME,
	'browserstack.projectName': 'simple-todo-consent-screen-tests',
	'browserstack.debug': 'true',
	'browserstack.console': 'verbose',
	'browserstack.networkLogs': 'true',
	'browserstack.local': 'true', // Enable local tunnel
	'browserstack.localIdentifier': BS_BUILD_NAME || 'simple-todo-local'
};

export default defineConfig({
	webServer: BS_LOCAL_ENABLED
		? undefined
		: {
				command: 'pnpm run build && pnpm run preview',
				port: 4173
			},
	testDir: 'e2e',
	timeout: 60000,
	expect: {
		timeout: 30000
	},
	use: {
		// Base URL - for local tests only
		baseURL: BS_LOCAL_ENABLED ? undefined : 'http://localhost:4173',
		// Capture screenshots on failure
		screenshot: 'only-on-failure',
		// Record video on first retry
		video: 'retain-on-failure',
		// Collect trace on failure
		trace: 'on-first-retry'
	},
	// Configure projects for different browsers and platforms
	projects: BS_LOCAL_ENABLED
		? [
				// Desktop browsers
				{
					name: 'Chrome Windows',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'Windows',
						'browserstack.osVersion': '11',
						'browserstack.browser': 'chrome',
						'browserstack.browserVersion': 'latest'
					}
				},
				{
					name: 'Firefox Windows',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'Windows',
						'browserstack.osVersion': '11',
						'browserstack.browser': 'firefox',
						'browserstack.browserVersion': 'latest'
					}
				},
				{
					name: 'Edge Windows',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'Windows',
						'browserstack.osVersion': '11',
						'browserstack.browser': 'edge',
						'browserstack.browserVersion': 'latest'
					}
				},
				{
					name: 'Chrome macOS',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'OS X',
						'browserstack.osVersion': 'Monterey',
						'browserstack.browser': 'chrome',
						'browserstack.browserVersion': 'latest'
					}
				},
				{
					name: 'Firefox macOS',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'OS X',
						'browserstack.osVersion': 'Monterey',
						'browserstack.browser': 'firefox',
						'browserstack.browserVersion': 'latest'
					}
				},
				{
					name: 'Safari macOS',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'OS X',
						'browserstack.osVersion': 'Monterey',
						'browserstack.browser': 'safari',
						'browserstack.browserVersion': 'latest'
					}
				},
				{
					name: 'Chrome Linux',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'Linux',
						'browserstack.osVersion': 'Ubuntu 20.04',
						'browserstack.browser': 'chrome',
						'browserstack.browserVersion': 'latest'
					}
				},
				// Mobile browsers
				{
					name: 'iPhone Safari',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'ios',
						'browserstack.osVersion': '16',
						'browserstack.device': 'iPhone 14',
						'browserstack.browser': 'safari',
						'browserstack.realMobile': 'true'
					}
				},
				{
					name: 'Android Chrome',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'android',
						'browserstack.osVersion': '12.0',
						'browserstack.device': 'Samsung Galaxy S22',
						'browserstack.browser': 'chrome',
						'browserstack.realMobile': 'true'
					}
				},
				// Alternative browsers
				{
					name: 'Opera Windows',
					use: {
						...browserstackCapabilities,
						'browserstack.os': 'Windows',
						'browserstack.osVersion': '11',
						'browserstack.browser': 'opera',
						'browserstack.browserVersion': 'latest'
					}
				}
				// Note: Brave browser testing requires special setup not available in standard BrowserStack
				// For Brave testing, use local installation with channel: 'brave' in local projects
			]
		: [
				// Local testing projects
				{
					name: 'chromium',
					use: { ...devices['Desktop Chrome'] }
				},
				{
					name: 'firefox',
					use: { ...devices['Desktop Firefox'] }
				},
				{
					name: 'webkit',
					use: { ...devices['Desktop Safari'] }
				}
			]
});
