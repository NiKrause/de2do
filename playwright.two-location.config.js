import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 180000,
	expect: {
		timeout: 20000
	},
	workers: 1,
	retries: 0,
	reporter: [['list'], ['html'], ['junit', { outputFile: 'test-results/two-location-junit.xml' }]],
	outputDir: 'test-results/',
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write']
			}
		}
	],
	use: {
		baseURL: process.env.PUBLIC_APP_URL || 'https://de2do.xyz',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'retain-on-failure'
	}
});
