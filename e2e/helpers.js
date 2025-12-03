import { expect } from '@playwright/test';

/**
 * Helper to accept consent modal and initialize P2P
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} [options] - Options for consent
 * @param {boolean} [options.enableNetworkConnection=true] - Enable network connection
 * @param {boolean} [options.enablePeerConnections=true] - Enable peer connections
 * @param {boolean} [options.skipIfNotFound=false] - Skip consent if modal not found (for re-navigations)
 */
export async function acceptConsentAndInitialize(page, options = {}) {
	const {
		enableNetworkConnection = true,
		enablePeerConnections = true,
		skipIfNotFound = false
	} = options;

	// First, ensure the page has loaded and is ready
	console.log('🔍 Checking if page loaded successfully...');

	// Collect console errors (set up listener)
	const consoleErrors = [];
	const consoleListener = (msg) => {
		if (msg.type() === 'error') {
			consoleErrors.push(msg.text());
		}
	};
	page.on('console', consoleListener);

	// Wait for page to be in a ready state
	try {
		await page.waitForLoadState('networkidle', { timeout: 15000 });
		console.log('✅ Page loaded successfully');
	} catch (error) {
		console.error('❌ Page failed to load:', error.message);
		// Check for JavaScript errors
		const jsErrors = await page.evaluate(() => {
			return window.__playwrightErrors || [];
		});
		if (jsErrors.length > 0) {
			console.error('❌ JavaScript errors on page:', jsErrors);
		}
		// Check page content
		const pageContent = await page.content();
		if (pageContent.length < 100) {
			page.off('console', consoleListener);
			throw new Error(
				`Page content is too short (${pageContent.length} chars). Server may not be running or page failed to load.`
			);
		}
		page.off('console', consoleListener);
		throw new Error(`Page failed to load: ${error.message}`);
	}

	// Wait for consent modal to appear
	try {
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 10000
		});
	} catch (error) {
		if (skipIfNotFound) {
			console.log(
				'⚠️ Consent modal not found, skipping (already accepted or page already initialized)'
			);
			page.off('console', consoleListener);
			return;
		}

		// Provide better error diagnostics
		console.error('❌ Consent modal not found. Diagnostics:');

		// Check if page has any content
		const bodyText = await page.locator('body').textContent();
		console.log(`📄 Page body length: ${bodyText?.length || 0} characters`);

		// Check for common elements that should exist
		const hasApp = (await page.locator('body').count()) > 0;
		console.log(`📄 Has body element: ${hasApp}`);

		// Check for any modals
		const modals = await page.locator('[role="dialog"], .modal, [class*="modal"]').count();
		console.log(`📄 Found ${modals} potential modal elements`);

		// Check for Svelte app
		const svelteApp = await page.locator('[data-svelte-h]').count();
		console.log(`📄 Found ${svelteApp} Svelte elements`);

		if (consoleErrors.length > 0) {
			console.error('❌ Console errors:', consoleErrors);
		}

		// Take a screenshot for debugging
		try {
			await page.screenshot({ path: 'debug-consent-modal-not-found.png' });
			console.log('📸 Screenshot saved to debug-consent-modal-not-found.png');
		} catch (screenshotError) {
			console.warn('⚠️ Could not take screenshot:', screenshotError.message);
		}

		// Clean up console listener
		page.off('console', consoleListener);

		throw new Error(
			`Consent modal not found after 10s. Page may not have loaded correctly. Original error: ${error.message}`
		);
	}

	// Scroll to bottom to ensure modal is in viewport
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

	// Verify it's visible
	await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

	// Toggle network connection if needed
	if (!enableNetworkConnection) {
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const toggleButtons = consentModal.locator('button.relative.inline-flex');
		await toggleButtons.nth(1).click(); // Second toggle is Network
	}

	// Toggle peer connections if needed (only if network is enabled)
	if (!enablePeerConnections && enableNetworkConnection) {
		const consentModal = page.locator('[data-testid="consent-modal"]');
		// Find the peer connections checkbox (third toggle)
		const peerCheckbox = consentModal.locator('#peer-connections');
		if (await peerCheckbox.isVisible()) {
			const isChecked = await peerCheckbox.isChecked();
			if (isChecked) {
				await peerCheckbox.click();
			}
		}
	}

	// Click Accept & Continue button
	const consentModal = page.locator('[data-testid="consent-modal"]');
	const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
	await expect(proceedButton).toBeVisible({ timeout: 10000 });
	await expect(proceedButton).toBeEnabled({ timeout: 5000 });
	await proceedButton.click();

	// Wait for modal to disappear
	await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

	// Clean up console listener
	page.off('console', consoleListener);

	console.log('✅ Consent accepted');
	
	// Handle WebAuthn setup modal (if it appears)
	await handleWebAuthnModal(page);
	
	console.log('✅ P2P initialization started');
}

