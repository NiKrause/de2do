#!/usr/bin/env node
/**
 * One-shot local AA + app contract setup for passkey / escrow dev.
 *
 * Prerequisites: Docker, Foundry (`forge`, `cast`), Node 18+.
 *
 * Does NOT start Anvil by default — run `anvil` in another terminal first
 * (or pass `--start-anvil` to spawn a detached Anvil; you stop it manually).
 *
 * Usage:
 *   node scripts/setup-local-aa.mjs
 *   node scripts/setup-local-aa.mjs --skip-docker    # Anvil + Alto already up
 *   node scripts/setup-local-aa.mjs --skip-forge     # only docker + .env from existing broadcast
 *   node scripts/setup-local-aa.mjs --only-env       # only refresh .env from broadcast/*.json
 *   node scripts/setup-local-aa.mjs --env-file .env.local
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const ENTRY_POINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const ANVIL_DEFAULT_PRIVATE_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const BROADCAST = {
	implementation: path.join(
		ROOT,
		'broadcast/DeployMockOpenfort7702Implementation.s.sol/31337/run-latest.json'
	),
	escrow: path.join(ROOT, 'broadcast/DeployEscrow.s.sol/31337/run-latest.json'),
	usdt: path.join(ROOT, 'broadcast/DeployMockUSDT.s.sol/31337/run-latest.json')
};

function parseArgs(argv) {
	const flags = new Set();
	let envFile = path.join(ROOT, '.env.development');
	let rpcUrl = process.env.ANVIL_RPC_URL || 'http://127.0.0.1:8545';
	let bundlerUrl = process.env.BUNDLER_URL || 'http://127.0.0.1:4337';
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--skip-docker') flags.add('skip-docker');
		else if (a === '--skip-forge') flags.add('skip-forge');
		else if (a === '--only-env') flags.add('only-env');
		else if (a === '--start-anvil') flags.add('start-anvil');
		else if (a === '--write-anvil-pid') flags.add('write-anvil-pid');
		else if (a === '--env-file' && argv[i + 1]) {
			envFile = path.resolve(ROOT, argv[++i]);
		} else if (a === '--rpc-url' && argv[i + 1]) {
			rpcUrl = argv[++i];
		} else if (a === '--bundler-url' && argv[i + 1]) {
			bundlerUrl = argv[++i];
		} else if (a === '--help' || a === '-h') {
			flags.add('help');
		}
	}
	return { flags, envFile, rpcUrl, bundlerUrl };
}

function log(...args) {
	console.log('[setup-local-aa]', ...args);
}

function sh(cmd, opts = {}) {
	log('$', cmd);
	execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

async function rpcCall(url, method, params = []) {
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
	return res.json();
}

async function waitForRpc(rpcUrl, { timeoutMs = 60_000, label = 'RPC' } = {}) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const j = await rpcCall(rpcUrl, 'eth_chainId', []);
			if (j?.result) {
				log(`${label} ready (chainId ${j.result})`);
				return true;
			}
		} catch {
			/* retry */
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

