#!/usr/bin/env bash
# Deploy TodoEscrow + optional MockOpenfort7702Implementation to Ethereum Sepolia.
# USDT: use public Sepolia test USDT in `.env.sepolia.example` (not deployed by this script).
#
# Prerequisites:
#   - forge (Foundry)
#   - Deployer wallet with Sepolia ETH
#
# Usage:
#   export PRIVATE_KEY=0x...          # deployer
#   export SEPOLIA_RPC_URL=https://... # or VITE_RPC_URL
#   ./scripts/deploy-sepolia.sh
#
# Optional:
#   export FEE_RECIPIENT=0x...        # default: deployer
#   export FEE_BPS=0                  # default in script: 1500 (15%); set 0 to disable fee
#   export SKIP_MOCK_IMPLEMENTATION=1 # do not deploy mock 7702 impl (use Openfort implementation)
#   export ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108  # default v0.8
#   export ETHERSCAN_API_KEY=...     # adds --verify to forge (contract verification on Sepolia)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RPC_URL="${SEPOLIA_RPC_URL:-${VITE_RPC_URL:-}}"
if [[ -z "${RPC_URL}" ]]; then
	echo "Set SEPOLIA_RPC_URL or VITE_RPC_URL (e.g. https://ethereum-sepolia.publicnode.com)" >&2
	exit 1
fi

if [[ -z "${PRIVATE_KEY:-}" ]]; then
	echo "Set PRIVATE_KEY for the deployer wallet (hex, with or without 0x)." >&2
	exit 1
fi

export ENTRY_POINT_ADDRESS="${ENTRY_POINT_ADDRESS:-0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108}"

VERIFY_ARGS=()
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
	VERIFY_ARGS=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
fi

forge script contracts/script/DeploySepolia.s.sol:DeploySepolia \
	--rpc-url "$RPC_URL" \
	--broadcast \
	-vvv \
	"${VERIFY_ARGS[@]}"
