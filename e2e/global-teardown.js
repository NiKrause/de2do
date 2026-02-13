import { readFileSync, unlinkSync, existsSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';

export default async function globalTeardown() {
	console.log('🛑 Tearing down global test environment...');

	// Stop web app dev server
	try {
		const webInfoPath = path.join(process.cwd(), 'e2e', 'web-info.json');
		if (existsSync(webInfoPath)) {
			const webInfo = JSON.parse(readFileSync(webInfoPath, 'utf8'));
			if (webInfo.pid) {
				process.kill(webInfo.pid, 'SIGTERM');
				console.log(`✅ Web server (PID ${webInfo.pid}) stopped`);
			}
			unlinkSync(webInfoPath);
		}
	} catch (error) {
		console.warn('⚠️ Error stopping web server:', error.message);
	}

	// Stop relay server
	try {
		const relayInfoPath = path.join(process.cwd(), 'e2e', 'relay-info.json');
		if (existsSync(relayInfoPath)) {
			const relayInfo = JSON.parse(readFileSync(relayInfoPath, 'utf8'));
			if (relayInfo.pid) {
				process.kill(relayInfo.pid, 'SIGTERM');
				console.log(`✅ Relay server (PID ${relayInfo.pid}) stopped`);
			}
			unlinkSync(relayInfoPath);
		}
	} catch (error) {
		console.warn('⚠️ Error stopping relay server:', error.message);
	}

	// Clean up test datastore to avoid lock issues
	const testDatastorePath = path.join(process.cwd(), 'relay', 'test-relay-datastore');
	if (existsSync(testDatastorePath)) {
		try {
			await rm(testDatastorePath, { recursive: true, force: true });
			console.log('✅ Test datastore cleaned up');
		} catch (error) {
			console.warn('⚠️ Could not clean up test datastore:', error.message);
		}
	}

	// Kill any processes that might be holding ports
	try {
		const { exec } = await import('child_process');
		const { promisify } = await import('util');
		const execAsync = promisify(exec);
		await execAsync(
			'lsof -ti:4101,4102,4103,4106,3000,4174 2>/dev/null | xargs kill -9 2>/dev/null || true'
		);
	} catch {
		// Ignore errors - ports might not be in use
	}

	console.log('✅ Global teardown complete');
}