/**
 * Helper to wait for P2P initialization to complete
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=30000] - Timeout in milliseconds
 */
export async function waitForP2PInitialization(page, timeout = 30000) {
	console.log('⏳ Waiting for P2P initialization...');

	// Wait for todo input to be available (indicates OrbitDB is ready)
	await page.waitForSelector('[data-testid="todo-input"]', { timeout: 10000 });
	
	// Wait for footer to be displayed (indicates successful P2P initialization)
	// The footer appears when initializationStore.isInitialized is true
	await page.waitForSelector('footer', { timeout, state: 'visible' });

	console.log('✅ P2P initialization completed');
}

/**
 * Helper to wait for peer connection count to reach a minimum
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} minPeers - Minimum number of peers to wait for
 * @param {number} [timeout=60000] - Timeout in milliseconds
 */
export async function waitForPeerCount(page, minPeers = 1, timeout = 60000) {
	console.log(`⏳ Waiting for at least ${minPeers} peer(s)...`);

	// Add periodic logging to see what's happening
	const checkInterval = setInterval(async () => {
		const debugInfo = await page.evaluate(() => {
			const footer = document.querySelector('footer');
			if (!footer) return { hasFooter: false };
			
			const peersLabel = Array.from(footer.querySelectorAll('span')).find((s) =>
				s.textContent?.includes('Peers:')
			);
			if (!peersLabel) return { hasFooter: true, hasPeersLabel: false };
			
			const countSpan = peersLabel.nextElementSibling;
			if (!countSpan) return { hasFooter: true, hasPeersLabel: true, hasCountSpan: false };
			
			const countText = countSpan.textContent;
			const match = countText?.match(/\((\d+)\)/);
			const count = match ? parseInt(match[1], 10) : 0;
			
			// Also check libp2p peers directly
			let libp2pPeerCount = 0;
			if (window.__libp2p__) {
				try {
					libp2pPeerCount = window.__libp2p__.getPeers()?.length || 0;
				} catch (e) {
					// ignore
				}
			}
			
			return { 
				hasFooter: true, 
				hasPeersLabel: true, 
				hasCountSpan: true, 
				countText,
				count,
				libp2pPeerCount
			};
		});
		console.log(`🔍 Footer debug:`, JSON.stringify(debugInfo));
	}, 5000);

	try {
		await page.waitForFunction(
			(min) => {
				// Look for the footer with peer count
				const footer = document.querySelector('footer');
				if (!footer) return false;

				// Find "Peers:" label and extract count from the next element
				const peersLabel = Array.from(footer.querySelectorAll('span')).find((s) =>
					s.textContent?.includes('Peers:')
				);
				if (!peersLabel) return false;

				// The count is in the next sibling span with format "(X)"
				const countSpan = peersLabel.nextElementSibling;
				if (!countSpan) return false;

				const match = countSpan.textContent?.match(/\((\d+)\)/);
				const count = match ? parseInt(match[1], 10) : 0;

				return count >= min;
			},
			minPeers,
			{ timeout }
		);
		console.log(`✅ Peer count reached at least ${minPeers}`);
	} finally {
		clearInterval(checkInterval);
	}
}

/**
 * Helper to get the current peer count
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<number>} Current peer count
 */
export async function getPeerCount(page) {
	return await page.evaluate(() => {
		// Look for the footer with peer count
		const footer = document.querySelector('footer');
		if (!footer) return 0;

		// Find "Peers:" label and extract count from the next element
		const peersLabel = Array.from(footer.querySelectorAll('span')).find((s) =>
			s.textContent?.includes('Peers:')
		);
		if (!peersLabel) return 0;

		const countSpan = peersLabel.nextElementSibling;
		if (!countSpan) return 0;

		const match = countSpan.textContent?.match(/\((\d+)\)/);
		return match ? parseInt(match[1], 10) : 0;
	});
}

/**
 * Helper to get the peer ID of the current page
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<string|null>} Peer ID or null if not found
 */
export async function getPeerId(page) {
	return await page.evaluate(() => {
		// Look for PeerID in the footer
		const footer = document.querySelector('footer');
		if (!footer) return null;

		// Find "PeerID:" label and get the next code element
		const peerIdLabel = Array.from(footer.querySelectorAll('span')).find((s) =>
			s.textContent?.includes('PeerID:')
		);
		if (!peerIdLabel) return null;

		// The peer ID is in a code element that follows
		const peerIdCode = peerIdLabel.nextElementSibling;
		if (!peerIdCode) return null;

		// Extract the actual peer ID (might need to reconstruct from shortened version)
		// The footer shows "...xxxxx" (last 5 chars), but we need the full ID
		// For now, return what we have - tests will need to be updated
		const shortId = peerIdCode.textContent?.trim();
		
		// Try to get full peer ID from window object if available
		if (window.__libp2p__ && window.__libp2p__.peerId) {
			return window.__libp2p__.peerId.toString();
		}
		
		return shortId || null;
	});
}

