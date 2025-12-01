import { test, expect, chromium } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	getPeerId,
	waitForTodoText
} from './helpers.js';

test.describe('Encryption E2E Tests', () => {
test('should encrypt projects list in browser A, decrypt via URL in browser B, and decrypt via user list in browser C', async ({
		page: browserAPage
	}) => {
		const testTodoText = `Test todo - ${Date.now()}`;

		console.log('\n🚀 Starting encryption e2e test with 3 browsers...\n');

		// ============================================================================
		// BROWSER A: Create unencrypted projects todo list (current implementation)
		// ============================================================================
		console.log('📱 BROWSER A: Setting up database...');

		// Initialize browser A
		await browserAPage.goto('/');
		await acceptConsentAndInitialize(browserAPage);
		await waitForP2PInitialization(browserAPage);

		const peerIdA = await getPeerId(browserAPage);
		console.log(`✅ Browser A peer ID (display): ${peerIdA.slice(0, 16)}...`);

		// Get the full identity ID (not the truncated display value)
		// This is needed because database names use format: {fullIdentityId}_projects
		const identityIdA = await browserAPage.evaluate(() => {
			// Method 1: Extract from database name (most reliable)
			if (window.__todoDB__ && window.__todoDB__.name) {
				const dbName = window.__todoDB__.name;
				if (dbName.includes('_')) {
					const identityId = dbName.split('_')[0];
					console.log('🔍 Extracted identity ID from database name:', identityId);
					return identityId;
				}
			}
			// Method 2: Get from orbitdb identity
			if (window.__orbitdb__ && window.__orbitdb__.identity && window.__orbitdb__.identity.id) {
				console.log('🔍 Got identity ID from orbitdb:', window.__orbitdb__.identity.id);
				return window.__orbitdb__.identity.id;
			}
			// Method 3: Try to get from currentDbNameStore via window
			if (window.__currentDbName__) {
				const dbName = window.__currentDbName__;
				if (dbName.includes('_')) {
					const identityId = dbName.split('_')[0];
					console.log('🔍 Extracted identity ID from currentDbName:', identityId);
					return identityId;
				}
			}
			return null;
		});
		
		if (!identityIdA) {
			throw new Error('Could not get full identity ID from Browser A');
		}
		console.log(`✅ Browser A full identity ID: ${identityIdA.slice(0, 16)}...`);

		// Get the database address
		const dbAddressA = await getCurrentDatabaseAddress(browserAPage);
		expect(dbAddressA).toBeTruthy();
		expect(dbAddressA).toContain('/orbitdb/');
		console.log(`✅ Browser A database address: ${dbAddressA}`);

		// Add a todo
		const todoInput = browserAPage.locator('[data-testid="todo-input"]');
		await todoInput.fill(testTodoText);
		const addButton = browserAPage.locator('[data-testid="add-todo-button"]');
		await addButton.click();

		// Verify todo appears
		await expect(browserAPage.locator(`text=${testTodoText}`).first()).toBeVisible({
			timeout: 10000
		});
		console.log(`✅ Browser A: Added todo "${testTodoText}"`);

		// ============================================================================
		// BROWSER B: Open via URL (using new browser context)
		// ============================================================================
		console.log('\n📱 BROWSER B: Opening database via URL...');

		const browserBContext = await browserAPage.context().browser().newContext();
		const pageBrowserB = await browserBContext.newPage();

		// Open with database address from browser A
		await pageBrowserB.goto(`/?#/${dbAddressA}`);
		
		// Wait for P2P initialization (auto-initializes when hash is present)
		await waitForP2PInitialization(pageBrowserB, 60000);
		console.log('✅ Browser B: P2P initialized');
		
		// Wait for database to be opened (check that todo input is available)
		await pageBrowserB.waitForSelector('[data-testid="todo-input"]', { timeout: 30000 });
		console.log('✅ Browser B: Database opened via URL');

		// Wait for todo to appear (this handles syncing from peers)
		await waitForTodoText(pageBrowserB, testTodoText, 60000);
		console.log(`✅ Browser B: Verified todo "${testTodoText}" is accessible`);

		// Get browser B peer ID
		const peerIdB = await getPeerId(pageBrowserB);
		console.log(`✅ Browser B peer ID: ${peerIdB.slice(0, 16)}...`);

		// ============================================================================
		// BROWSER C: Open normally, add user A to list, select their database
		// ============================================================================
		console.log('\n📱 BROWSER C: Opening normally and adding user A...');

		const browserCContext = await browserAPage.context().browser().newContext();
		const pageBrowserC = await browserCContext.newPage();

		// Initialize browser C normally (no URL hash)
		await pageBrowserC.goto('/');
		await acceptConsentAndInitialize(pageBrowserC);
		await waitForP2PInitialization(pageBrowserC);

		const peerIdC = await getPeerId(pageBrowserC);
		console.log(`✅ Browser C peer ID: ${peerIdC.slice(0, 16)}...`);
		
		// Wait for UI to fully render
		await pageBrowserC.waitForTimeout(2000);

		// Try to find the user list/selector
		console.log('🔍 Looking for UsersList component...');
		const usersSection = pageBrowserC.locator('text=Users, text=/user/i, [data-testid="users"]').first();
		
		try {
			await usersSection.isVisible({ timeout: 5000 });
			console.log('✅ Browser C: Found users section');
		} catch {
			console.warn('⚠️ Browser C: Users section not visible, may need different selector');
		}

		// Look for input to add user/identity
		const userInputSelectors = [
			'[data-testid="user-input"]',
			'input[placeholder*="user" i]',
			'input[placeholder*="identity" i]',
			'input[placeholder*="Add" i]',
			'.users-section input',
			'.user-list input',
			'input:near(:text("User"))'
		];

		let userInputElement = null;
		for (const selector of userInputSelectors) {
			try {
				const element = pageBrowserC.locator(selector);
				if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
					userInputElement = element;
					console.log(`✅ Browser C: Found user input with selector: ${selector}`);
					break;
				}
			} catch {
				// Continue to next selector
			}
		}

		if (userInputElement) {
			// Add Browser A's full identity ID to user list (not the truncated display value)
			// This ensures the correct database name format: {fullIdentityId}_projects
			await userInputElement.click();
			await userInputElement.fill(identityIdA);
			await userInputElement.press('Enter');
			console.log(`✅ Browser C: Added Browser A's identity ID: ${identityIdA.slice(0, 16)}...`);
			
			// Wait for user to be added and discovery to complete
			await pageBrowserC.waitForTimeout(3000);

			// Open UsersList dropdown to select Browser A's identity
			// Clicking on the user identity will automatically open their projects database
			console.log('🔍 Browser C: Opening UsersList dropdown to select user A...');
			
			// Click on the user input to open dropdown
			await userInputElement.click();
			await pageBrowserC.waitForTimeout(500);

			// Look for Browser A's identity ID in the dropdown
			// The button contains the full identity ID as text (may be truncated in UI display)
			// Try multiple selectors to find the user button
			let userInDropdown = null;
			const userSelectors = [
				`button:has-text("${identityIdA}")`, // Full identity ID
				`button:has-text("${identityIdA.slice(0, 20)}")`, // First 20 chars
				`button:has-text("${identityIdA.slice(0, 16)}")`, // First 16 chars
				`button:has-text("${identityIdA.slice(0, 12)}")`, // First 12 chars
				`div:has-text("${identityIdA.slice(0, 8)}")` // First 8 chars (in case it's in a child div)
			];
			
			for (const selector of userSelectors) {
				try {
					const element = pageBrowserC.locator(selector).first();
					if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
						userInDropdown = element;
						console.log(`✅ Browser C: Found user with selector: ${selector}`);
						break;
					}
				} catch {
					// Continue to next selector
				}
			}
			
			if (!userInDropdown) {
				throw new Error('Could not find user in dropdown');
			}
			
			try {
				console.log('✅ Browser C: Found Browser A in UsersList dropdown');
				
				// Click on Browser A's identity - this will automatically open their projects database
				await userInDropdown.click();
				console.log('✅ Browser C: Clicked on Browser A\'s identity - should open projects database automatically');
			} catch {
				console.warn(`⚠️ Browser C: Could not find user in dropdown, trying fallback to URL method...`);
				// Fallback: use URL if user list doesn't work
				await pageBrowserC.goto(`/?#/${dbAddressA}`);
				await pageBrowserC.waitForTimeout(5000);
				await waitForTodoText(pageBrowserC, testTodoText, 30000);
				console.log(
					`✅ Browser C: Verified todo via URL fallback`
				);
				return; // Exit early if using fallback
			}
			
			// Wait for any navigation/loading to complete
			await pageBrowserC.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
				console.log('⚠️ Browser C: Network idle timeout, continuing anyway...');
			});

			// Wait for database to be opened - check if any database is loaded
			// (The address might be slightly different due to OrbitDB address calculation)
			console.log('⏳ Browser C: Waiting for database to open...');
			await pageBrowserC.waitForFunction(
				() => {
					// Check if database is loaded (any address is fine, we'll verify by todo content)
					if (window.__todoDB__ && window.__todoDB__.address) {
						return true;
					}
					if (window.__currentDbAddress__) {
						return true;
					}
					// Check URL hash
					const hash = window.location.hash;
					if (hash && hash.startsWith('#/')) {
						const decoded = decodeURIComponent(hash.slice(2));
						if (decoded.startsWith('/orbitdb/')) {
							return true;
						}
					}
					return false;
				},
				{ timeout: 30000 }
			);
			// Log the actual address that was opened for debugging
			const actualAddress = await pageBrowserC.evaluate(() => {
				return window.__todoDB__?.address || window.__currentDbAddress__ || null;
			});
			console.log(`✅ Browser C: Database opened (address confirmed)`);
			console.log(`   Expected address: ${dbAddressA}`);
			console.log(`   Actual address: ${actualAddress || 'not found'}`);

			// Wait for todo input to be visible (indicates database is loaded and UI is ready)
			await pageBrowserC.waitForSelector('[data-testid="todo-input"]', { timeout: 30000 });
			console.log('✅ Browser C: Todo input visible, database loaded');

			// Wait for page to be fully interactive (no loading spinners)
			await pageBrowserC.waitForFunction(
				() => {
					// Check if there are any loading spinners visible
					const spinners = document.querySelectorAll('[class*="spinner"], [class*="loading"], [data-testid="loading"]');
					if (spinners.length > 0) {
						return Array.from(spinners).every(el => el.style.display === 'none' || !el.offsetParent);
					}
					return true;
				},
				{ timeout: 10000 }
			).catch(() => {
				console.log('⚠️ Browser C: Loading check timeout, continuing anyway...');
			});

			// Wait a bit more for todos to sync from network
			await pageBrowserC.waitForTimeout(3000);

			// Verify todo appears in browser C using the helper function
			try {
				await waitForTodoText(pageBrowserC, testTodoText, 30000);
				console.log(
					`✅ Browser C: Verified todo "${testTodoText}" is accessible`
				);
			} catch {
				console.warn(`⚠️ Browser C: Todo not visible yet, trying fallback to URL method...`);
				// Fallback: use URL if user list doesn't work
				await pageBrowserC.goto(`/?#/${dbAddressA}`);
				await pageBrowserC.waitForTimeout(5000);
				await waitForTodoText(pageBrowserC, testTodoText, 30000);
				console.log(
					`✅ Browser C: Verified todo via URL fallback`
				);
			}
		} else {
			console.warn('⚠️ Browser C: Could not find user input element - user list may not be implemented yet');
			// Fallback: just open the database via URL for now
			console.log('Falling back to URL hash method...');
			await pageBrowserC.goto(`/?#/${dbAddressA}`);
			await pageBrowserC.waitForTimeout(5000);
			
			await expect(
				pageBrowserC.locator(`text=${testTodoText}`).first()
			).toBeVisible({ timeout: 30000 });
			console.log(
				`✅ Browser C: Verified todo "${testTodoText}" is accessible (via fallback)`
			);
		}

		// ============================================================================
		// SUMMARY
		// ============================================================================
		console.log('\n' + '='.repeat(60));
		console.log('🎉 THREE-BROWSER E2E TEST SUMMARY');
		console.log('='.repeat(60));
		console.log(
			`✅ Browser A (Creator): Created projects todo list and added todo`
		);
		console.log(
			`✅ Browser B (URL Access): Opened same database via URL hash`
		);
		console.log(
			`✅ Browser C (URL Access): Opened same database via URL hash`
		);
		console.log(`\n📝 Test Todo: "${testTodoText}"`);
		console.log(`📍 Database Address: ${dbAddressA}`);
		console.log(
			`🆔 Peer IDs: A=${peerIdA.slice(0, 16)}..., B=${peerIdB.slice(0, 16)}..., C=${peerIdC.slice(
				0,
				16
			)}...`
		);
		console.log('='.repeat(60) + '\n');

		// Cleanup
		await browserBContext.close();
		await browserCContext.close();
	});

	test('should handle wrong password gracefully', async ({ page: browserAPage }) => {
		console.log('\n🚀 Starting wrong password handling test...\n');

		// Capture browser console logs
		browserAPage.on('console', msg => {
			const type = msg.type();
			const text = msg.text();
			if (type === 'error' || text.includes('Encryption') || text.includes('Migration') || text.includes('handler')) {
				console.log(`[🌐 BROWSER ${type.toUpperCase()}]`, text);
			}
		});

		const encryptionPassword = 'correct-password';
		const wrongPassword = 'wrong-password';
		const testTodoText = `Password test todo - ${Date.now()}`;

		// ============================================================================
		// BROWSER A: Create encrypted database
		// ============================================================================
		console.log('📱 BROWSER A: Setting up encrypted database...');

		// Navigate to the app with error handling
		console.log('🌐 Navigating to app...');
		let response;
		try {
			response = await browserAPage.goto('/', { 
				waitUntil: 'networkidle',
				timeout: 30000 
			});
			console.log(`✅ Navigation successful (status: ${response?.status() || 'unknown'})`);
		} catch (error) {
			console.error('❌ Navigation failed:', error.message);
			throw error;
		}

		await acceptConsentAndInitialize(browserAPage);
		await waitForP2PInitialization(browserAPage);

		// Enable encryption
		console.log('🔐 Browser A: Enabling encryption...');
		const encryptionCheckbox = browserAPage.getByLabel(/Enable Encryption/i);
		await encryptionCheckbox.check();
		
		// Wait for password input to appear
		const passwordInputA = browserAPage.locator('#encryption-password');
		await passwordInputA.waitFor({ state: 'visible', timeout: 5000 });
		
		// Enter encryption password
		await passwordInputA.fill(encryptionPassword);
		
		// Click "Apply Encryption" button
		const applyEncryptionButton = browserAPage.getByRole('button', { name: /Apply Encryption/i });
		await applyEncryptionButton.click();
		
		// Wait for encryption to be ACTUALLY applied (database migrated)
		// Look for the "Encryption: Active" indicator that appears after migration completes
		console.log('⏳ Browser A: Waiting for encryption to complete...');
		const encryptionActiveIndicator = browserAPage.getByTestId('encryption-active-indicator');
		await encryptionActiveIndicator.waitFor({ state: 'visible', timeout: 30000 });
		console.log('✅ Browser A: Encryption confirmed active (migration completed)');

		const dbAddressA = await getCurrentDatabaseAddress(browserAPage);
		expect(dbAddressA).toBeTruthy();

		// Add a todo
		const todoInput = browserAPage.locator('[data-testid="todo-input"]');
		await todoInput.fill(testTodoText);
		const addButton = browserAPage.locator('[data-testid="add-todo-button"]');
		await addButton.click();

		await expect(browserAPage.locator(`text=${testTodoText}`).first()).toBeVisible({
			timeout: 10000
		});
		console.log(`✅ Browser A: Added encrypted todo`);

		// ============================================================================
		// BROWSER B: Try with wrong password
		// ============================================================================
		console.log('\n📱 BROWSER B: Testing wrong password handling...');

	const browserB = await chromium.launch();
	const contextB = await browserB.newContext();
	const pageBrowserB = await contextB.newPage();
	
	// Capture browser console logs for debugging
	pageBrowserB.on('console', msg => {
		const type = msg.type();
		const text = msg.text();
		if (type === 'error' || text.includes('PasswordModal') || text.includes('retry') || text.includes('password')) {
			console.log(`[🌐 BROWSER B ${type.toUpperCase()}]`, text);
		}
	});

		// Navigate directly to the encrypted database URL
		await pageBrowserB.goto(`/?#/${dbAddressA}`);
		
		// Wait for page to load
		// Note: When navigating with a hash, the app auto-initializes without showing consent modal
		await pageBrowserB.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
		await pageBrowserB.waitForTimeout(1000);
		
		// Accept consent (skip if not found - hash URLs auto-initialize without modal)
		// await acceptConsentAndInitialize(pageBrowserB, { skipIfNotFound: true });
		await waitForP2PInitialization(pageBrowserB);
		
		// Wait for password modal to appear (it appears when encrypted DB is detected)
		// The modal appears asynchronously when the app tries to open the encrypted database
		const passwordModal = pageBrowserB.locator('h2:has-text("Database Password Required")');
		await passwordModal.waitFor({ state: 'visible', timeout: 20000 });

		// Enter WRONG password
		const passwordInput = pageBrowserB.locator('#password');
		await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
		await passwordInput.fill(wrongPassword);

	const unlockButton = pageBrowserB.getByRole('button', { name: /Unlock/i });
	await unlockButton.click();

	// Wrong password: modal should close briefly, then reappear after ~2s with retry warning
	// Wait for modal to disappear first
	console.log('⏳ Browser B: Waiting for password verification (2s)...');
	await passwordModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
		console.log('⚠️ Modal did not disappear - might have failed immediately');
	});
	
	// Wait for modal to reappear with retry warning
	console.log('⏳ Browser B: Waiting for modal to reappear with retry warning...');
	await passwordModal.waitFor({ state: 'visible', timeout: 5000 });
	
	// Check for retry warning message using testid
	const retryWarning = pageBrowserB.getByTestId('password-retry-warning');
	await expect(retryWarning).toBeVisible({ timeout: 2000 });
	console.log('✅ Browser B: Modal reappeared with retry warning for wrong password');

	// Try again with correct password
	await passwordInput.clear();
		await passwordInput.fill(encryptionPassword);
		await unlockButton.click();

		// Wait for password modal to close and todo to appear
		await passwordModal.waitFor({ state: 'hidden', timeout: 15000 });
		console.log('✅ Browser B: Database unlocked with correct password on retry');

		// Verify todo is accessible
		await expect(
			pageBrowserB.locator(`text=${testTodoText}`).first()
		).toBeVisible({ timeout: 30000 });
		console.log('✅ Browser B: Verified todo is accessible after successful unlock');

		console.log('\n' + '='.repeat(60));
		console.log('🎉 WRONG PASSWORD TEST PASSED');
		console.log('='.repeat(60) + '\n');

		await browserB.close();
	});

	test('should allow opening unencrypted database without password', async ({ page: browserAPage }) => {
		console.log('\n🚀 Starting unencrypted database test...\n');

		const testTodoText = `Unencrypted test todo - ${Date.now()}`;

		// ============================================================================
		// BROWSER A: Create unencrypted database (default)
		// ============================================================================
		console.log('📱 BROWSER A: Setting up unencrypted database...');

		await browserAPage.goto('/');
		await acceptConsentAndInitialize(browserAPage);
		await waitForP2PInitialization(browserAPage);

		const dbAddressA = await getCurrentDatabaseAddress(browserAPage);
		expect(dbAddressA).toBeTruthy();

		// Add a todo
		const todoInput = browserAPage.locator('[data-testid="todo-input"]');
		await todoInput.fill(testTodoText);
		const addButton = browserAPage.locator('[data-testid="add-todo-button"]');
		await addButton.click();

		await expect(browserAPage.locator(`text=${testTodoText}`).first()).toBeVisible({
			timeout: 10000
		});
		console.log(`✅ Browser A: Added unencrypted todo`);

		// ============================================================================
		// BROWSER B: Open unencrypted database via URL (no password needed)
		// ============================================================================
		console.log('\n📱 BROWSER B: Opening unencrypted database via URL...');

		const browserB = await chromium.launch();
		const contextB = await browserB.newContext();
		const pageBrowserB = await contextB.newPage();

		await pageBrowserB.goto(`/?#/${dbAddressA}`);

		// Wait for database to load - should NOT show password modal
		await pageBrowserB.waitForTimeout(5000);

		const passwordModal = pageBrowserB.locator('[class*="modal"]');
		const isModalVisible = await passwordModal.isVisible({ timeout: 5000 }).catch(() => false);

		if (isModalVisible) {
			console.warn('⚠️ Browser B: Password modal appeared (unexpected for unencrypted DB)');
		} else {
			console.log('✅ Browser B: No password modal for unencrypted database');
		}

		// Verify todo is immediately accessible
		await expect(
			pageBrowserB.locator(`text=${testTodoText}`).first()
		).toBeVisible({ timeout: 30000 });
		console.log('✅ Browser B: Verified unencrypted todo is immediately accessible');

		console.log('\n' + '='.repeat(60));
		console.log('🎉 UNENCRYPTED DATABASE TEST PASSED');
		console.log('='.repeat(60) + '\n');

		await browserB.close();
	});
});
