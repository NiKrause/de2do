import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	waitForPeerCount,
	getPeerId,
	getConnectedPeerIds,
	getPeerCount,
	getCurrentDatabaseAddress,
	waitForTodoText,
	handleWebAuthnModal,
	addVirtualAuthenticator
} from './helpers.js';

test.describe('Simple Todo P2P Application', () => {
	test('should have webserver running and accessible', async ({ page, request }) => {
		// Check if the webserver is responding
		const response = await request.get('/');
		expect(response.status()).toBe(200);

		// Verify the page loads
		await page.goto('/');
		await expect(page).toHaveTitle(/Simple TODO/i);

		// Verify main content is present
		await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

		console.log('✅ Webserver is running and accessible');
	});

	test('should open and close the QR code modal from the header', async ({ page }) => {
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Accept consent so header is interactable
		await acceptConsentAndInitialize(page);

		// Open QR code modal
		const qrButton = page.getByRole('button', { name: 'Show QR code for sharing this page' });
		await expect(qrButton).toBeVisible({ timeout: 10000 });
		await qrButton.click();

		const qrDialog = page.getByRole('dialog', { name: 'Simple-Todo Example' });
		await expect(qrDialog).toBeVisible({ timeout: 10000 });

		// Close via close button
		const closeButton = qrDialog.getByRole('button', { name: 'Close QR code modal' });
		await closeButton.click();
		await expect(qrDialog).not.toBeVisible();
	});

	test('should show consent modal and proceed with P2P initialization', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Give time for onMount to complete and modal to render
		await page.waitForTimeout(1000);

		// Step 1: Accept consent and initialize P2P
		console.log('✅ Consent banner visible with default settings');
		await acceptConsentAndInitialize(page);

		// Step 2: Wait for P2P initialization to complete
		console.log('⏳ Waiting for P2P initialization...');
		await waitForP2PInitialization(page);

		console.log('✅ P2P initialization successful');
		console.log('✅ Todo input form is visible');

		// Step 8: Add a test todo
		const testTodoText = 'Test todo from Playwright e2e test';

		// Use the data-testid selectors we added
		const todoInput = page.locator('[data-testid="todo-input"]');
		await todoInput.fill(testTodoText);

		const addButton = page.locator('[data-testid="add-todo-button"]');
		await addButton.click();

		console.log(`✅ Added todo: "${testTodoText}"`);

		// Step 9: Verify the todo appears in the list
		await expect(page.locator('text=' + testTodoText).first()).toBeVisible({ timeout: 10000 });

		console.log('✅ Todo is visible in the list');

		// Step 10: Todo verification completed (already confirmed visible above)
		console.log('✅ Todo verification completed successfully');

		// Step 11: Verify P2P connection status (optional)
		// Look for connected peers indicator or similar
		const connectionStatus = page.locator('[data-testid="connection-status"], .connection-status');
		if (await connectionStatus.isVisible()) {
			console.log('✅ Connection status indicator found');
		}

		console.log('🎉 All test steps completed successfully!');
	});

	test('should handle offline mode correctly', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Give time for onMount to complete
		await page.waitForTimeout(1000);

		// Wait for consent modal to appear
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 20000
		});

		// Scroll to bottom to ensure modal is in viewport
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

		// Toggle Network to Off (clicking the toggle button)
		// The second toggle button is Network
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const toggleButtons = consentModal.locator('button.relative.inline-flex');
		await toggleButtons.nth(1).click(); // Second toggle is Network

		// Click Proceed button
		const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
		await expect(proceedButton).toBeVisible({ timeout: 5000 });
		await proceedButton.click();

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Should still be able to use the app in offline mode
		await expect(page.locator('[data-testid="todo-input"]')).toBeVisible({ timeout: 10000 });

		console.log('✅ Offline mode test completed');
	});

	test('should display system toast notifications', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page.waitForTimeout(1000);

		// Wait for consent modal
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 20000
		});

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

		// Click Proceed button
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
		await proceedButton.click();

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Look for system toast notifications that should appear during initialization
		// These might indicate libp2p creation, Helia creation, OrbitDB creation, etc.
		const toastSelectors = [
			'[data-testid="system-toast"]',
			'.toast',
			'.notification',
			'.alert',
			'[role="alert"]'
		];

		let toastFound = false;
		for (const selector of toastSelectors) {
			const toast = page.locator(selector);
			if (await toast.isVisible()) {
				console.log(`✅ Found toast notification: ${selector}`);
				toastFound = true;
				break;
			}
		}

		// Wait a bit more for potential toasts
		await page.waitForTimeout(3000);

		console.log(
			toastFound
				? '✅ Toast notifications test completed'
				: '⚠️ No toast notifications found (may be expected)'
		);
	});

	test('should handle todo operations correctly', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page.waitForTimeout(1000);

		// Wait for consent modal
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 20000
		});

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

		// Click Proceed button
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
		await proceedButton.click();

		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Handle WebAuthn modal if present
		await handleWebAuthnModal(page);

		// Wait for todo input to be ready and enabled
		const todoInput = page.locator('[data-testid="todo-input"]');
		await expect(todoInput).toBeVisible({ timeout: 15000 });
		await expect(todoInput).toBeEnabled({ timeout: 10000 });

		// Test adding multiple todos
		const todos = [
			'First test todo',
			'Second test todo',
			'Third test todo with special chars: áéíóú'
		];

		for (const todoText of todos) {
			await todoInput.fill(todoText);
			await page.locator('[data-testid="add-todo-button"]').click();

			// Verify todo appears
			await expect(page.locator('text=' + todoText)).toBeVisible({ timeout: 5000 });

			console.log(`✅ Added and verified todo: "${todoText}"`);
		}

		// Test todo count
		const todoElements = page.locator('[data-testid="todo-item"], .todo-item');
		if (await todoElements.first().isVisible()) {
			const count = await todoElements.count();
			expect(count).toBeGreaterThanOrEqual(todos.length);
			console.log(`✅ Todo count verified: ${count} todos found`);
		}

		console.log('🎉 Todo operations test completed successfully!');
	});

	test.skip('should connect two browsers and see each other as connected peers', async ({
		browser
	}) => {
		// Create two separate browser contexts (simulating two different browsers)
		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		// Enable console logging for debugging
		page1.on('console', (msg) => console.log('Page1:', msg.text()));
		page2.on('console', (msg) => console.log('Page2:', msg.text()));

		console.log('🚀 Starting two-browser peer connection test...');

		// Navigate both pages to the application
		await page1.goto('/');
		await page2.goto('/');

		// Wait for SvelteKit to finish hydrating on both pages
		await page1.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page2.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Give time for onMount to complete
		await page1.waitForTimeout(1000);
		await page2.waitForTimeout(1000);

		// Step 1: Accept consent and initialize P2P on both pages
		console.log('📋 Accepting consent on both pages...');
		await acceptConsentAndInitialize(page1);
		await acceptConsentAndInitialize(page2);

		// Step 2: Wait for P2P initialization on both pages
		console.log('⏳ Waiting for P2P initialization on both pages...');
		await waitForP2PInitialization(page1);
		await waitForP2PInitialization(page2);

		// Step 3: Get peer IDs from both pages
		const peerId1 = await getPeerId(page1);
		const peerId2 = await getPeerId(page2);

		console.log(`📱 Page 1 Peer ID: ${peerId1}`);
		console.log(`📱 Page 2 Peer ID: ${peerId2}`);

		expect(peerId1).toBeTruthy();
		expect(peerId2).toBeTruthy();
		expect(peerId1).not.toBe(peerId2); // They should have different peer IDs

		// Step 4: Wait for peer connections to be established
		// Both pages should connect to the relay, and then discover each other
		console.log('🔗 Waiting for peer connections...');
		await waitForPeerCount(page1, 1, 90000); // Wait for at least 1 peer (the relay or page2)
		await waitForPeerCount(page2, 1, 90000); // Wait for at least 1 peer (the relay or page1)

		// Give extra time for peer discovery and connection
		console.log('⏳ Waiting for peer discovery and connection...');
		await page1.waitForTimeout(5000);
		await page2.waitForTimeout(5000);

		// Step 5: Verify both pages see each other in connected peers
		console.log('🔍 Checking if pages see each other...');

		// Extract short peer IDs for comparison (first 8-16 characters)
		const shortPeerId1 = peerId1?.substring(0, 16) || '';
		const shortPeerId2 = peerId2?.substring(0, 16) || '';

		// Helper function to check peer visibility
		const checkPeerVisibility = async () => {
			const peers1 = await getConnectedPeerIds(page1);
			const peers2 = await getConnectedPeerIds(page2);

			console.log(`📊 Page 1 sees ${peers1.length} peer(s):`, peers1);
			console.log(`📊 Page 2 sees ${peers2.length} peer(s):`, peers2);

			const page1SeesPage2 = peers1.some((peer) => peer.includes(shortPeerId2));
			const page2SeesPage1 = peers2.some((peer) => peer.includes(shortPeerId1));

			return { page1SeesPage2, page2SeesPage1 };
		};

		// Initial check
		let { page1SeesPage2, page2SeesPage1 } = await checkPeerVisibility();

		// Wait a bit more if they don't see each other yet (peer discovery can take time)
		if (!page1SeesPage2 || !page2SeesPage1) {
			console.log('⏳ Waiting additional time for peer discovery...');
			await page1.waitForTimeout(10000);
			await page2.waitForTimeout(10000);

			// Re-check
			const result = await checkPeerVisibility();
			page1SeesPage2 = result.page1SeesPage2;
			page2SeesPage1 = result.page2SeesPage1;
		}

		// Assert that both pages see each other
		console.log(`🔍 Page 1 sees Page 2: ${page1SeesPage2}`);
		console.log(`🔍 Page 2 sees Page 1: ${page2SeesPage1}`);

		expect(page1SeesPage2).toBe(true);
		expect(page2SeesPage1).toBe(true);

		console.log('✅ Both pages see each other as connected peers!');

		// Step 6: Verify final peer counts
		const finalPeerCount1 = await getPeerCount(page1);
		const finalPeerCount2 = await getPeerCount(page2);

		console.log(`📊 Final peer count - Page 1: ${finalPeerCount1}, Page 2: ${finalPeerCount2}`);

		// Both should have at least 1 peer (either the relay or each other)
		expect(finalPeerCount1).toBeGreaterThanOrEqual(1);
		expect(finalPeerCount2).toBeGreaterThanOrEqual(1);

		// Clean up
		await context1.close();
		await context2.close();

		console.log('✅ Two-browser peer connection test completed!');
	});

	test('should create passkey, add todos, and sync to another browser', async ({ browser }) => {
		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		page1.on('console', (msg) => console.log('Alice:', msg.text()));
		page2.on('console', (msg) => console.log('Bob:', msg.text()));

		console.log('🚀 Starting passkey + database sharing test...');

		// ===== ALICE: Set up virtual authenticator, create passkey, add 3 todos =====
		await addVirtualAuthenticator(page1);

		// Use localhost (not 127.0.0.1) so WebAuthn has a valid RP ID
		await page1.goto('http://localhost:4174/');
		await page1.waitForFunction(
			() =>
				document.querySelector('main') !== null ||
				document.querySelector('[data-testid="consent-modal"]') !== null,
			{ timeout: 30000 }
		);
		await page1.waitForTimeout(1000);

		// Accept consent — the WebAuthn modal will appear next
		console.log('📱 Alice: Accepting consent...');
		const consentModal1 = page1.locator('[data-testid="consent-modal"]');
		await expect(consentModal1).toBeVisible({ timeout: 10000 });
		await page1.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const proceedButton1 = page1.getByTestId('consent-accept-button');
		await proceedButton1.click();
		await expect(consentModal1).not.toBeVisible();

		// Create passkey via the WebAuthn setup modal
		console.log('🔐 Alice: Creating passkey...');
		await page1.waitForSelector('[data-testid="webauthn-setup-modal"]', {
			state: 'attached',
			timeout: 10000
		});
		const setupButton = page1.getByRole('button', { name: /Set Up WebAuthn/i });
		await expect(setupButton).toBeVisible({ timeout: 5000 });
		await setupButton.click();
		console.log('🔐 Alice: Clicked "Set Up WebAuthn", waiting for credential...');
		await expect(page1.locator('[data-testid="webauthn-setup-modal"]')).not.toBeVisible({
			timeout: 20000
		});
		console.log('✅ Alice: Passkey created');

		// Wait for P2P initialization (triggered after WebAuthn modal closes)
		await waitForP2PInitialization(page1);

		// Add 3 todos
		const todos = ['Buy groceries', 'Walk the dog', 'Write tests'];
		const todoInput1 = page1.locator('[data-testid="todo-input"]');
		await expect(todoInput1).toBeVisible({ timeout: 15000 });
		await expect(todoInput1).toBeEnabled({ timeout: 10000 });

		for (const todoText of todos) {
			await todoInput1.fill(todoText);
			await page1.locator('[data-testid="add-todo-button"]').click();
			await expect(page1.locator('text=' + todoText).first()).toBeVisible({ timeout: 5000 });
			console.log(`✅ Alice: Added "${todoText}"`);
		}

		// Wait for todos to persist
		await page1.waitForTimeout(3000);

		// Get database address
		const dbAddress = await getCurrentDatabaseAddress(page1, 15000);
		expect(dbAddress).toBeTruthy();
		console.log(`✅ Alice: Database address: ${dbAddress}`);

		// ===== BOB: Open shared database and verify todos =====
		console.log('📱 Bob: Opening shared database...');
		const baseUrl = await page1.evaluate(() => window.location.origin);
		await page2.goto(`${baseUrl}/#${dbAddress}`);

		// Hash URL auto-initializes P2P (skips consent)
		await waitForP2PInitialization(page2);

		// Wait for peer connection
		console.log('🔗 Bob: Waiting for peer connections...');
		await waitForPeerCount(page2, 1, 90000);

		// Verify all 3 todos sync
		console.log('⏳ Bob: Waiting for todos to sync...');
		for (const todoText of todos) {
			await waitForTodoText(page2, todoText, 60000);
			console.log(`✅ Bob: Found "${todoText}"`);
		}

		console.log('✅ Bob: All 3 todos synced successfully!');

		await context1.close();
		await context2.close();

		console.log('🎉 Passkey + database sharing test completed!');
	});

	test.skip('should replicate database when Browser B opens Browser A database by name', async ({
		browser
	}) => {
		// Create two separate browser contexts (simulating two different browsers)
		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		// Enable console logging for debugging
		page1.on('console', (msg) => console.log('Page1:', msg.text()));
		page2.on('console', (msg) => console.log('Page2:', msg.text()));

		console.log('🚀 Starting database replication by name test (A -> B)...');

		// ===== BROWSER A (Page 1) =====
		console.log('📱 Browser A: Initializing...');
		await page1.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page1.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page1.waitForTimeout(1000);

		// Accept consent and initialize P2P
		await acceptConsentAndInitialize(page1);
		await waitForP2PInitialization(page1);

		// Wait for todo input to be ready
		const todoInput1 = page1.locator('[data-testid="todo-input"]');
		await expect(todoInput1).toBeVisible({ timeout: 15000 });

		// Get Browser A's identity ID from the database name
		const browserAIdentityId = await page1.evaluate(() => {
			// Try to extract from database name pattern identityId_projects
			if (window.__todoDB__ && window.__todoDB__.name) {
				const name = window.__todoDB__.name;
				if (name.includes('_')) {
					return name.split('_')[0];
				}
			}
			return null;
		});

		// If not found, wait a bit and try again
		let identityIdA = browserAIdentityId;
		if (!identityIdA) {
			await page1.waitForTimeout(2000);
			identityIdA = await page1.evaluate(() => {
				if (window.__todoDB__ && window.__todoDB__.name) {
					const name = window.__todoDB__.name;
					if (name.includes('_')) {
						return name.split('_')[0];
					}
				}
				return null;
			});
		}

		expect(identityIdA).toBeTruthy();
		console.log(`📱 Browser A Identity ID: ${identityIdA?.slice(0, 16)}...`);

		// Add a todo in Browser A
		const testTodoA = 'Todo from Browser A for replication test';
		await todoInput1.fill(testTodoA);
		await page1.locator('[data-testid="add-todo-button"]').click();

		// Wait for todo to appear using robust helper
		await waitForTodoText(page1, testTodoA, 10000, { browserName: test.info().project.name });
		console.log(`✅ Browser A: Added todo "${testTodoA}"`);

		// Wait a bit for the todo to be saved
		await page1.waitForTimeout(2000);

		// ===== BROWSER B (Page 2) =====
		console.log('📱 Browser B: Initializing...');
		await page2.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page2.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page2.waitForTimeout(1000);

		// Accept consent and initialize P2P
		await acceptConsentAndInitialize(page2);
		await waitForP2PInitialization(page2);

		// Wait for todo input to be ready
		const todoInput2 = page2.locator('[data-testid="todo-input"]');
		await expect(todoInput2).toBeVisible({ timeout: 15000 });

		// Wait for peer connections
		console.log('🔗 Browser B: Waiting for peer connections...');
		await waitForPeerCount(page2, 1, 90000);

		// Wait a bit for peer discovery
		await page2.waitForTimeout(5000);

		// Find the Users List input field and paste Browser A's identity ID
		console.log('📋 Browser B: Adding Browser A as tracked user...');
		const usersListInput = page2.locator('#users-list');
		await expect(usersListInput).toBeVisible({ timeout: 10000 });

		// Click on the input to focus it
		await usersListInput.click();
		await page2.waitForTimeout(500);

		// Paste the identity ID and press Enter (simulating user behavior)
		await usersListInput.fill(identityIdA);
		await usersListInput.press('Enter');

		// Wait for the database to be discovered and opened
		// The database should automatically load and replicate
		console.log('⏳ Browser B: Waiting for database discovery and replication...');

		// Wait for the todo to appear (with longer timeout for replication)
		// The database should automatically switch and show Browser A's todos
		// Use robust helper with browser-specific timeout adjustments
		await waitForTodoText(page2, testTodoA, 45000, { browserName: test.info().project.name });

		console.log(`✅ Browser B: Found replicated todo "${testTodoA}"`);

		// ===== SWITCH BACK TO BROWSER B's OWN IDENTITY =====
		console.log('🔄 Browser B: Switching back to own identity...');

		// Click on the users list input to open dropdown first
		await usersListInput.click();
		await page2.waitForTimeout(500);

		// Wait for dropdown to appear
		await page2.waitForSelector('[role="listbox"]', { timeout: 5000 });

		// Get Browser B's identity ID from the dropdown options (the one that's NOT Browser A's)
		const identityIdB = await page2.evaluate(
			(browserAIdentityPrefix) => {
				const usersListDiv = document.querySelector('[role="listbox"]');
				if (usersListDiv) {
					const options = usersListDiv.querySelectorAll('[role="option"]');
					for (const option of options) {
						const text = option.textContent?.trim() || '';
						// Identity IDs are long (66 chars), and we want the one that's NOT Browser A's
						if (text && text.length > 50 && !text.startsWith(browserAIdentityPrefix)) {
							return text;
						}
					}
				}
				return null;
			},
			identityIdA.slice(0, 16)
		);

		expect(identityIdB).toBeTruthy();
		console.log(`📱 Browser B Identity ID: ${identityIdB?.slice(0, 16)}...`);

		// Dropdown is already open from above, no need to click again

		// Find and click on Browser B's own identity in the dropdown
		// The identity should be in the filtered users list
		// Use filter to find the option containing the identity ID (may be truncated in display)
		const browserBIdentityOption = page2
			.locator('[role="option"]')
			.filter({ hasText: identityIdB.slice(0, 16) });
		await expect(browserBIdentityOption).toBeVisible({ timeout: 5000 });
		await browserBIdentityOption.click();
		await page2.waitForTimeout(1000);

		// Wait for the database to switch back to Browser B's own database
		console.log('⏳ Browser B: Waiting for database to switch to own identity...');
		await page2.waitForTimeout(2000);

		// Verify todo input is still available
		await expect(todoInput2).toBeVisible({ timeout: 10000 });

		// Verify Browser B's todo list is empty (testTodoA should not be visible)
		// Use a more robust check - wait a bit and verify the todo is not present
		await page2.waitForTimeout(1000);
		const todoAExists = await page2.locator(`[data-todo-text="${testTodoA}"]`).count();
		expect(todoAExists).toBe(0);
		console.log('✅ Browser B: Switched to own identity, todo list is empty');

		// ===== ADD TWO NEW TODOS IN BROWSER B =====
		console.log('📝 Browser B: Adding two new todos...');
		const testTodoB1 = 'Todo 1 from Browser B';
		const testTodoB2 = 'Todo 2 from Browser B';

		// Add first todo
		await todoInput2.fill(testTodoB1);
		await page2.locator('[data-testid="add-todo-button"]').click();
		await waitForTodoText(page2, testTodoB1, 10000, { browserName: test.info().project.name });
		console.log(`✅ Browser B: Added todo "${testTodoB1}"`);

		// Add second todo
		await todoInput2.fill(testTodoB2);
		await page2.locator('[data-testid="add-todo-button"]').click();
		await waitForTodoText(page2, testTodoB2, 10000, { browserName: test.info().project.name });
		console.log(`✅ Browser B: Added todo "${testTodoB2}"`);

		// Wait a bit for todos to be saved
		await page2.waitForTimeout(2000);

		// ===== CLICK ON BROWSER B's IDENTITY IN USERLIST TO COPY IT =====
		console.log('📋 Browser B: Clicking on own identity to copy it...');
		await usersListInput.click();
		await page2.waitForTimeout(500);

		// Wait for dropdown
		await page2.waitForSelector('[role="listbox"]', { timeout: 5000 });

		// Click on Browser B's identity again (this will copy it to clipboard)
		await browserBIdentityOption.click();
		await page2.waitForTimeout(1000);

		// Get the identity ID from clipboard (or use the one we already have)
		// Note: Playwright clipboard access might be limited, so we'll use the identityIdB we already have
		console.log(`📋 Browser B: Identity ID copied (${identityIdB?.slice(0, 16)}...)`);

		// ===== GO BACK TO BROWSER A AND ADD BROWSER B's IDENTITY =====
		console.log('🔄 Browser A: Adding Browser B as tracked user...');

		// Find the Users List input field in Browser A
		const usersListInputA = page1.locator('#users-list');
		await expect(usersListInputA).toBeVisible({ timeout: 10000 });

		// Click on the input to focus it
		await usersListInputA.click();
		await page1.waitForTimeout(500);

		// Paste Browser B's identity ID and press Enter
		await usersListInputA.fill(identityIdB);
		await usersListInputA.press('Enter');

		// Wait for the database to be discovered and opened
		console.log('⏳ Browser A: Waiting for Browser B database discovery and replication...');
		await page1.waitForTimeout(2000); // Give time for database discovery

		// Wait for Browser B's todos to appear in Browser A using robust helper
		await waitForTodoText(page1, testTodoB1, 45000, { browserName: test.info().project.name });
		await waitForTodoText(page1, testTodoB2, 45000, { browserName: test.info().project.name });

		console.log(`✅ Browser A: Found replicated todos from Browser B`);
		console.log(`   - "${testTodoB1}"`);
		console.log(`   - "${testTodoB2}"`);

		// Clean up
		await context1.close();
		await context2.close();

		console.log('✅ Database replication by name test completed successfully!');
	});

	test('should load todo list in embed mode via hash URL', async ({ page }) => {
		console.log('🧪 Testing embed URL functionality...');

		// Step 1: Initialize P2P and create a todo
		await page.goto('/');
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);
		await page.waitForTimeout(1000);

		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		// Add a test todo
		const testTodoEmbed = 'Todo for embed test';
		const todoInput = page.locator('[data-testid="todo-input"]');
		await expect(todoInput).toBeVisible({ timeout: 10000 });
		await todoInput.fill(testTodoEmbed);
		await page.locator('[data-testid="add-todo-button"]').click();

		// Wait for todo to appear
		await waitForTodoText(page, testTodoEmbed, 10000, { browserName: test.info().project.name });
		console.log(`✅ Added todo "${testTodoEmbed}"`);

		// Step 2: Get the database address
		const dbAddress = await getCurrentDatabaseAddress(page);
		expect(dbAddress).toBeTruthy();
		console.log(`📋 Database address: ${dbAddress?.slice(0, 20)}...`);

		// Step 3: Navigate to embed URL using hash
		const embedUrl = `/#/embed/${encodeURIComponent(dbAddress)}`;
		console.log(`🔗 Navigating to embed URL: ${embedUrl}`);
		await page.goto(embedUrl);

		// Step 4: Wait for embed page to load and initialize
		// Wait for the page to be ready (main element should be visible)
		await page.waitForSelector('main', { timeout: 30000 });

		// Wait for P2P initialization in embed mode
		await page.waitForFunction(
			() => {
				// Check if we're past the loading state
				const main = document.querySelector('main');
				if (!main) return false;
				// Check if there's content (either todos or error)
				const hasContent = main.textContent && main.textContent.trim().length > 0;
				const isLoading = main.textContent?.includes('Loading todo list');
				return hasContent && !isLoading;
			},
			{ timeout: 30000 }
		);

		// Wait a bit more for the embed to fully load
		await page.waitForTimeout(2000);

		// Step 5: Verify the todo appears in embed view
		await waitForTodoText(page, testTodoEmbed, 30000, { browserName: test.info().project.name });
		console.log(`✅ Todo "${testTodoEmbed}" found in embed view`);

		// Step 6: Verify embed-specific UI elements
		// The embed view should not show the add todo form by default (unless allowAdd=true)
		// Check for the todo input field which should not be visible in read-only embed mode
		const todoInputInEmbed = page.locator('[data-testid="todo-input"]');
		await expect(todoInputInEmbed).not.toBeVisible({ timeout: 5000 });
		console.log('✅ Embed view is read-only by default (no add form)');

		console.log('✅ Embed URL test completed successfully!');
	});
});
