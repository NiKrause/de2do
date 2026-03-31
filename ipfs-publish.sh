#!/bin/bash
# -----------------------------------------------------------------------------
# How to add a new IPNS_NAME and key locally:
#
# 1. Generate a new IPNS key (replace <your-key-name> with your desired name):
#      ipfs key gen <your-key-name>
#
#    This will output a new key and store it in your local IPFS keystore.
#
# 2. List your keys to find the PeerID (IPNS key) for your new key:
#      ipfs key list -l
#
#    The output will look like:
#      Qm... <your-key-name>
#
#    The long string (PeerID) is your IPNS_KEY, and <your-key-name> is your IPNS_NAME.
#
# 3. Update the script variables below:
#      IPNS_KEY="<PeerID from step 2>"
#      IPNS_NAME="<your-key-name>"
#
# 4. After publish, the script can prompt to patch Nginx on le-space.de so
#    proxy_pass points at the new CID (sites-available/$IPNS_NAME, e.g. de2do.xyz).
#    Optional Cloudflare DNSLink update is kept below but commented out; use
#    scripts/cloudflare-dnslink.sh manually if needed.
#
#    IPNS / DNSLink verification:
#
#    To verify the DNSLink TXT record with dig (replace with your domain if needed):
#      dig +short TXT _dnslink.$IPNS_NAME
#    Or query a specific resolver:
#      dig @1.1.1.1 +short TXT _dnslink.$IPNS_NAME
#    Expected output contains one of:
#      "dnslink=/ipns/$IPNS_KEY"
#      "dnslink=/ipfs/<CID>"
#
# -----------------------------------------------------------------------------
# Configurable variables
IPNS_KEY="k51qzi5uqu5dhkz74iq3k4asoqnjdccgaad6lkk94j7rkfowrdhnxifz7dosm1"
IPNS_NAME="de2do.xyz"
IPFS_SERVER="ipfs.le-space.de"

# Bump version automatically (patch level) and build the project
npm version patch
npm run build
# Run the ipfs add command and capture the output
output=$(ipfs add -r build/)

# Extract the CID using awk or cut
cid=$(echo "$output" | tail -n 1 | awk '{print $2}')
echo "latest IPFS CID $cid"

# Run the ipfs name publish command with the extracted CID
ipfs name publish --key=$IPNS_NAME /ipfs/$cid
echo "IPFS name $IPNS_NAME updated with CID $cid"

# Pin the directory CID recursively on ipfs.le-space.de (SSH → Kubo)
ssh -t root@$IPFS_SERVER "su ipfs -c 'ipfs pin add -r $cid'"
echo "IPFS CID $cid pinned recursively to $IPFS_SERVER"


# echo the result of name resolve should be the same as the cid
result=$(ssh -t root@$IPFS_SERVER "su ipfs -c 'ipfs name resolve --nocache /ipns/$IPNS_KEY'" | tr -d '\r' | tr -d '\n')

# Debug with hexdump to see exactly what characters we're getting
echo "Result raw:"
echo "$result" | hexdump -C
echo "CID raw:"
echo "$cid" | hexdump -C

if [ "$result" == "/ipfs/$cid" ]; then
    echo "$(tput setaf 2)IPFS name resolve result matches CID $cid$(tput sgr0)"
else
    echo "$(tput setaf 1)IPFS name resolve result does not match CID $cid$(tput sgr0)"
fi


# echo "IPFS PIN added to follow ipns"
# Get the current version from package.json
version=$(node -p "require('./package.json').version")

# Replace all /ipns/ and /ipfs/ links in README.md with the current /ipfs/CID
# Replace /ipns/... with /ipfs/$cid (matches /ipns/ followed by any non-whitespace, quote, or slash)
sed -i.bak "s|/ipns/[^/\"'[:space:]]*|/ipfs/$cid|g" README.md
# Replace /ipfs/... with /ipfs/$cid (matches /ipfs/ followed by any non-whitespace, quote, or slash)
sed -i.bak "s|/ipfs/[^/\"'[:space:]]*|/ipfs/$cid|g" README.md
# Remove backup file created by sed
rm -f README.md.bak

# Git commands
# git add vercel.json
git add README.md
git commit -m "Update IPFS CID to $cid for version $version"
git tag -a "v$version" -m "Version $version"
git push origin main
git push origin --tags

echo "Changes committed and pushed to GitHub. Tagged as v$version"

read -p "Do you want to update the production Nginx config on le-space.de with the new CID? (yes/no): " answer
if [[ "$answer" == "yes" ]]; then
	ssh root@le-space.de "sed -i 's|proxy_pass https://$IPFS_SERVER/ipfs/[^/]*/;|proxy_pass https://$IPFS_SERVER/ipfs/$cid/;|' /etc/nginx/sites-available/$IPNS_NAME && systemctl reload nginx"
	echo "Nginx config updated with new CID $cid and reloaded for $IPNS_NAME."
else
	echo "Production Nginx config was NOT updated."
fi

# --- Optional: Cloudflare DNSLink (TXT _dnslink) — uncomment to prompt after publish ---
# REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# _saved_cf_token="${CLOUDFLARE_API_TOKEN-}"
# _saved_cf_zone="${CLOUDFLARE_ZONE_ID-}"
# _saved_cf_zonename="${CLOUDFLARE_ZONE_NAME-}"
# if [[ -f "$REPO_ROOT/.env" ]]; then
# 	set -a
# 	# shellcheck disable=SC1091
# 	source "$REPO_ROOT/.env"
# 	set +a
# 	CLOUDFLARE_API_TOKEN="${_saved_cf_token:-$CLOUDFLARE_API_TOKEN}"
# 	CLOUDFLARE_ZONE_ID="${_saved_cf_zone:-$CLOUDFLARE_ZONE_ID}"
# 	CLOUDFLARE_ZONE_NAME="${_saved_cf_zonename:-$CLOUDFLARE_ZONE_NAME}"
# fi
# read -p "Update Cloudflare DNSLink for de2do.xyz (TXT _dnslink) to this CID? (yes/no): " answer
# if [[ "$answer" == "yes" ]]; then
# 	if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
# 		echo "Set CLOUDFLARE_API_TOKEN for the de2do.xyz zone (.env or env; zone id is optional — see scripts/cloudflare-dnslink.sh)." >&2
# 	else
# 		"$REPO_ROOT/scripts/cloudflare-dnslink.sh" "$cid"
# 	fi
# else
# 	echo "Cloudflare DNSLink was NOT updated."
# fi
