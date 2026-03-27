import { runInitialGlobalSetup } from './relay-e2e-server.mjs';

export default async function globalSetup() {
	await runInitialGlobalSetup(process.cwd());
}
