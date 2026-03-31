/**
 * DNSLink → IPFS gateway proxy for apex domain (e.g. https://de2do.xyz).
 * Resolves TXT at DNSLINK_NAME via DoH, then proxies to IPFS_GATEWAY.
 *
 * Deploy: cd cloudflare/dnslink-gateway && npx wrangler deploy
 * Then: Workers → Triggers → route de2do.xyz/* to this worker (orange proxy on DNS).
 */

const DOH_URL = 'https://cloudflare-dns.com/dns-query';

/** @param {Headers} h */
function forwardableHeaders(h) {
	const out = new Headers();
	const pass = ['accept', 'accept-encoding', 'accept-language', 'range', 'if-none-match', 'if-modified-since'];
	for (const k of pass) {
		const v = h.get(k);
		if (v) out.set(k, v);
	}
	out.set('user-agent', h.get('user-agent') || 'de2do-dnslink-worker/1');
	return out;
}

/** @param {Request} request */
function wantsHtml(request) {
	const accept = request.headers.get('Accept') || '';
	return accept.includes('text/html');
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function looksLikeAssetPath(pathname) {
	return /\.[a-z0-9]+$/i.test(pathname);
}

/**
 * @param {string} dnslinkName e.g. _dnslink.de2do.xyz
 * @returns {Promise<string|null>} e.g. /ipfs/Qm... or /ipns/k51...
 */
async function resolveDnslink(dnslinkName) {
	const u = new URL(DOH_URL);
	u.searchParams.set('name', dnslinkName);
	u.searchParams.set('type', 'TXT');

	const r = await fetch(u.toString(), {
		headers: { accept: 'application/dns-json' }
	});
	if (!r.ok) {
		throw new Error(`DoH HTTP ${r.status}`);
	}
	const j = await r.json();
	const answers = j.Answer || [];

	for (const a of answers) {
		if (a.type !== 16) {
			continue;
		}
		let data = a.data;
		if (typeof data !== 'string') {
			continue;
		}
		// Wire-style TXT may be quoted fragments; join common case
		data = data.replace(/^"(.*)"$/, '$1');
		const m = data.match(/dnslink=(\/ipfs\/[^\s"]+|\/ipns\/[^\s"]+)/);
		if (m) {
			return m[1];
		}
	}
	return null;
}

/**
 * @param {string} gateway origin without trailing slash
 * @param {string} linkPath /ipfs/CID or /ipns/key
 * @param {string} pathname URL pathname
 * @param {string} search URL search
 */
function buildUpstreamUrl(gateway, linkPath, pathname, search) {
	const p = pathname === '/' ? '' : pathname;
	return `${gateway}${linkPath}${p}${search}`;
}

export default {
	/**
	 * @param {Request} request
	 * @param {{ DNSLINK_NAME?: string; IPFS_GATEWAY?: string }} env
	 */
	async fetch(request, env) {
		const dnslinkName = env.DNSLINK_NAME || '_dnslink.de2do.xyz';
		const gateway = (env.IPFS_GATEWAY || 'https://dweb.link').replace(/\/$/, '');

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method not allowed', { status: 405 });
		}

		const url = new URL(request.url);
		let linkPath;
		try {
			linkPath = await resolveDnslink(dnslinkName);
		} catch (e) {
			return new Response(`DNSLink lookup failed: ${e}`, { status: 502 });
		}

		if (!linkPath) {
			return new Response(`No dnslink TXT found for ${dnslinkName}`, { status: 502 });
		}

		const upstream = buildUpstreamUrl(gateway, linkPath, url.pathname, url.search);
		let res = await fetch(upstream, {
			method: request.method,
			headers: forwardableHeaders(request.headers),
			redirect: 'follow'
		});

		// SvelteKit static + fallback: serve index.html for client-side routes
		if (
			res.status === 404 &&
			request.method === 'GET' &&
			wantsHtml(request) &&
			!looksLikeAssetPath(url.pathname)
		) {
			const m = linkPath.match(/^\/ipfs\/([^/?#]+)/);
			if (m) {
				const cid = m[1];
				const fallback = `${gateway}/ipfs/${cid}/index.html${url.search}`;
				const r2 = await fetch(fallback, {
					method: 'GET',
					headers: forwardableHeaders(request.headers),
					redirect: 'follow'
				});
				if (r2.ok) {
					res = r2;
				}
			}
		}

		const headers = new Headers(res.headers);
		// Avoid leaking gateway quirks; keep content-type from upstream
		headers.delete('set-cookie');

		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers
		});
	}
};
