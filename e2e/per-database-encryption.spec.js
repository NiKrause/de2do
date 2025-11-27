import { test, expect, chromium } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	getPeerId
} from './helpers.js';

/**
 * Comprehensive E2E test for per-database encryption
 * 
 * Test flow:
 * 1. Create 3 different todo lists with 3 todos each
 * 2. Third project is created with encryption enabled
 * 3. Switch between projects and verify encryption icons and todos
 * 4. Add encryption to second project (migration test)
 * 5. Open new browser contexts with URLs to test password prompts
 */
test.describe('Per-Database Encryption E2E Tests', () => {
	test.skip('should handle multiple projects with different encryption settings', async ({
		browser
	}) => {
		const timestamp = Date.now();
		
		// Project names
		const project1Name = `project-plain-${timestamp}`;
		const project2Name = `project-encrypted-later-${timestamp}`;
		const project3Name = `project-encrypted-${timestamp}`;
		
		// Passwords
		const password2 = `pass2-${timestamp}`;
		const password3 = `pass3-${timestamp}`;
		
		console.log('\n🚀 Starting per-database encryption e2e test...\n');
		console.log(`📋 Project 1 (unencrypted): ${project1Name}`);
		console.log(`📋 Project 2 (encrypted later): ${project2Name}`);
		console.log(`📋 Project 3 (encrypted): ${project3Name}`);
		console.log(`🔑 Password for Project 2: ${password2}`);
		console.log(`🔑 Password for Project 3: ${password3}`);
		
		// ============================================================================
		// STEP 1: Create 3 projects with 3 todos each
		// ============================================================================
		console.log('\n📝 STEP 1: Creating 3 projects...\n');
		
		const context1 = await browser.newContext();
		const page = await context1.newPage();
		
		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);
		
		const identityId = await page.evaluate(() => window.__currentIdentityId__);
		console.log(`✅ Identity ID: ${identityId?.slice(0, 16)}...`);
		
		// Create Project 1 (unencrypted)
		console.log(`\n📁 Creating ${project1Name} (unencrypted)...`);
		await createProjectWithTodos(page, project1Name, false, '', [
			`Task 1-1 of ${project1Name}`,
			`Task 1-2 of ${project1Name}`,
			`Task 1-3 of ${project1Name}`
		]);
		
		const project1Address = await getCurrentDatabaseAddress(page);
		console.log(`✅ Project 1 address: ${project1Address}`);
		
		// Create Project 2 (unencrypted initially)
		console.log(`\n📁 Creating ${project2Name} (initially unencrypted)...`);
		await createProjectWithTodos(page, project2Name, false, '', [
			`Task 2-1 of ${project2Name}`,
			`Task 2-2 of ${project2Name}`,
			`Task 2-3 of ${project2Name}`
		]);
		
		const project2Address = await getCurrentDatabaseAddress(page);
		console.log(`✅ Project 2 address: ${project2Address}`);
		
		// Create Project 3 (encrypted from start)
		console.log(`\n📁 Creating ${project3Name} (encrypted)...`);
		await createProjectWithTodos(page, project3Name, true, password3, [
			`Task 3-1 of ${project3Name}`,
			`Task 3-2 of ${project3Name}`,
			`Task 3-3 of ${project3Name}`
		]);
		
		const project3Address = await getCurrentDatabaseAddress(page);
		console.log(`✅ Project 3 address: ${project3Address}`);
		
		// ============================================================================
		// STEP 2: Verify encryption icons in TodoListSelector
		// ============================================================================
		console.log('\n🔍 STEP 2: Verifying encryption icons in dropdown...\n');
		
		// Open TodoListSelector dropdown
		const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
		await todoListInput.click();
		await page.waitForTimeout(500);
		
		// Check for encryption icons
		const dropdownContainer = page.locator('[role="listbox"]').first();
		
		// Project 1 should NOT have encryption icon
		const project1InDropdown = dropdownContainer.locator(`text=${project1Name}`).first();
		await expect(project1InDropdown).toBeVisible();
		const project1HasLockIcon = await dropdownContainer.locator(`text=${project1Name}`).locator('text=🔐').count();
		expect(project1HasLockIcon).toBe(0);
		console.log(`✅ Project 1 has no encryption icon (correct)`);
		
		// Project 2 should NOT have encryption icon (not encrypted yet)
		const project2InDropdown = dropdownContainer.locator(`text=${project2Name}`).first();
		await expect(project2InDropdown).toBeVisible();
		const project2HasLockIcon = await dropdownContainer.locator(`text=${project2Name}`).locator('text=🔐').count();
		expect(project2HasLockIcon).toBe(0);
		console.log(`✅ Project 2 has no encryption icon (correct, not encrypted yet)`);
		
		// Project 3 SHOULD have encryption icon
		const project3InDropdown = dropdownContainer.locator(`text=${project3Name}`).first();
		await expect(project3InDropdown).toBeVisible();
		const project3HasLockIcon = await dropdownContainer.locator(`text=${project3Name}`).locator('text=🔐').count();
		expect(project3HasLockIcon).toBeGreaterThan(0);
		console.log(`✅ Project 3 has encryption icon 🔐 (correct)`);
		
		// Close dropdown
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		
		// ============================================================================
		// STEP 3: Switch between projects and verify todos
		// ============================================================================
		console.log('\n🔄 STEP 3: Switching between projects...\n');
		
		// Switch to Project 1
		console.log(`\n→ Switching to ${project1Name}...`);
		await switchToProject(page, project1Name);
		await verifyTodosVisible(page, [
			`Task 1-1 of ${project1Name}`,
			`Task 1-2 of ${project1Name}`,
			`Task 1-3 of ${project1Name}`
		]);
		console.log(`✅ Project 1 todos verified`);
		
		// Switch to Project 2
		console.log(`\n→ Switching to ${project2Name}...`);
		await switchToProject(page, project2Name);
		await verifyTodosVisible(page, [
			`Task 2-1 of ${project2Name}`,
			`Task 2-2 of ${project2Name}`,
			`Task 2-3 of ${project2Name}`
		]);
		console.log(`✅ Project 2 todos verified`);
		
		// Switch to Project 3 (encrypted) - should use cached password
		console.log(`\n→ Switching to ${project3Name} (encrypted, cached password)...`);
		await switchToProject(page, project3Name);
		await verifyTodosVisible(page, [
			`Task 3-1 of ${project3Name}`,
			`Task 3-2 of ${project3Name}`,
			`Task 3-3 of ${project3Name}`
		]);
		console.log(`✅ Project 3 todos verified (password was cached!)`);
		
		// ============================================================================
		// STEP 4: Add encryption to Project 2 (migration test)
		// ============================================================================
		console.log('\n🔐 STEP 4: Adding encryption to Project 2...\n');
		
		// Switch to Project 2
		await switchToProject(page, project2Name);
		await page.waitForTimeout(500);
		
		// Enable encryption on Project 2
		console.log('→ Enabling encryption checkbox...');
		const encryptionCheckbox = page.locator('input[type="checkbox"]:near(:text("Enable Encryption"))').first();
		await encryptionCheckbox.check();
		await page.waitForTimeout(300);
		
		// Enter password
		console.log('→ Entering password...');
		const passwordInput = page.locator('input[type="password"][placeholder*="password" i]').first();
		await passwordInput.fill(password2);
		await page.waitForTimeout(300);
		
		// Click "Apply Encryption" button
		console.log('→ Clicking Apply Encryption...');
		const applyButton = page.locator('button:has-text("Apply Encryption")').first();
		await applyButton.click();
		
		// Wait for migration to complete
		console.log('→ Waiting for encryption migration...');
		await page.waitForTimeout(8000); // Migration takes time
		
		// Verify success toast
		await expect(page.locator('text=/migrated to encrypted/i').first()).toBeVisible({ timeout: 5000 });
		console.log('✅ Encryption migration completed');
		
		// Verify todos still visible after encryption
		await verifyTodosVisible(page, [
			`Task 2-1 of ${project2Name}`,
			`Task 2-2 of ${project2Name}`,
			`Task 2-3 of ${project2Name}`
		]);
		console.log('✅ Project 2 todos still visible after encryption');
		
		// Get new address after migration (it will be different)
		const project2AddressEncrypted = await getCurrentDatabaseAddress(page);
		console.log(`✅ Project 2 new encrypted address: ${project2AddressEncrypted}`);
		expect(project2AddressEncrypted).not.toBe(project2Address); // Address changes after migration
		
		// ============================================================================
		// STEP 5: Verify encryption icon now appears for Project 2
		// ============================================================================
		console.log('\n🔍 STEP 5: Verifying Project 2 now has encryption icon...\n');
		
		await page.waitForTimeout(1000);
		
		// Open dropdown again
		await todoListInput.click();
		await page.waitForTimeout(500);
		
		// Check Project 2 now HAS encryption icon
		const project2HasLockIconNow = await dropdownContainer.locator(`text=${project2Name}`).locator('text=🔐').count();
		expect(project2HasLockIconNow).toBeGreaterThan(0);
		console.log(`✅ Project 2 now has encryption icon 🔐 (correct)`);
		
		// Close dropdown
		await page.keyboard.press('Escape');
		
		// ============================================================================
		// STEP 6: Test password caching - switch between encrypted projects
		// ============================================================================
		console.log('\n🔄 STEP 6: Testing password caching between projects...\n');
		
		// Switch to Project 1 (unencrypted)
		console.log(`→ Switching to ${project1Name} (unencrypted)...`);
		await switchToProject(page, project1Name);
		await verifyTodosVisible(page, [`Task 1-1 of ${project1Name}`]);
		console.log('✅ Switched to Project 1');
		
		// Switch to Project 2 (encrypted) - should use cached password
		console.log(`→ Switching to ${project2Name} (encrypted, should use cached password)...`);
		await switchToProject(page, project2Name);
		await page.waitForTimeout(1000);
		await verifyTodosVisible(page, [`Task 2-1 of ${project2Name}`]);
		console.log('✅ Project 2 opened with cached password');
		
		// Switch to Project 3 (encrypted) - should use cached password
		console.log(`→ Switching to ${project3Name} (encrypted, should use cached password)...`);
		await switchToProject(page, project3Name);
		await page.waitForTimeout(1000);
		await verifyTodosVisible(page, [`Task 3-1 of ${project3Name}`]);
		console.log('✅ Project 3 opened with cached password');
		
		// ============================================================================
		// STEP 7: New browser - open Project 1 (unencrypted) via URL
		// ============================================================================
		console.log('\n🌐 STEP 7: Opening Project 1 (unencrypted) in new browser via URL...\n');
		
		const context2 = await browser.newContext();
		const page2 = await context2.newPage();
		
		await page2.goto(`/#${project1Address}`);
		await page2.waitForTimeout(6000); // Wait for DB to load
		
		// Should NOT show password modal
		const passwordModal2 = page2.locator('text=/password/i').first();
		const hasPasswordModal2 = await passwordModal2.isVisible({ timeout: 3000 }).catch(() => false);
		expect(hasPasswordModal2).toBe(false);
		console.log('✅ No password modal for unencrypted project (correct)');
		
		// Verify todos visible
		await verifyTodosVisible(page2, [`Task 1-1 of ${project1Name}`]);
		console.log('✅ Project 1 todos visible in new browser');
		
		await context2.close();
		
		// ============================================================================
		// STEP 8: New browser - open Project 2 (encrypted) via URL
		// ============================================================================
		console.log('\n🌐 STEP 8: Opening Project 2 (encrypted) in new browser via URL...\n');
		
		const context3 = await browser.newContext();
		const page3 = await context3.newPage();
		
		await page3.goto(`/#${project2AddressEncrypted}`);
		await page3.waitForTimeout(6000); // Wait for initialization
		
		// SHOULD show password modal
		console.log('→ Waiting for password modal...');
		const passwordModalHeading = page3.locator('text=/enter.*password/i').first();
		await expect(passwordModalHeading).toBeVisible({ timeout: 10000 });
		console.log('✅ Password modal appeared (correct)');
		
		// Enter password
		console.log('→ Entering password...');
		const modalPasswordInput = page3.locator('input[type="password"]').first();
		await modalPasswordInput.fill(password2);
		
		// Submit
		const submitButton = page3.locator('button:has-text("Unlock")').or(page3.locator('button:has-text("Submit")')).first();
		await submitButton.click();
		
		// Wait for database to unlock
		await page3.waitForTimeout(3000);
		
		// Verify todos visible
		await verifyTodosVisible(page3, [`Task 2-1 of ${project2Name}`]);
		console.log('✅ Project 2 unlocked and todos visible in new browser');
		
		await context3.close();
		
		// ============================================================================
		// STEP 9: New browser - open Project 3 (encrypted) via URL
		// ============================================================================
		console.log('\n🌐 STEP 9: Opening Project 3 (encrypted) in new browser via URL...\n');
		
		const context4 = await browser.newContext();
		const page4 = await context4.newPage();
		
		await page4.goto(`/#${project3Address}`);
		await page4.waitForTimeout(6000);
		
		// SHOULD show password modal
		console.log('→ Waiting for password modal...');
		const passwordModalHeading4 = page4.locator('text=/enter.*password/i').first();
		await expect(passwordModalHeading4).toBeVisible({ timeout: 10000 });
		console.log('✅ Password modal appeared (correct)');
		
		// Enter password
		console.log('→ Entering password...');
		const modalPasswordInput4 = page4.locator('input[type="password"]').first();
		await modalPasswordInput4.fill(password3);
		
		// Submit
		const submitButton4 = page4.locator('button:has-text("Unlock")').or(page4.locator('button:has-text("Submit")')).first();
		await submitButton4.click();
		
		// Wait for database to unlock
		await page4.waitForTimeout(3000);
		
		// Verify todos visible
		await verifyTodosVisible(page4, [`Task 3-1 of ${project3Name}`]);
		console.log('✅ Project 3 unlocked and todos visible in new browser');
		
		await context4.close();
		
		// ============================================================================
		// Cleanup
		// ============================================================================
		await context1.close();
		
		console.log('\n✅ ALL TESTS PASSED! 🎉\n');
	});
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a project and add todos to it
 */
async function createProjectWithTodos(page, projectName, encrypted, password, todoTexts) {
	// Open TodoListSelector
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	await page.waitForTimeout(300);
	
	// Type project name
	await todoListInput.fill(projectName);
	await page.waitForTimeout(500);
	
	// If encrypted, enable encryption first
	if (encrypted) {
		// Check encryption checkbox
		const encryptionCheckbox = page.locator('input[type="checkbox"]:near(:text("Enable Encryption"))').first();
		await encryptionCheckbox.check();
		await page.waitForTimeout(300);
		
		// Enter password
		const passwordInput = page.locator('input[type="password"][placeholder*="password" i]').first();
		await passwordInput.fill(password);
		await page.waitForTimeout(300);
	}
	
	// Click create button or press Enter
	await todoListInput.press('Enter');
	
	// Wait for project to be created
	await page.waitForTimeout(2000);
	
	console.log(`  ✓ Created project: ${projectName}${encrypted ? ' 🔐' : ''}`);
	
	// Add todos
	for (const todoText of todoTexts) {
		const todoInput = page.locator('[data-testid="todo-input"]').first();
		await todoInput.fill(todoText);
		
		const addButton = page.locator('[data-testid="add-todo-button"]').first();
		await addButton.click();
		
		// Wait for todo to appear
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 5000 });
		console.log(`  ✓ Added todo: ${todoText}`);
		
		await page.waitForTimeout(300);
	}
}

/**
 * Switch to a different project
 */
async function switchToProject(page, projectName) {
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	await page.waitForTimeout(500);
	
	// Type project name to filter
	await todoListInput.fill(projectName);
	await page.waitForTimeout(300);
	
	// Click on the project in dropdown or press Enter
	const projectButton = page.locator(`button:has-text("${projectName}")`).first();
	const isVisible = await projectButton.isVisible({ timeout: 2000 }).catch(() => false);
	
	if (isVisible) {
		await projectButton.click();
	} else {
		await todoListInput.press('Enter');
	}
	
	await page.waitForTimeout(1500);
}

/**
 * Verify that todos are visible
 */
async function verifyTodosVisible(page, todoTexts) {
	for (const todoText of todoTexts) {
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 10000 });
	}
}