/**
 * Helper to get list of connected peer IDs
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<string[]>} Array of peer IDs
 */
export async function getConnectedPeerIds(page) {
	return await page.evaluate(() => {
		const peers = [];
		
		// Try to get peers from libp2p instance if available
		if (window.__libp2p__) {
			try {
				const peerIds = window.__libp2p__.getPeers();
				peerIds.forEach((peerId) => {
					peers.push(peerId.toString());
				});
				return peers;
			} catch (e) {
				// Fall through to footer method
			}
		}
		
		// Fallback: try to get from footer hover (won't work without hover)
		// This is a limitation - we may need to expose peer IDs differently
		return peers;
	});
}

/**
 * Helper to wait for a specific peer to appear in the connected peers list
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} peerId - Peer ID to wait for (can be partial match)
 * @param {number} [timeout=30000] - Timeout in milliseconds
 */
export async function waitForPeerInList(page, peerId, timeout = 30000) {
	console.log(`⏳ Waiting for peer ${peerId} to appear in connected peers list...`);

	await page.waitForFunction(
		(expectedPeerId) => {
			const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
				h.textContent?.includes('Connected Peers')
			);
			if (!heading) return false;

			const container = heading.closest('.rounded-lg');
			if (!container) return false;

			const peerElements = container.querySelectorAll('code');
			for (const el of peerElements) {
				const text = el.textContent?.trim();
				if (text && text.includes(expectedPeerId)) {
					return true;
				}
			}
			return false;
		},
		peerId,
		{ timeout }
	);

	console.log(`✅ Peer ${peerId} found in connected peers list`);
}

/**
 * Helper to wait for WebRTC connection (checks for transport badges)
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=60000] - Timeout in milliseconds
 */
export async function waitForWebRTCConnection(page, timeout = 60000) {
	console.log('⏳ Waiting for WebRTC connection...');

	// Wait for any transport badge to appear (indicating connection)
	await page.waitForFunction(
		() => {
			// Look for transport badges in the Connected Peers section
			const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
				h.textContent?.includes('Connected Peers')
			);
			if (!heading) return false;

			const container = heading.closest('.rounded-lg');
			if (!container) return false;

			// Look for transport badges (webrtc, websocket, etc.)
			const badges = container.querySelectorAll('[class*="badge"], [class*="transport"]');
			return badges.length > 0;
		},
		{ timeout }
	);

	console.log('✅ WebRTC connection established');
}

/**
 * Helper to get the current database address from the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=15000] - Timeout in milliseconds
 * @returns {Promise<string|null>} Database address or null if not found
 */
export async function getCurrentDatabaseAddress(page, timeout = 15000) {
	console.log('🔍 Getting current database address...');

	// Add this as Method 5 - directly evaluate the store
	const address = await page
		.waitForFunction(
			() => {
				// Method 1: Try to get from todoDB first (most reliable)
				if (window.__todoDB__ && window.__todoDB__.address) {
					return window.__todoDB__.address;
				}

				// Method 2: Check if exposed in window object (for e2e testing)
				if (window.__currentDbAddress__) {
					return window.__currentDbAddress__;
				}

				// Method 3: Check URL hash
				const hash = window.location.hash;
				if (hash && hash.startsWith('#/')) {
					const decoded = decodeURIComponent(hash.slice(2));
					if (decoded.startsWith('/orbitdb/')) {
						return decoded;
					}
				}

				// Method 4: Try to access via console/debug function if available
				// This is a fallback - we know the address exists from logs
				try {
					// Check if there's a way to get it from the page's internal state
					// We can try to trigger a console log or access a debug function
					if (window.debugDatabase) {
						// This won't return the value, but we can try other methods
					}
				} catch {
					// Ignore
				}

				return null;
			},
			{ timeout }
		)
		.then((handle) => handle.jsonValue())
		.catch(() => null);

	if (address) {
		console.log(`✅ Found database address: ${address}`);
		return address;
	}

	// If still not found, try waiting a bit more and checking again
	console.log('⏳ Address not found yet, waiting a bit more...');
	await page.waitForTimeout(2000);

	const retryAddress = await page.evaluate(() => {
		// Check todoDB first
		if (window.__todoDB__ && window.__todoDB__.address) {
			return window.__todoDB__.address;
		}
		// Check currentDbAddress
		if (window.__currentDbAddress__) {
			return window.__currentDbAddress__;
		}
		// Check URL hash
		const hash = window.location.hash;
		if (hash && hash.startsWith('#/')) {
			const decoded = decodeURIComponent(hash.slice(2));
			if (decoded.startsWith('/orbitdb/')) {
				return decoded;
			}
		}
		return null;
	});

	if (retryAddress) {
		console.log(`✅ Found database address on retry: ${retryAddress}`);
		return retryAddress;
	}

	console.warn('⚠️ Could not find database address');
	return null;
}

