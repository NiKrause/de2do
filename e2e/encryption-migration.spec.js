import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress
} from './helpers.js';

/**
 * Test for migrating an unencrypted database to encrypted.
 *
 * Key behaviors verified:
 * - All existing todos are preserved during migration
 * - Database address changes to a new encrypted address
 * - Encryption icon appears in UI after migration
 * - New todos can be added to encrypted database
 */
test('should migrate unencrypted database to encrypted', async ({ page }) => {
	const timestamp = Date.now();
	const projectName = `migration-test-${timestamp}`;
	const password = `test-password-${timestamp}`;

	console.log('\n🚀 Starting encryption migration test...\n');

	// Initialize app
	await page.goto('/');
	await acceptConsentAndInitialize(page);
	await waitForP2PInitialization(page);

	// ============================================================================
	// STEP 1: Create unencrypted project with todos
	// ============================================================================
	console.log('📝 STEP 1: Creating unencrypted project...\n');

	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	await page.waitForTimeout(800);

	// Clear input
	const currentValue = await todoListInput.inputValue();
	for (let i = 0; i <= currentValue.length; i++) {
		await todoListInput.press('Backspace');
	}
	await page.waitForTimeout(300);

	// Type project name
	await todoListInput.type(projectName, { delay: 50 });
	await page.waitForTimeout(500);

	// Create project (unencrypted)
	await todoListInput.press('Enter');
	await page.waitForTimeout(6000);

	console.log(`  ✓ Created project: ${projectName}`);

	// Get original database address before migration
	const originalAddress = await getCurrentDatabaseAddress(page);
	console.log(`  ✓ Original address: ${originalAddress}`);

	// Wait for todo input to be enabled
	const todoInput = page.locator('[data-testid="todo-input"]').first();
	await expect(todoInput).toBeEnabled({ timeout: 10000 });
	console.log('  ✓ Todo input is ready');

	// Add test todos that will be migrated
	const todos = [
		`Todo 1 of ${projectName}`,
		`Todo 2 of ${projectName}`,
		`Todo 3 of ${projectName}`
	];

	for (const todoText of todos) {
		await todoInput.fill(todoText);
		const addButton = page.locator('[data-testid="add-todo-button"]').first();
		await addButton.click();
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 5000 });
		console.log(`  ✓ Added todo: ${todoText}`);
		await page.waitForTimeout(300);
	}

	console.log('\n✅ STEP 1 COMPLETED: Unencrypted project created with todos\n');

	// ============================================================================
	// STEP 2: Migrate to encrypted
	// ============================================================================
	console.log('🔐 STEP 2: Migrating to encrypted...\n');

	// Enable encryption checkbox
	console.log('  → Enabling encryption checkbox...');
	const encryptionCheckbox = page
		.locator('input[type="checkbox"]:near(:text("Enable Encryption"))')
		.first();
	await encryptionCheckbox.check();
	await page.waitForTimeout(500);

	// Enter password
	console.log('  → Entering password...');
	const passwordInput = page.locator('input[type="password"][placeholder*="password" i]').first();
	await passwordInput.fill(password);
	await page.waitForTimeout(500);

	// Click "Apply Encryption" button
	// This triggers migration to a new encrypted database address and copies data
	console.log('  → Clicking Apply Encryption...');
	const applyButton = page.locator('button:has-text("Apply Encryption")').first();
	await applyButton.click();

	// Wait for migration to complete
	// Migration process: copy data into new encrypted database and switch registry pointer
	console.log('  → Waiting for encryption migration...');
	await page.waitForTimeout(8000); // Migration takes time

	console.log('\n✅ STEP 2 COMPLETED: Encryption migration completed\n');

	// ============================================================================
	// STEP 3: Verify todos are still visible after migration
	// ============================================================================
	console.log('🔍 STEP 3: Verifying todos after migration...\n');

	// Wait for todo input to be enabled again (database reopened after migration)
	await expect(todoInput).toBeEnabled({ timeout: 10000 });
	console.log('  ✓ Todo input is ready after migration');

	// Verify all todos are still visible (data was successfully copied during migration)
	for (const todoText of todos) {
		console.log(`  → Checking: ${todoText}`);
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 10000 });
		console.log(`  ✓ Found: ${todoText}`);
	}

	console.log('\n✅ STEP 3 COMPLETED: All todos visible after migration\n');

	// ============================================================================
	// STEP 4: Verify database address and encryption status
	// ============================================================================
	console.log('🔍 STEP 4: Verifying encryption status and database address...\n');

	// Get database address after migration
	const newAddress = await getCurrentDatabaseAddress(page);
	console.log(`  ✓ Address after migration: ${newAddress}`);

	// Migration now keeps a NEW encrypted database address on purpose.
	// This avoids reusing a previously unencrypted address that may already be pinned elsewhere.
	expect(newAddress).not.toBe(originalAddress);
	console.log('  ✓ Database address changed (new encrypted database address retained)');

	// Verify encryption icon appears in label (UI indicator that encryption is active)
	const todoListLabel = page.locator('label:has-text("Todo List")');
	const lockIconCount = await todoListLabel.locator('text=🔐').count();
	expect(lockIconCount).toBeGreaterThan(0);
	console.log('  ✓ Encryption icon 🔐 now visible in UI');

	console.log('\n✅ STEP 4 COMPLETED: Encryption status verified\n');

	// ============================================================================
	// STEP 5: Add a new todo to encrypted database
	// ============================================================================
	console.log('📝 STEP 5: Adding new todo to encrypted database...\n');

	// Verify we can add new todos to the encrypted database
	const newTodoText = `New todo after encryption - ${projectName}`;
	await todoInput.fill(newTodoText);
	const addButton = page.locator('[data-testid="add-todo-button"]').first();
	await addButton.click();
	await expect(page.locator(`text=${newTodoText}`).first()).toBeVisible({ timeout: 5000 });
	console.log(`  ✓ Added new todo: ${newTodoText}`);

	console.log('\n✅ STEP 5 COMPLETED: New todo added to encrypted database\n');

	console.log('🎉 ENCRYPTION MIGRATION TEST COMPLETED SUCCESSFULLY! 🎉\n');
});
