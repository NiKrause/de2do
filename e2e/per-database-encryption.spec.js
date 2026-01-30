import { test, expect, chromium } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	getPeerId
} from './helpers.js';

// Mark intentionally unused test helpers so eslint doesn't complain while this suite is skipped
void chromium;
void getPeerId;

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
	test.setTimeout(120000); // 2 minutes for this long-running flow

	/**
	 * Simple sanity test: create a single unencrypted project and verify
	 * the project appears in the dropdown and its todo is visible.
	 */
	test('basic unencrypted project dropdown visibility', async ({ page }) => {
		const timestamp = Date.now();
		const projectName = `unencrypted-project-${timestamp}`;
		const todoText = `Task 1 of ${projectName}`;

		// Initialize app
		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		// Create unencrypted project with a single todo
		await createProjectWithTodos(page, projectName, false, '', [todoText]);

		// Wait a bit before opening dropdown to ensure everything is settled
		await page.waitForTimeout(500);

		// Open TodoListSelector dropdown and verify project appears
		const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
		await todoListInput.click();
		await page.waitForTimeout(1000);

		// Wait for dropdown to contain the project
		// Simply check if we can find text matching the project name in the dropdown
		const dropdownWithProject = page.locator('[role="listbox"]', { hasText: projectName });
		await expect(dropdownWithProject).toBeVisible({ timeout: 10000 });

		// Close dropdown and click into the main todo input to ensure focus leaves the selector
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		const mainTodoInput = page.locator('[data-testid="todo-input"]');
		await mainTodoInput.click();
		await page.waitForTimeout(300);

		// First switch to the default 'projects' todo list (expected to be empty),
		// then switch to the new project and verify its todo is visible
		await switchToProject(page, 'projects');
		await switchToProject(page, projectName);
		await verifyTodosVisible(page, [todoText]);
	});

	test('should handle multiple projects with different encryption settings', async ({
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

		// Capture browser console logs to see migration progress
		const browserLogs = [];
		page.on('console', (msg) => {
			const text = msg.text();
			// Only capture relevant logs (migration, registry, encryption)
			if (
				text.includes('Migration') ||
				text.includes('registry') ||
				text.includes('encryption') ||
				text.includes('Registry') ||
				text.includes('Encryption') ||
				text.includes('switchToTodoList') ||
				text.includes('Cached password') ||
				text.includes('Using cached password') ||
				text.includes('Registry lookup') ||
				text.includes('Updating registry')
			) {
				browserLogs.push(`[Browser] ${text}`);
				console.log(`[Browser] ${text}`);
			}
		});

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

		// Wait a bit before opening dropdown to ensure all projects are registered
		await page.waitForTimeout(1000);

		// Open TodoListSelector dropdown
		const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
		await todoListInput.click();
		await page.waitForTimeout(1000); // Wait for dropdown to open and load

		// Get the listbox for more specific queries
		const listbox = page.getByRole('listbox');

		// For now, only verify that all three projects appear in the dropdown.
		// We verify encryption icons after we actually switch to each project below.

		// Project 1 should appear in the dropdown
		const project1InDropdown = listbox.getByRole('button', {
			name: project1Name,
			exact: true
		});
		await expect(project1InDropdown).toBeVisible({ timeout: 10000 });
		console.log(`✅ Project 1 appears in dropdown`);

		// Project 2 should appear in the dropdown
		const project2InDropdown = listbox.getByRole('button', {
			name: project2Name,
			exact: true
		});
		await expect(project2InDropdown).toBeVisible({ timeout: 10000 });
		console.log(`✅ Project 2 appears in dropdown`);

		// Project 3 should appear in the dropdown.
		// IMPORTANT: Encrypted entries have extra content (lock icon, maybe identity badge),
		// so we match by contained text instead of exact accessible name.
		const project3InDropdown = listbox.locator(`text=${project3Name}`);
		await expect(project3InDropdown).toBeVisible({ timeout: 10000 });
		console.log(`✅ Project 3 appears in dropdown`);

		// Close dropdown
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);

		// ============================================================================
		// STEP 3: Switch between projects and verify todos
		// ============================================================================
		console.log('\n🔄 STEP 3: Switching between projects...\n');

		// Switch to Project 1
		console.log(`\n→ Switching to ${project1Name}...`);
		await switchToProject(page, 'projects');
		await switchToProject(page, project1Name);
		await verifyTodosVisible(page, [
			`Task 1-1 of ${project1Name}`,
			`Task 1-2 of ${project1Name}`,
			`Task 1-3 of ${project1Name}`
		]);
		// After switching, verify the label does NOT show the encryption icon
		const todoListLabelAfterProject1 = page.locator('label:has-text("Todo List")');
		const project1LabelLockCount = await todoListLabelAfterProject1.locator('text=🔐').count();
		expect(project1LabelLockCount).toBe(0);
		console.log(`✅ Project 1 label has no encryption icon (correct)`);
		console.log(`✅ Project 1 todos verified`);

		// Switch to Project 2
		console.log(`\n→ Switching to ${project2Name}...`);
		await switchToProject(page, 'projects');
		await switchToProject(page, project2Name);
		await verifyTodosVisible(page, [
			`Task 2-1 of ${project2Name}`,
			`Task 2-2 of ${project2Name}`,
			`Task 2-3 of ${project2Name}`
		]);
		// After switching, verify the label does NOT show the encryption icon yet
		const todoListLabelAfterProject2 = page.locator('label:has-text("Todo List")');
		const project2LabelLockCount = await todoListLabelAfterProject2.locator('text=🔐').count();
		expect(project2LabelLockCount).toBe(0);
		console.log(`✅ Project 2 label has no encryption icon (correct, not encrypted yet)`);
		console.log(`✅ Project 2 todos verified`);

		// Switch to Project 3 (encrypted) - should use cached password
		console.log(`\n→ Switching to ${project3Name} (encrypted, cached password)...`);
		await switchToProject(page, 'projects');
		await switchToProject(page, project3Name);
		await verifyTodosVisible(page, [
			`Task 3-1 of ${project3Name}`,
			`Task 3-2 of ${project3Name}`,
			`Task 3-3 of ${project3Name}`
		]);
		// After switching, verify the label DOES show the encryption icon
		const todoListLabelAfterProject3 = page.locator('label:has-text("Todo List")');
		const project3LabelLockCount = await todoListLabelAfterProject3.locator('text=🔐').count();
		expect(project3LabelLockCount).toBeGreaterThan(0);
		console.log(`✅ Project 3 label shows encryption icon 🔐 (correct)`);
		console.log(`✅ Project 3 todos verified (password was cached!)`);

		// ============================================================================
		// STEP 4: Add encryption to Project 2 (migration test)
		// ============================================================================
		console.log('\n🔐 STEP 4: Adding encryption to Project 2...\n');

		// Switch to Project 2
		await switchToProject(page, 'projects');
		await switchToProject(page, project2Name);
		await page.waitForTimeout(500);

		// Enable encryption on Project 2
		console.log('→ Enabling encryption checkbox...');
		const encryptionCheckbox = page
			.locator('input[type="checkbox"]:near(:text("Enable Encryption"))')
			.first();
		await encryptionCheckbox.check();
		await page.waitForTimeout(300);

		// Enter password
		console.log('→ Entering password...');
		const passwordInput = page.locator('input[type="password"][placeholder*="password" i]').first();
		await passwordInput.fill(password2);
		await page.waitForTimeout(300);

		// Click "Apply Encryption" button
		// This triggers migration: creates temp DB, copies data, deletes original, recreates with encryption
		console.log('→ Clicking Apply Encryption...');
		const applyButton = page.locator('button:has-text("Apply Encryption")').first();
		await applyButton.click();

		// Wait for migration to complete
		// Migration process: copy data → delete original → recreate with same name + encryption
		console.log('→ Waiting for encryption migration...');
		console.log('  → Waiting for migration toast to appear...');

		// Clear browser logs before migration
		browserLogs.length = 0;

		// Wait for success toast to confirm migration completed
		const toastFound = await page
			.waitForSelector('text=/Successfully migrated/i', { timeout: 20000 })
			.then(() => true)
			.catch(() => false);

		if (!toastFound) {
			console.warn('⚠️ Migration success toast not found!');
			console.warn('  → Browser logs during migration:');
			browserLogs.forEach((log) => console.warn(`    ${log}`));
			console.warn('  → This might indicate migration failed or is still in progress');
		} else {
			console.log('  → Migration toast appeared, migration should be complete');
		}

		// Wait a bit more for registry update and list refresh
		await page.waitForTimeout(3000);
		console.log('  → Additional wait completed for registry sync');
		console.log('  → Recent browser logs:');
		browserLogs.slice(-10).forEach((log) => console.log(`    ${log}`));

		// Wait for todo input to be enabled again (database reopened after migration)
		// This is a readiness indicator that the database is ready and todos should be loaded
		const todoInput = page.locator('[data-testid="todo-input"]').first();
		await expect(todoInput).toBeEnabled({ timeout: 10000 });
		console.log('→ Todo input is ready after migration');

		// Verify todos still visible after encryption (data was successfully copied during migration)
		await verifyTodosVisible(page, [
			`Task 2-1 of ${project2Name}`,
			`Task 2-2 of ${project2Name}`,
			`Task 2-3 of ${project2Name}`
		]);
		console.log('✅ Project 2 todos still visible after encryption');

		// Get database address after migration
		const project2AddressEncrypted = await getCurrentDatabaseAddress(page);
		console.log(`✅ Project 2 address after migration: ${project2AddressEncrypted}`);

		// IMPORTANT: The database address should REMAIN THE SAME after encryption migration.
		// OrbitDB addresses are derived from the manifest hash, which includes:
		// - Database name (same: identityId_displayName)
		// - Database type (same: keyvalue)
		// - Access controller (same: same identity, same permissions)
		// Encryption is handled at the data/replication layer and does NOT affect the manifest.
		// Therefore, the address (which represents database identity) stays the same,
		// even though the data storage method (encrypted vs unencrypted) has changed.
		expect(project2AddressEncrypted).toBe(project2Address);
		console.log('✅ Database address unchanged (encryption is transparent to address)');

		// ============================================================================
		// STEP 5: Verify encryption icon now appears for Project 2
		// ============================================================================
		console.log('\n🔍 STEP 5: Verifying Project 2 now has encryption icon...\n');

		// After migration we are on Project 2 already. Verify the label shows the lock icon.
		const todoListLabelAfterProject2Encrypted = page.locator('label:has-text("Todo List")');
		const project2EncryptedLabelLockCount = await todoListLabelAfterProject2Encrypted
			.locator('text=🔐')
			.count();
		expect(project2EncryptedLabelLockCount).toBeGreaterThan(0);
		console.log(`✅ Project 2 label shows encryption icon 🔐 after migration (correct)`);

		// ============================================================================
		// STEP 6: Test password caching - switch between encrypted projects
		// ============================================================================
		console.log('\n🔄 STEP 6: Testing password caching between projects...\n');

		// Switch to Project 1 (unencrypted)
		console.log(`→ Switching to ${project1Name} (unencrypted)...`);
		await switchToProject(page, 'projects');
		await switchToProject(page, project1Name);
		await verifyTodosVisible(page, [`Task 1-1 of ${project1Name}`]);
		console.log('✅ Switched to Project 1');

		// Switch to Project 2 (encrypted) - should use cached password
		console.log(`→ Switching to ${project2Name} (encrypted, should use cached password)...`);
		console.log(`  → Before switch: Checking if registry entry exists for ${project2Name}...`);
		// Wait a bit more to ensure registry is fully updated
		await page.waitForTimeout(1000);
		console.log(`  → Attempting to switch to ${project2Name}...`);
		await switchToProject(page, 'projects');
		await switchToProject(page, project2Name);
		console.log(`  → Switch completed, waiting for database to open...`);
		await page.waitForTimeout(2000); // Give time for database to open and todos to load
		console.log(`  → Checking if todos are visible...`);
		await verifyTodosVisible(page, [`Task 2-1 of ${project2Name}`]);
		console.log('✅ Project 2 opened with cached password');

		// Switch to Project 3 (encrypted) - should use cached password
		console.log(`→ Switching to ${project3Name} (encrypted, should use cached password)...`);
		await switchToProject(page, 'projects');
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
		const submitButton = page3
			.locator('button:has-text("Unlock")')
			.or(page3.locator('button:has-text("Submit")'))
			.first();
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
		const submitButton4 = page4
			.locator('button:has-text("Unlock")')
			.or(page4.locator('button:has-text("Submit")'))
			.first();
		await submitButton4.click();

		// Wait for database to unlock
		await page4.waitForTimeout(3000);

		// Verify todos visible
		await verifyTodosVisible(page4, [`Task 3-1 of ${project3Name}`]);
		console.log('✅ Project 3 unlocked and todos visible in new browser');

		await context4.close();

		await context1.close();

		console.log('\n✅ STEP 1 COMPLETED: All 3 projects created successfully! 🎉\n');
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
	await page.waitForTimeout(800);

	// Clear input - use the same simple approach as encryption-migration.spec.js
	// This works because handleInputFocus() already clears the input when clicked,
	// but we need to ensure it's truly empty before typing
	const currentValue = await todoListInput.inputValue();

	// If there's still a value, clear it with Backspace
	if (currentValue && currentValue.trim() !== '') {
		// Select all and delete, or use multiple backspaces
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {}); // For Mac
		await todoListInput.press('Backspace');
		await page.waitForTimeout(200);

		// Double-check it's empty
		const stillHasValue = await todoListInput.inputValue();
		if (stillHasValue && stillHasValue.trim() !== '') {
			// Fallback: clear character by character
			for (let i = 0; i <= stillHasValue.length; i++) {
				await todoListInput.press('Backspace');
			}
			await page.waitForTimeout(200);
		}
	}

	// Now type the new project name
	await todoListInput.type(projectName, { delay: 50 });
	await page.waitForTimeout(500);

	// Verify what we're about to submit
	const valueBeforeSubmit = await todoListInput.inputValue();
	if (valueBeforeSubmit !== projectName) {
		console.warn(
			`⚠️ Input value before submit is "${valueBeforeSubmit}", expected "${projectName}"`
		);
		// Try to fix it
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {});
		await todoListInput.fill(projectName);
		await page.waitForTimeout(300);
	}

	// Click create button or press Enter
	await todoListInput.press('Enter');

	// Wait for project to be created and database to be opened
	// Give enough time for the database to be created, registered, and ready
	await page.waitForTimeout(6000); // Match encryption-migration.spec.js timing

	console.log(`  ✓ Created project: ${projectName}${encrypted ? ' 🔐' : ''}`);

	// Verify project was actually created and switched to by checking the input value
	const currentInputValue = await todoListInput.inputValue();
	if (currentInputValue !== projectName) {
		console.warn(
			`⚠️ Input value after creation is "${currentInputValue}", expected "${projectName}"`
		);
	}
	console.log(`  ✓ Project database opened: ${projectName}`);

	// If this project should be encrypted "from the start", enable encryption immediately
	// using the same UI flow as the migration step (EncryptionSettings component).
	if (encrypted) {
		console.log(`  → Enabling encryption for project ${projectName} immediately after creation...`);

		// Enable encryption checkbox
		const encryptionCheckbox = page
			.locator('input[type="checkbox"]:near(:text("Enable Encryption"))')
			.first();
		await encryptionCheckbox.check();
		await page.waitForTimeout(300);

		// Enter password
		const passwordInput = page.locator('input[type="password"][placeholder*="password" i]').first();
		await passwordInput.fill(password);
		await page.waitForTimeout(300);

		// Click "Apply Encryption" button
		const applyButton = page.locator('button:has-text("Apply Encryption")').first();
		await applyButton.click();

		// Wait for migration to complete
		await page.waitForTimeout(5000); // was 8000

		// Best-effort: verify success toast, but don't fail the helper if it races
		const successToast = page.locator('text=/migrated to encrypted/i').first();
		try {
			await expect(successToast).toBeVisible({ timeout: 5000 });
			console.log(`  ✓ Encryption enabled for project ${projectName}`);
		} catch {
			console.warn(
				`⚠️ Encryption success toast not detected for project ${projectName}, continuing test flow`
			);
		}
	}

	// Wait for todo input to be enabled before adding todos
	const todoInput = page.locator('[data-testid="todo-input"]').first();
	await expect(todoInput).toBeEnabled({ timeout: 10000 });
	console.log(`  ✓ Todo input is enabled and ready`);

	// Add todos
	for (const todoText of todoTexts) {
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

	// Prefer selecting the project directly from the dropdown rather than typing into the input.
	const listbox = page.getByRole('listbox');
	// Use a text-based locator so this works for encrypted entries (which include 🔐 and
	// possibly identity badges in the accessible name).
	const projectButton = listbox.locator(`text=${projectName}`).first();

	const isVisible = await projectButton.isVisible({ timeout: 3000 }).catch(() => false);

	if (isVisible) {
		await projectButton.click();
	} else {
		// Fallback: filter by typing the project name and pressing Enter
		// IMPORTANT: Clear the input properly before typing to avoid appending to existing value
		// The reactive statement might have restored the input value after focus
		const currentValue = await todoListInput.inputValue();
		if (currentValue && currentValue.trim() !== '') {
			// Clear it more reliably
			await todoListInput.press('Control+A').catch(() => {});
			await todoListInput.press('Meta+A').catch(() => {});
			await todoListInput.fill(''); // Directly clear
			await page.waitForTimeout(200);

			// Double-check it's empty
			const stillHasValue = await todoListInput.inputValue();
			if (stillHasValue && stillHasValue.trim() !== '') {
				// Fallback: clear character by character
				for (let i = 0; i <= stillHasValue.length; i++) {
					await todoListInput.press('Backspace');
				}
				await page.waitForTimeout(200);
			}
		}

		await todoListInput.type(projectName);
		await page.waitForTimeout(300);
		await todoListInput.press('Enter');
	}

	await page.waitForTimeout(1500);

	// After switching, click into the main todo input (if available) so focus leaves
	// the TodoListSelector before the next project switch. This better matches how
	// a user would work (select project, then work in the main input).
	const mainTodoInput = page.locator('[data-testid="todo-input"]').first();
	const hasMainTodoInput = await mainTodoInput.count();
	if (hasMainTodoInput > 0) {
		await mainTodoInput.click();
		await page.waitForTimeout(300);
	}
}

/**
 * Verify that todos are visible
 */
async function verifyTodosVisible(page, todoTexts) {
	for (const todoText of todoTexts) {
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 10000 });
	}
}

// Mark helper functions as used for eslint while parts of the test flow are commented out
void switchToProject;
void verifyTodosVisible;
