import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	waitForTodoText
} from './helpers.js';

/**
 * Test case for the encryption detection bug when opening unencrypted databases via URL.
 *
 * Issue: When a new browser context opens an unencrypted database via URL, the database
 * appears empty initially (before sync completes). The encryption detection logic
 * incorrectly assumes it's encrypted because:
 * - entries.length === 0 (not synced yet)
 * - isRemoteAccess === true (opened via URL)
 *
 * This causes a password modal to appear for unencrypted databases.
 *
 * Expected behavior: Wait for sync before determining encryption status, or check
 * if we can read entries without encryption first.
 */
test('should not show password modal for unencrypted database opened via URL', async ({
	browser
}) => {
	const timestamp = Date.now();
	const projectName = `unencrypted-url-test-${timestamp}`;

	console.log('\n🚀 Starting unencrypted database URL access test...\n');

	// ============================================================================
	// STEP 1: Create unencrypted database in first browser
	// ============================================================================
	console.log('📝 STEP 1: Creating unencrypted database in first browser...\n');

	const context1 = await browser.newContext();
	const page1 = await context1.newPage();

	await page1.goto('/');
	await acceptConsentAndInitialize(page1);
	await waitForP2PInitialization(page1);

	// Create unencrypted project with todos
	const todoListInput1 = page1.locator('input[placeholder*="todo list" i]').first();
	await todoListInput1.click();
	await page1.waitForTimeout(800);

	// Clear and type project name
	const currentValue = await todoListInput1.inputValue();
	for (let i = 0; i <= currentValue.length; i++) {
		await todoListInput1.press('Backspace');
	}
	await page1.waitForTimeout(300);
	await todoListInput1.type(projectName, { delay: 50 });
	await page1.waitForTimeout(500);
	await todoListInput1.press('Enter');
	await page1.waitForTimeout(6000);

	console.log(`  ✓ Created project: ${projectName}`);

	// Get database address
	const dbAddress = await getCurrentDatabaseAddress(page1);
	console.log(`  ✓ Database address: ${dbAddress}`);

	// Add a todo to ensure database has content
	const todoInput1 = page1.locator('[data-testid="todo-input"]').first();
	await expect(todoInput1).toBeEnabled({ timeout: 10000 });

	const todoText = `Test todo for ${projectName}`;
	await todoInput1.fill(todoText);
	const addButton1 = page1.locator('[data-testid="add-todo-button"]').first();
	await addButton1.click();
	await expect(page1.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 5000 });
	console.log(`  ✓ Added todo: ${todoText}`);

	// Wait a bit for the entry to be synced
	await page1.waitForTimeout(2000);

	console.log('\n✅ STEP 1 COMPLETED: Unencrypted database created with content\n');

	// ============================================================================
	// STEP 2: Open same database in new browser context via URL
	// ============================================================================
	console.log('🌐 STEP 2: Opening database in new browser context via URL...\n');

	const context2 = await browser.newContext();
	const page2 = await context2.newPage();

	// Navigate directly to the database address
	// This simulates opening a shared link in a new browser
	console.log(`  → Navigating to: /#${dbAddress}`);
	await page2.goto(`/#${dbAddress}`);

	// Wait for initialization and potential sync
	// The issue: database appears empty initially, encryption detection assumes encrypted
	console.log('  → Waiting for database to load and sync...');
	await page2.waitForTimeout(6000); // Give time for sync

	// ============================================================================
	// STEP 3: Verify NO password modal appears
	// ============================================================================
	console.log('\n🔍 STEP 3: Verifying no password modal appears...\n');

	// Check for password modal - should NOT appear for unencrypted database
	const passwordModal = page2.locator('text=/password/i').first();
	const hasPasswordModal = await passwordModal.isVisible({ timeout: 3000 }).catch(() => false);

	if (hasPasswordModal) {
		console.error('  ❌ BUG: Password modal appeared for unencrypted database!');
		console.error('  → This happens because:');
		console.error('    1. Database opened without encryption (correct)');
		console.error('    2. Database appears empty (not synced yet)');
		console.error('    3. Encryption detection sees empty + remote access → assumes encrypted');
		console.error('    4. Password modal incorrectly shown');
	} else {
		console.log('  ✓ No password modal (correct)');
	}

	expect(hasPasswordModal).toBe(false);
	console.log('  ✅ Password modal check passed');

	// ============================================================================
	// STEP 4: Verify todos are visible (after sync)
	// ============================================================================
	console.log('\n🔍 STEP 4: Verifying todos are visible after sync...\n');

	// Wait for replicated data (sync can be slower in CI)
	await waitForTodoText(page2, todoText, 60000, { browserName: test.info().project.name });
	console.log(`  ✓ Todo visible: ${todoText}`);
	console.log('  ✅ Database content accessible without password (correct)');

	// ============================================================================
	// STEP 5: Verify encryption icon is NOT shown
	// ============================================================================
	console.log('\n🔍 STEP 5: Verifying encryption icon is not shown...\n');

	const todoListLabel = page2.locator('label:has-text("Todo List")');
	const lockIconCount = await todoListLabel.locator('text=🔐').count();
	expect(lockIconCount).toBe(0);
	console.log('  ✓ No encryption icon shown (correct)');

	// Cleanup
	await context1.close();
	await context2.close();

	console.log('\n✅ TEST COMPLETED: Unencrypted database correctly opened via URL\n');
});
