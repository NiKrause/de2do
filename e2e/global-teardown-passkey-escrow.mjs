/**
 * Teardown for passkey-escrow E2E: relay, docker AA stack, optional Anvil PID.
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export default async function globalTeardown() {
	console.log('🛑 passkey-escrow global teardown…');

	const relayInfoPath = path.join(ROOT, 'e2e', 'relay-info-passkey.json');
	try {
		if (existsSync(relayInfoPath)) {
			const relayInfo = JSON.parse(readFileSync(relayInfoPath, 'utf8'));
			if (relayInfo.pid) {
				try {
					process.kill(relayInfo.pid, 'SIGTERM');
					console.log(`✅ Stopped relay (PID ${relayInfo.pid})`);
				} catch (e) {
					console.warn('⚠️ Relay kill:', e?.message || e);
				}
			}
			unlinkSync(relayInfoPath);
		}
	} catch (e) {
		console.warn('⚠️ Relay teardown:', e?.message || e);
	}

	const ds = path.join(ROOT, 'relay', 'test-relay-datastore-passkey-e2e');
	if (existsSync(ds)) {
		try {
			await rm(ds, { recursive: true, force: true });
			console.log('✅ Cleaned passkey-e2e relay datastore');
		} catch (e) {
			console.warn('⚠️ Datastore cleanup:', e?.message || e);
		}
	}

	if (process.env.E2E_SKIP_LOCAL_AA_SETUP !== '1') {
		try {
			execSync('docker compose -f docker-compose.aa-local.yml down', {
				cwd: ROOT,
				stdio: 'inherit'
			});
		} catch (e) {
			console.warn(
				'⚠️ docker compose down failed (may be OK if stack was not started):',
				e?.message || e
			);
		}

		const pidPath = path.join(ROOT, 'e2e', '.anvil-passkey.pid');
		if (existsSync(pidPath)) {
			try {
				const pid = Number(readFileSync(pidPath, 'utf8').trim());
				if (Number.isFinite(pid) && pid > 0) {
					try {
						process.kill(pid, 'SIGTERM');
						console.log(`✅ Stopped Anvil (PID ${pid})`);
					} catch {
						// process may already be gone
					}
				}
				unlinkSync(pidPath);
			} catch (e) {
				console.warn('⚠️ Anvil PID teardown:', e?.message || e);
			}
		}
	}

	console.log('✅ passkey-escrow global teardown complete');
}
