#!/usr/bin/env node
/**
 * BrowserStack Local tunnel management script
 */

import 'dotenv/config';
import browserstack from 'browserstack-local';

class BrowserStackLocal {
	constructor() {
		this.bs_local = new browserstack.Local();
		this.isConnected = false;
	}

	async start() {
		return new Promise((resolve, reject) => {
			if (!process.env.BROWSERSTACK_ACCESS_KEY) {
				reject(new Error('BROWSERSTACK_ACCESS_KEY environment variable is required'));
				return;
			}

			console.log('🚀 Starting BrowserStack Local tunnel...');

			const options = {
				key: process.env.BROWSERSTACK_ACCESS_KEY,
				verbose: true,
				force: true,
				onlyAutomate: true,
				forceLocal: true
			};

			this.bs_local.start(options, (error) => {
				if (error) {
					console.error('❌ Error starting BrowserStack Local:', error);
					reject(error);
					return;
				}

				this.isConnected = true;
				console.log('✅ BrowserStack Local tunnel started successfully');
				console.log('🔗 Local testing environment is now accessible via BrowserStack');
				resolve();
			});
		});
	}

	async stop() {
		return new Promise((resolve, reject) => {
			if (!this.isConnected) {
				console.log('ℹ️ BrowserStack Local tunnel is not running');
				resolve();
				return;
			}

			console.log('🛑 Stopping BrowserStack Local tunnel...');

			this.bs_local.stop((error) => {
				if (error) {
					console.error('❌ Error stopping BrowserStack Local:', error);
					reject(error);
					return;
				}

				this.isConnected = false;
				console.log('✅ BrowserStack Local tunnel stopped successfully');
				resolve();
			});
		});
	}

	async isRunning() {
		return this.bs_local.isRunning();
	}
}

// CLI handling
const action = process.argv[2];

if (action === 'start') {
	const bsLocal = new BrowserStackLocal();

	bsLocal.start().catch((error) => {
		console.error('Failed to start BrowserStack Local:', error);
		process.exit(1);
	});

	// Handle graceful shutdown
	process.on('SIGINT', async () => {
		console.log('\n🔄 Received SIGINT, shutting down gracefully...');
		try {
			await bsLocal.stop();
			process.exit(0);
		} catch (error) {
			console.error('Error during shutdown:', error);
			process.exit(1);
		}
	});

	process.on('SIGTERM', async () => {
		console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
		try {
			await bsLocal.stop();
			process.exit(0);
		} catch (error) {
			console.error('Error during shutdown:', error);
			process.exit(1);
		}
	});
} else if (action === 'stop') {
	const bsLocal = new BrowserStackLocal();
	bsLocal.stop().catch((error) => {
		console.error('Failed to stop BrowserStack Local:', error);
		process.exit(1);
	});
} else if (action === 'sessions') {
	checkActiveSessions().catch((error) => {
		console.error('Failed to check active sessions:', error);
		process.exit(1);
	});
} else if (action === 'check') {
	isTestRunningOnBrowserStack()
		.then((isRunning) => {
			console.log('Tests running on BrowserStack:', isRunning);
		})
		.catch((error) => {
			console.error('Failed to check BrowserStack status:', error);
			process.exit(1);
		});
} else {
	console.log('Usage: node browserstack-local.js [start|stop|sessions|check]');
	process.exit(1);
}

async function getActiveBrowserStackSessions() {
	const username = process.env.BROWSERSTACK_USERNAME;
	const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;

	if (!username || !accessKey) {
		throw new Error('BrowserStack credentials not found');
	}

	const auth = Buffer.from(`${username}:${accessKey}`).toString('base64');

	try {
		const response = await fetch(
			'https://api.browserstack.com/automate/sessions.json?status=running',
			{
				headers: {
					Authorization: `Basic ${auth}`,
					'Content-Type': 'application/json'
				}
			}
		);

		if (!response.ok) {
			throw new Error(`BrowserStack API error: ${response.status}`);
		}

		const sessions = await response.json();
		return sessions;
	} catch (error) {
		console.error('Failed to fetch BrowserStack sessions:', error);
		return null;
	}
}

async function isTestRunningOnBrowserStack(buildName = null) {
	try {
		const sessions = await getActiveBrowserStackSessions();

		if (!sessions || !Array.isArray(sessions)) {
			return false;
		}

		// If no specific build name, check if any sessions are running
		if (!buildName) {
			return sessions.length > 0;
		}

		// Check for sessions matching the specific build
		return sessions.some(
			(session) =>
				session.build_name === buildName ||
				session.build_name === process.env.BROWSERSTACK_BUILD_NAME
		);
	} catch (error) {
		console.error('Error checking BrowserStack sessions:', error);
		return false;
	}
}

async function checkActiveSessions() {
	const sessions = await getActiveBrowserStackSessions();
	console.log(`Active BrowserStack sessions: ${sessions ? sessions.length : 0}`);

	if (sessions && sessions.length > 0) {
		sessions.forEach((session, index) => {
			console.log(`Session ${index + 1}:`, {
				id: session.hashed_id,
				browser: `${session.browser} ${session.browser_version}`,
				os: `${session.os} ${session.os_version}`,
				status: session.status,
				build: session.build_name
			});
		});
	}

	return sessions;
}

export default BrowserStackLocal;
