#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Publish build/ to IPFS, IPNS (simple-todo.le-space.de), pin on ipfs.le-space.de,
# and optionally update ONLY nginx for https://simple-todo.le-space.de/
#
# Production nginx uses direct https://<cidv1>.ipfs.dweb.link/ upstream (no /ipfs/Qm
# path-style 301). This script rewrites proxy_pass, proxy_ssl_name, and Host to the
# new ${cid}.ipfs.dweb.link after each release.
#
# Prereqs: local Kubo (ipfs), npm, SSH to root@le-space.de, key ipfs name publish.
# Remote pin/resolve: use runuser (not su) — service user may have nologin shell.
# -----------------------------------------------------------------------------
set -euo pipefail

# --- config (edit if needed) ---
IPNS_KEY="k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs"
IPNS_NAME="simple-todo.le-space.de"
IPFS_SERVER="ipfs.le-space.de"
NGINX_SSH_HOST="le-space.de"
NGINX_SITE_FILE="/etc/nginx/sites-available/simple-todo.le-space.de"

npm version patch
npm run build

LOCAL_IPFS_OK=0
if command -v ipfs >/dev/null 2>&1; then
	if ipfs id >/dev/null 2>&1; then
		LOCAL_IPFS_OK=1
	fi
fi
if [[ "$LOCAL_IPFS_OK" -eq 0 ]] && command -v curl >/dev/null 2>&1; then
	if curl -sf "http://127.0.0.1:5001/api/v0/version" >/dev/null 2>&1; then
		LOCAL_IPFS_OK=1
	fi
fi

if [[ "$LOCAL_IPFS_OK" -eq 1 ]]; then
	echo "Local IPFS daemon detected (API reachable, typically http://127.0.0.1:5001)."
else
	echo "Note: Local IPFS does not appear to be running." >&2
	echo "  Checked: ipfs id, and http://127.0.0.1:5001/api/v0/version" >&2
	echo "  Default Kubo ports: API 5001, gateway 8080, swarm 4001 (tcp/udp). Start with: ipfs daemon" >&2
fi

output=$(ipfs add -r --cid-version 1 build/)
cid=$(echo "$output" | tail -n 1 | awk '{print $2}')

if command -v ipfs >/dev/null 2>&1; then
	cid=$(ipfs cid format -v 1 -b base32lower "$cid" 2>/dev/null || echo "$cid")
fi

dweb_host="${cid}.ipfs.dweb.link"

printf '\n'
echo "latest IPFS CID (v1 base32 for nginx/dweb): $cid"
echo "dweb gateway host for nginx: $dweb_host"
echo "Public gateway URLs:"
echo "  https://${dweb_host}/"
echo "  https://ipfs.io/ipfs/${cid}"

if [[ -f README.md ]]; then
	sed -i.bak \
		-e "s|https://img.shields.io/badge/IPFS-[a-zA-Z0-9]*-brightgreen|https://img.shields.io/badge/IPFS-${cid}-brightgreen|g" \
		-e "s|https://[a-zA-Z0-9]\{20,\}\.ipfs\.dweb\.link|https://${cid}.ipfs.dweb.link|g" \
		-e "s|/ipfs/[^/\"'[:space:]]*|/ipfs/${cid}|g" \
		README.md
	rm -f README.md.bak
fi

ipfs name publish --key="$IPNS_NAME" "/ipfs/$cid"
echo "IPNS name $IPNS_NAME updated with CID $cid"

ssh "root@${IPFS_SERVER}" "runuser -u ipfs -- ipfs pin add ${cid}"
echo "IPFS CID $cid pinned to $IPFS_SERVER"

result=$(ssh "root@${IPFS_SERVER}" "runuser -u ipfs -- ipfs name resolve --nocache /ipns/${IPNS_KEY}" | tr -d '\r' | tr -d '\n')
if [[ "$result" == "/ipfs/$cid" ]]; then
	echo "$(tput setaf 2)IPFS name resolve matches CID $cid$(tput sgr0)"
else
	echo "$(tput setaf 1)IPFS name resolve mismatch: got '$result' expected /ipfs/$cid$(tput sgr0)"
fi

version=$(node -p "require('./package.json').version")
git add README.md 2>/dev/null || true
git commit -m "Update IPFS CID to $cid for version $version" || true
git tag -a "v$version" -m "Version $version"
git push origin main
git push origin --tags

echo "Changes committed and pushed. Tagged as v$version"

read -r -p "Update production nginx for simple-todo.le-space.de only (dweb host ${dweb_host})? (yes/no): " answer
if [[ "$answer" == "yes" ]]; then
	ssh "root@${NGINX_SSH_HOST}" bash -s -- "${dweb_host}" "${NGINX_SITE_FILE}" <<'REMOTE'
set -euo pipefail
H="$1"
F="$2"
[[ -f "$F" ]] || { echo "missing $F" >&2; exit 1; }
sed -i \
	-e "s|proxy_pass https://[^[:space:]]*\.ipfs\.dweb\.link/;|proxy_pass https://${H}/;|g" \
	-e "s|proxy_ssl_name [^[:space:]]*\.ipfs\.dweb\.link;|proxy_ssl_name ${H};|g" \
	-e "s|proxy_set_header Host [^[:space:]]*\.ipfs\.dweb\.link;|proxy_set_header Host ${H};|g" \
	"$F"
nginx -t
systemctl reload nginx
echo "Updated $F to use ${H}"
REMOTE
	echo "Nginx reloaded on ${NGINX_SSH_HOST}."
else
	echo "Production nginx was NOT updated."
fi