async function waitForBundlerV08(bundlerUrl, { timeoutMs = 120_000 } = {}) {
	const want = ENTRY_POINT_V08.slice(2).toLowerCase();
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const j = await rpcCall(bundlerUrl, 'eth_supportedEntryPoints', []);
			const eps = j?.result || [];
			const ok = eps.some((addr) => String(addr).replace(/^0x/i, '').toLowerCase() === want);
			if (ok) {
				log('Bundler reports EntryPoint v0.8:', ENTRY_POINT_V08);
				return true;
			}
			log('Waiting for bundler to list v0.8 EntryPoint… got:', eps);
		} catch (e) {
			log('Bundler not ready yet:', e.message || e);
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

function readBroadcastAddress(jsonPath, contractName) {
	if (!fs.existsSync(jsonPath)) {
		throw new Error(`Missing broadcast file: ${jsonPath} (run forge with --broadcast first)`);
	}
	const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	const tx = data.transactions?.find((t) => t.contractName === contractName);
	const addr = tx?.contractAddress;
	if (!addr) {
		throw new Error(`No CREATE for ${contractName} in ${jsonPath}`);
	}
	return addr;
}

function mergeEnvFile(envPath, updates) {
	let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
	for (const [key, value] of Object.entries(updates)) {
		const line = `${key}=${value}`;
		const re = new RegExp(`^${key}=.*$`, 'm');
		if (re.test(content)) {
			content = content.replace(re, line);
		} else {
			if (content && !content.endsWith('\n')) content += '\n';
			content += `${line}\n`;
		}
	}
	fs.writeFileSync(envPath, content, 'utf8');
	log('Updated', envPath);
}

function collectAddressesFromBroadcast() {
	return {
		VITE_IMPLEMENTATION_CONTRACT: readBroadcastAddress(
			BROADCAST.implementation,
			'MockOpenfort7702Implementation'
		),
		VITE_ESCROW_CONTRACT: readBroadcastAddress(BROADCAST.escrow, 'TodoEscrow'),
		VITE_USDT_ADDRESS: readBroadcastAddress(BROADCAST.usdt, 'MockUSDT')
	};
}

function printHelp() {
	console.log(`
setup-local-aa.mjs — Anvil (host) + docker-compose.aa-local.yml + Foundry deploys + .env

  1. Start Anvil:  anvil
  2. Run:          pnpm run setup:local-aa
     or:           node scripts/setup-local-aa.mjs --start-anvil

Options:
  --start-anvil     Spawn detached \`anvil\` (stop it yourself when done)
  --write-anvil-pid Write e2e/.anvil-passkey.pid (for Playwright teardown; use with --start-anvil)
  --skip-docker     Skip docker compose (Alto already running)
  --skip-forge      Skip forge broadcast (refresh .env from existing broadcast only)
  --only-env        Only merge VITE_* from broadcast → env file (no docker, no forge)
  --env-file PATH   Default: .env.development
  --rpc-url URL     Default: http://127.0.0.1:8545
  --bundler-url URL Default: http://127.0.0.1:4337

Env:
  PRIVATE_KEY       Deployer (default: Anvil account #0)
  ANVIL_RPC_URL     Same as --rpc-url
`);
}

async function main() {
	const { flags, envFile, rpcUrl, bundlerUrl } = parseArgs(process.argv);
	if (flags.has('help')) {
		printHelp();
		process.exit(0);
	}

	const onlyEnv = flags.has('only-env');
	const skipDocker = onlyEnv || flags.has('skip-docker');
	const skipForge = onlyEnv || flags.has('skip-forge');

	if (flags.has('start-anvil') && !onlyEnv) {
		log('Starting detached Anvil…');
		const proc = spawn('anvil', [], {
			detached: true,
			stdio: 'ignore',
			cwd: ROOT
		});
		if (flags.has('write-anvil-pid')) {
			const pidPath = path.join(ROOT, 'e2e', '.anvil-passkey.pid');
			fs.mkdirSync(path.dirname(pidPath), { recursive: true });
			fs.writeFileSync(pidPath, String(proc.pid), 'utf8');
			log('Wrote Anvil PID to', pidPath);
		}
		proc.unref();
		await new Promise((r) => setTimeout(r, 800));
	}

	if (!onlyEnv) {
		const rpcOk = await waitForRpc(rpcUrl);
		if (!rpcOk) {
			console.error(
				'Anvil RPC not reachable at',
				rpcUrl,
				'\nStart Anvil: anvil\nOr re-run with --start-anvil'
			);
			process.exit(1);
		}
	}

	if (!skipDocker) {
		sh(`docker compose -f docker-compose.aa-local.yml up -d`);
		const bundlerOk = await waitForBundlerV08(bundlerUrl);
		if (!bundlerOk) {
			console.error(
				'Bundler did not report EntryPoint v0.8 in time.\nCheck: docker compose -f docker-compose.aa-local.yml logs alto contract-deployer'
			);
			process.exit(1);
		}
	}

	if (!skipForge) {
		const env = {
			...process.env,
			PRIVATE_KEY: process.env.PRIVATE_KEY || ANVIL_DEFAULT_PRIVATE_KEY,
			ENTRY_POINT_ADDRESS: ENTRY_POINT_V08
		};
		const runForge = (script) => {
			log('$ forge script', script);
			execSync(
				`forge script ${script} --rpc-url ${rpcUrl} --broadcast`,
				{ stdio: 'inherit', cwd: ROOT, env }
			);
		};
		runForge('contracts/script/DeployMockOpenfort7702Implementation.s.sol');
		runForge('contracts/script/DeployEscrow.s.sol');
		runForge('contracts/script/DeployMockUSDT.s.sol');
	}

	const fromBroadcast = collectAddressesFromBroadcast();
	const staticVite = {
		VITE_CHAIN_ID: '31337',
		VITE_RPC_URL: rpcUrl,
		VITE_BUNDLER_URL: bundlerUrl,
		VITE_ENTRY_POINT_ADDRESS: ENTRY_POINT_V08,
		VITE_ENABLE_PAYMASTER: 'false'
	};

	mergeEnvFile(envFile, { ...staticVite, ...fromBroadcast });

	log('Done. Contract addresses:');
	log('  VITE_IMPLEMENTATION_CONTRACT =', fromBroadcast.VITE_IMPLEMENTATION_CONTRACT);
	log('  VITE_ESCROW_CONTRACT         =', fromBroadcast.VITE_ESCROW_CONTRACT);
	log('  VITE_USDT_ADDRESS            =', fromBroadcast.VITE_USDT_ADDRESS);
	log('Restart dev server: pnpm dev');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