/**
 * Helper to get the current identity ID from the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=15000] - Timeout in milliseconds
 * @returns {Promise<string|null>} Identity ID or null if not found
 */
export async function getIdentityId(page, timeout = 15000) {
	console.log('🔍 Getting current identity ID...');

	const identityId = await page
		.waitForFunction(
			() => {
				// Try to get from window object if exposed
				if (window.__currentIdentityId__) {
					return window.__currentIdentityId__;
				}

				// Try to get from orbitdb if available
				if (window.__orbitdb__ && window.__orbitdb__.identity && window.__orbitdb__.identity.id) {
					return window.__orbitdb__.identity.id;
				}

				// Try to get from todoDB if available
				if (window.__todoDB__ && window.__todoDB__.id) {
					return window.__todoDB__.id;
				}

				return null;
			},
			{ timeout }
		)
		.then((handle) => handle.jsonValue())
		.catch(() => null);

	if (identityId) {
		console.log(`✅ Found identity ID: ${identityId.slice(0, 16)}...`);
		return identityId;
	}

	console.warn('⚠️ Could not find identity ID');
	return null;
}

/**
 * Helper to wait for a todo with specific text to appear (robust across browsers)
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} todoText - Text of the todo to wait for
 * @param {number} [timeout=30000] - Timeout in milliseconds
 * @param {Object} [options] - Additional options
 * @param {string} [options.browserName] - Browser name for browser-specific adjustments
 */
export async function waitForTodoText(page, todoText, timeout = 30000, options = {}) {
	const { browserName } = options;
	console.log(`⏳ Waiting for todo "${todoText}" to appear...`);

	// Try multiple selector strategies for robustness
	const strategies = [
		// Strategy 1: data-todo-text attribute (most reliable)
		() => page.locator(`[data-todo-text="${todoText}"]`),
		// Strategy 2: data-testid with text filter
		() => page.locator('[data-testid="todo-text"]').filter({ hasText: todoText }),
		// Strategy 3: Text locator (fallback for browsers that might not have data attributes yet)
		() => page.locator(`text=${todoText}`)
	];

	// Adjust timeout for Firefox (tends to be slower)
	const adjustedTimeout = browserName === 'firefox' ? timeout * 1.5 : timeout;

	let lastError = null;
	for (const strategy of strategies) {
		try {
			const locator = strategy();
			await expect(locator).toBeVisible({ timeout: adjustedTimeout });
			console.log(`✅ Found todo "${todoText}" using ${strategy.name || 'strategy'}`);
			return;
		} catch (error) {
			// If page is closed, don't try other strategies - throw immediately
			if (
				error.message?.includes('Target page, context or browser has been closed') ||
				error.message?.includes('Page closed') ||
				error.message?.includes('Browser closed')
			) {
				throw new Error(`Page was closed while waiting for todo "${todoText}": ${error.message}`);
			}
			lastError = error;
			// Try next strategy
			continue;
		}
	}

	// If all strategies failed, throw the last error
	throw lastError || new Error(`Todo "${todoText}" not found after ${adjustedTimeout}ms`);
}

/**
 * Helper to handle WebAuthn setup modal (skip it for tests)
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=5000] - Timeout in milliseconds to wait for modal
 */
export async function handleWebAuthnModal(page, timeout = 5000) {
	console.log('🔍 Checking for WebAuthn setup modal...');

	try {
		// Wait for WebAuthn modal to appear (with short timeout)
		await page.waitForSelector('[data-testid="webauthn-setup-modal"]', {
			state: 'attached',
			timeout
		});

		console.log('✅ WebAuthn setup modal found, skipping...');

		// Click the "Skip for Now" button
		const skipButton = page.getByRole('button', { name: /Skip for Now/i });
		if (await skipButton.isVisible({ timeout: 2000 }).catch(() => false)) {
			await skipButton.click();
			console.log('✅ Clicked "Skip for Now" button');
		} else {
			// Try alternative buttons if Skip is not available
			const continueButton = page.getByRole('button', { name: /Continue/i });
			if (await continueButton.isVisible({ timeout: 2000 }).catch(() => false)) {
				await continueButton.click();
				console.log('✅ Clicked "Continue" button');
			}
		}

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="webauthn-setup-modal"]')).not.toBeVisible({
			timeout: 5000
		});
		console.log('✅ WebAuthn modal dismissed');
	} catch (error) {
		// Modal didn't appear - this is fine, it might not show in all scenarios
		console.log('ℹ️ WebAuthn modal did not appear (expected in many cases)');
	}
}
