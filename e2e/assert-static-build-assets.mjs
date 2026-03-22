/**
 * Fail fast if prerendered HTML references /_app/immutable/* files that are not on disk.
 * Prevents Playwright hanging on a white screen (404 chunks + ERR_CONTENT_LENGTH_MISMATCH noise).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

/** @param {string} html */
function collectImmutableRefs(html) {
	const refs = new Set();
	// script src, link href (stylesheet / modulepreload), etc.
	const re = /(?:src|href)=["'](\/_app\/immutable\/[^"']+)/g;
	let m;
	while ((m = re.exec(html)) !== null) {
		refs.add(m[1]);
	}
	return refs;
}

function listHtmlFiles(dir) {
	/** @type {string[]} */
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...listHtmlFiles(p));
		else if (ent.name.endsWith('.html')) out.push(p);
	}
	return out;
}

export function assertStaticBuildAssets() {
	if (!fs.existsSync(BUILD)) {
		throw new Error(
			'assert-static-build-assets: missing build/ — run `pnpm run build:test` (or rm -rf build .svelte-kit && pnpm run build:test)'
		);
	}

	const htmlFiles = listHtmlFiles(BUILD);
	if (htmlFiles.length === 0) {
		throw new Error('assert-static-build-assets: no .html files under build/');
	}

	/** @type {Set<string>} */
	const allRefs = new Set();
	for (const file of htmlFiles) {
		const html = fs.readFileSync(file, 'utf8');
		for (const ref of collectImmutableRefs(html)) {
			allRefs.add(ref);
		}
	}

	if (allRefs.size === 0) {
		console.warn(
			'[assert-static-build-assets] warning: no /_app/immutable refs in build/**/*.html (unexpected for SvelteKit)'
		);
	}

	const missing = [];
	for (const urlPath of allRefs) {
		const diskPath = path.join(BUILD, urlPath);
		if (!fs.existsSync(diskPath)) {
			missing.push(urlPath);
		}
	}

	if (missing.length > 0) {
		const lines = missing.slice(0, 25).map((p) => `  - ${p}`);
		const more =
			missing.length > 25 ? `\n  … and ${missing.length - 25} more` : '';
		throw new Error(
			`assert-static-build-assets: ${missing.length} file(s) referenced in HTML but missing under build/. ` +
				`Stale .svelte-kit/ or partial build.\n` +
				`Fix: rm -rf build .svelte-kit && pnpm exec svelte-kit sync && pnpm run build:test\n` +
				`${lines.join('\n')}${more}`
		);
	}

	console.log(`[assert-static-build-assets] OK (${allRefs.size} /_app/immutable refs across ${htmlFiles.length} html file(s))`);
}

const invokedDirectly =
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
	assertStaticBuildAssets();
}
