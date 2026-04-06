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
# 4. (Optional) If you want to publish under a DNSLink, ensure your DNS provider
#    points the desired domain TXT record to your IPNS key.
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
IPNS_KEY="k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs"
IPNS_NAME="simple-todo.le-space.de"
IPFS_SERVER="ipfs.le-space.de"

# Bump version automatically (patch level) and build the project
npm version patch
npm run build

# --- Local Kubo: detect daemon before ipfs add (default ports: API 5001, gateway 8080, swarm 4001 tcp/udp)
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

# Add build/ to the local IPFS node (requires a running daemon for typical Kubo setups)
output=$(ipfs add -r build/)

# Extract the CID using awk or cut
cid=$(echo "$output" | tail -n 1 | awk '{print $2}')
printf '\n'
echo "latest IPFS CID: $cid"
echo "Public gateway URLs:"
echo "  https://${cid}.ipfs.dweb.link"
echo "  https://ipfs.io/ipfs/${cid}"

# Update README immutable IPFS CID references as soon as we know the CID (do not depend on Storacha/SSH/IPNS).
# Do not rewrite /ipns/... links — IPNS names stay as documented.
# Covers: shields badge, https://<cid>.ipfs.dweb.link, and /ipfs/... path segments (not /ipns/).
sed -i.bak \
	-e "s|https://img.shields.io/badge/IPFS-[a-zA-Z0-9]*-brightgreen|https://img.shields.io/badge/IPFS-${cid}-brightgreen|g" \
	-e "s|https://[a-zA-Z0-9]\{20,\}\.ipfs\.dweb\.link|https://${cid}.ipfs.dweb.link|g" \
	-e "s|/ipfs/[^/\"'[:space:]]*|/ipfs/${cid}|g" \
	README.md
rm -f README.md.bak

# Upload the same build to Storacha (CLI must be installed; see https://storacha.network ).
# Network/TLS issues here must not block IPNS, pinning, or README updates.
# if storacha up build; then
# 	echo "Storacha upload finished successfully (storacha up build)."
# else
# 	echo "Storacha upload failed or skipped (storacha up build). Local IPFS add and README CID update already applied." >&2
# fi

# Run the ipfs name publish command with the extracted CID
ipfs name publish --key=$IPNS_NAME /ipfs/$cid
echo "IPFS name $IPNS_NAME updated with CID $cid"

# Pin the CID to ipfs.le-space.de (runuser: ipfs user may have nologin; su fails with "account not available")
ssh root@$IPFS_SERVER "runuser -u ipfs -- ipfs pin add $cid"
echo "IPFS CID $cid pinned to $IPFS_SERVER"


# echo the result of name resolve should be the same as the cid
result=$(ssh root@$IPFS_SERVER "runuser -u ipfs -- ipfs name resolve --nocache /ipns/$IPNS_KEY" | tr -d '\r' | tr -d '\n')

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

# Git commands
# git add vercel.json
git add README.md
git commit -m "Update IPFS CID to $cid for version $version"
git tag -a "v$version" -m "Version $version"
git push origin main
git push origin --tags

echo "Changes committed and pushed to GitHub. Tagged as v$version"

read -p "Do you want to update the production Nginx config with the new CID? (yes/no): " answer
if [[ "$answer" == "yes" ]]; then
    ssh root@le-space.de "sed -i 's|proxy_pass https://$IPFS_SERVER/ipfs/[^/]*/;|proxy_pass https://$IPFS_SERVER/ipfs/$cid/;|' /etc/nginx/sites-available/$IPNS_NAME && systemctl reload nginx"
    echo "Nginx config updated with new CID $cid and reloaded for $IPNS_NAME."
else
    echo "Production Nginx config was NOT updated."
fi