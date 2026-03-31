#!/usr/bin/env bash
# Update Cloudflare TXT DNSLink to point at an IPFS CID (e.g. _dnslink.de2do.xyz).
#
# Required env:
#   CLOUDFLARE_API_TOKEN — API token with Zone → DNS → Edit for de2do.xyz
#
# Zone (pick one):
#   CLOUDFLARE_ZONE_ID   — hex id from Dashboard → domain → Overview → Zone ID; or
#   CLOUDFLARE_ZONE_NAME — domain, e.g. de2do.xyz (script calls GET /zones?name=... to resolve id).
#   If neither is set, CLOUDFLARE_ZONE_NAME defaults to de2do.xyz.
#   Note: name lookup needs permission to list zones (Zone → Zone → Read). If the token is
#   scoped very narrowly, set CLOUDFLARE_ZONE_ID manually instead.
#
# Optional (defaults suit de2do.xyz):
#   DNSLINK_TXT_FQDN  — full TXT record name for lookups (default: _dnslink.de2do.xyz)
#   DNSLINK_TXT_LABEL — record name when creating (subdomain under zone; default: _dnslink)
#
# Usage:
#   ./scripts/cloudflare-dnslink.sh <cid>
# Credentials: export CLOUDFLARE_* or add them to the repo-root .env file.
# Shell exports override values from .env.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_saved_token="${CLOUDFLARE_API_TOKEN-}"
_saved_zone="${CLOUDFLARE_ZONE_ID-}"
_saved_zonename="${CLOUDFLARE_ZONE_NAME-}"
_saved_fqdn="${DNSLINK_TXT_FQDN-}"
_saved_label="${DNSLINK_TXT_LABEL-}"
if [[ -f "$REPO_ROOT/.env" ]]; then
	set -a
	# shellcheck disable=SC1091
	source "$REPO_ROOT/.env"
	set +a
fi
CLOUDFLARE_API_TOKEN="${_saved_token:-$CLOUDFLARE_API_TOKEN}"
CLOUDFLARE_ZONE_ID="${_saved_zone:-$CLOUDFLARE_ZONE_ID}"
CLOUDFLARE_ZONE_NAME="${_saved_zonename:-${CLOUDFLARE_ZONE_NAME-}}"
DNSLINK_TXT_FQDN="${_saved_fqdn:-${DNSLINK_TXT_FQDN-}}"
DNSLINK_TXT_LABEL="${_saved_label:-${DNSLINK_TXT_LABEL-}}"

cid="${1:?Usage: $0 <ipfs-cid>}"
token="${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN or add CLOUDFLARE_API_TOKEN to .env}"

if [[ -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
	zone_id="$CLOUDFLARE_ZONE_ID"
else
	lookup_name="${CLOUDFLARE_ZONE_NAME:-de2do.xyz}"
	echo "Resolving Cloudflare zone id for '${lookup_name}' (GET /zones)…"
	zones_json=$(curl -fsS -G "https://api.cloudflare.com/client/v4/zones" \
		--data-urlencode "name=${lookup_name}" \
		-H "Authorization: Bearer ${token}" \
		-H "Content-Type: application/json")
	zone_id=$(python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
rows = d.get('result') or []
if not rows:
    err = d.get('errors') or [{'message': 'no matching zone'}]
    sys.stderr.write('Cloudflare: no zone for this name. Set CLOUDFLARE_ZONE_ID in .env or fix token permissions. Errors: %s\n' % (err,))
    sys.exit(1)
print(rows[0]['id'])
" <<<"$zones_json")
fi
txt_fqdn="${DNSLINK_TXT_FQDN:-_dnslink.de2do.xyz}"
txt_label="${DNSLINK_TXT_LABEL:-_dnslink}"
content="dnslink=/ipfs/${cid}"

api="https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records"

list_json=$(curl -fsS -G "$api" \
	--data-urlencode "type=TXT" \
	--data-urlencode "name=${txt_fqdn}" \
	-H "Authorization: Bearer ${token}" \
	-H "Content-Type: application/json")

record_id=$(python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
rows = d.get('result') or []
for row in rows:
    c = row.get('content') or ''
    if c.startswith('dnslink=/ipfs/') or c.startswith('dnslink=/ipns/'):
        print(row['id'])
        sys.exit(0)
if rows:
    print(rows[0]['id'])
" <<<"$list_json")

if [[ -z "${record_id:-}" ]]; then
	echo "No TXT record found for '${txt_fqdn}' — creating '${txt_label}'."
	create_json=$(TXT_LABEL="$txt_label" CONTENT="$content" python3 -c "
import json, os
print(json.dumps({
    'type': 'TXT',
    'name': os.environ['TXT_LABEL'],
    'content': os.environ['CONTENT'],
    'ttl': 300,
    'proxied': False
}))
")
	resp=$(curl -fsS -X POST "$api" \
		-H "Authorization: Bearer ${token}" \
		-H "Content-Type: application/json" \
		-d "$create_json")
else
	echo "Updating DNS record ${record_id} (${txt_fqdn}) → ${content}"
	patch_json=$(CONTENT="$content" python3 -c "import json, os; print(json.dumps({'content': os.environ['CONTENT']}))")
	resp=$(curl -fsS -X PATCH "${api}/${record_id}" \
		-H "Authorization: Bearer ${token}" \
		-H "Content-Type: application/json" \
		-d "$patch_json")
fi

python3 -c "import json,sys; r=json.loads(sys.stdin.read()); sys.exit(0 if r.get('success') else 1)" <<<"$resp"

echo "Cloudflare DNSLink updated: ${content}"
echo "Verify: dig +short TXT ${txt_fqdn} @1.1.1.1"
