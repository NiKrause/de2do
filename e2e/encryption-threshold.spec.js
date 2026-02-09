import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress
} from './helpers.js';

test('should migrate unencrypted database to threshold encryption', async ({ page }) => {
	const timestamp = Date.now();
	const projectName = `threshold-migration-${timestamp}`;
	const sessionSecret = `threshold-session-${timestamp}`;
	const initialTodo = `Initial todo ${timestamp}`;
	const migratedTodo = `Post-migration todo ${timestamp}`;

	await page.goto('/');
	await acceptConsentAndInitialize(page);
	await waitForP2PInitialization(page);

	// Create a new unencrypted list.
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	const currentValue = await todoListInput.inputValue();
	for (let i = 0; i <= currentValue.length; i++) {
		await todoListInput.press('Backspace');
	}
	await todoListInput.type(projectName, { delay: 40 });
	await todoListInput.press('Enter');
	await page.waitForTimeout(5000);

	const originalAddress = await getCurrentDatabaseAddress(page);

	// Add one todo before migration.
	const todoInput = page.locator('[data-testid="todo-input"]').first();
	await expect(todoInput).toBeEnabled({ timeout: 10000 });
	await todoInput.fill(initialTodo);
	await page.locator('[data-testid="add-todo-button"]').first().click();
	await expect(page.locator(`text=${initialTodo}`).first()).toBeVisible({ timeout: 5000 });

	// Open encryption controls.
	const encryptionCheckbox = page
		.locator('input[type="checkbox"]:near(:text("Enable Encryption"))')
		.first();
	await encryptionCheckbox.check();
	await page.waitForTimeout(400);

	// Skip when the threshold feature flag is not enabled in this build.
	const thresholdMode = page.locator('label:has-text("Threshold (session)")').first();
	const thresholdModeVisible = await thresholdMode.isVisible().catch(() => false);
	test.skip(
		!thresholdModeVisible,
		'Threshold encryption UI is disabled. Enable VITE_ENABLE_THRESHOLD_ENCRYPTION=true for this test.'
	);

	await thresholdMode.click();

	// Provide fallback session secret for threshold config.
	const passwordInput = page.locator('input#encryption-password').first();
	await passwordInput.fill(sessionSecret);

	// Apply threshold migration.
	const applyButton = page.locator('button:has-text("Apply Threshold Encryption")').first();
	await applyButton.click();
	await page.waitForTimeout(9000);

	// Data remains readable after migration.
	await expect(todoInput).toBeEnabled({ timeout: 10000 });
	await expect(page.locator(`text=${initialTodo}`).first()).toBeVisible({ timeout: 10000 });

	const newAddress = await getCurrentDatabaseAddress(page);
	expect(newAddress).not.toBe(originalAddress);

	const todoListLabel = page.locator('label:has-text("Todo List")');
	await expect(todoListLabel.locator('text=🔐')).toHaveCount(1);

	// Verify registry metadata marks threshold encryption.
	const registryMetadata = await page.evaluate((displayName) => {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith('todoListRegistry_')) continue;
			const parsed = JSON.parse(localStorage.getItem(key) || '{}');
			if (parsed && parsed[displayName]) {
				return parsed[displayName];
			}
		}
		return null;
	}, projectName);

	expect(registryMetadata).toBeTruthy();
	expect(registryMetadata.encryptionEnabled).toBe(true);
	expect(registryMetadata.encryptionMethod).toBe('threshold-v1');

	// Verify new writes also work post-migration.
	await todoInput.fill(migratedTodo);
	await page.locator('[data-testid="add-todo-button"]').first().click();
	await expect(page.locator(`text=${migratedTodo}`).first()).toBeVisible({ timeout: 5000 });
});
