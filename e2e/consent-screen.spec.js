import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }, testInfo) => {
	const status = testInfo.status === 'passed' ? 'passed' : 'failed';
	const reason =
		testInfo.status === 'passed'
			? 'Test completed successfully'
			: testInfo.error?.message || 'Test failed';

	await page.evaluate(
		({ status, reason }) => {
			window.browserstack_executor = {
				action: 'setSessionStatus',
				arguments: { status, reason }
			};
		},
		{ status, reason }
	);
});

test.describe('Consent Screen', () => {
	test('should show consent controls and proceed on accept', async ({ page }) => {
		const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
		await page.goto(testUrl);

		if (process.env.BROWSERSTACK_BUILD_NAME) {
			await page.evaluate(() => localStorage.clear());
			await page.reload();
		}

		const modal = page.getByTestId('consent-modal');
		await expect(modal).toBeVisible();

		const storageToggle = page.getByTestId('consent-storage-toggle');
		const networkToggle = page.getByTestId('consent-network-toggle');
		const peerCheckbox = page.getByTestId('consent-peer-checkbox');
		const rememberCheckbox = page.getByTestId('consent-remember-checkbox');
		const acceptButton = page.getByTestId('consent-accept-button');

		await expect(storageToggle).toBeVisible();
		await expect(networkToggle).toBeVisible();
		await expect(peerCheckbox).toBeVisible();
		await expect(rememberCheckbox).toBeVisible();
		await expect(acceptButton).toBeVisible();
		await expect(acceptButton).toBeEnabled();

		await acceptButton.click();
		await expect(modal).not.toBeVisible();
	});

	test('should remember consent decision when checkbox is checked', async ({ page }) => {
		const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
		await page.goto(testUrl);

		if (process.env.BROWSERSTACK_BUILD_NAME) {
			await page.evaluate(() => localStorage.clear());
			await page.reload();
		}

		const modal = page.getByTestId('consent-modal');
		await expect(modal).toBeVisible();

		await page.getByTestId('consent-remember-checkbox').check();
		await page.getByTestId('consent-accept-button').click();
		await expect(modal).not.toBeVisible();

		await page.reload();
		await expect(page.getByTestId('consent-modal')).not.toBeVisible({ timeout: 5000 });

		await page.evaluate(() => localStorage.clear());
	});

	test('should disable network and keep peer count at zero', async ({ page }) => {
		const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
		await page.goto(testUrl);

		if (process.env.BROWSERSTACK_BUILD_NAME) {
			await page.evaluate(() => localStorage.clear());
			await page.reload();
		}

		const modal = page.getByTestId('consent-modal');
		await expect(modal).toBeVisible();

		await page.getByTestId('consent-network-toggle').click();
		await page.getByTestId('consent-accept-button').click();
		await expect(modal).not.toBeVisible();

		await page.waitForFunction(
			() => typeof window.__lastConsentPreferences__ !== 'undefined',
			null,
			{ timeout: 30000 }
		);

		// Give the app a moment to attempt initialization
		await page.waitForTimeout(3000);

		const preferences = await page.evaluate(() => window.__lastConsentPreferences__);
		expect(preferences?.enableNetworkConnection).toBe(false);

		const hasLibp2p = await page.evaluate(() => typeof window.__libp2p__ !== 'undefined');
		expect(hasLibp2p).toBe(false);
	});
});
