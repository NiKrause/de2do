// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../MockOpenfort7702Implementation.sol";
import "../TodoEscrow.sol";

/// @notice One-shot Sepolia testnet deploy: `TodoEscrow` + optional `MockOpenfort7702Implementation`.
///
/// USDT is **not** deployed here — use the public Sepolia test USDT in `.env.sepolia.example`
/// (`VITE_USDT_ADDRESS`) or any ERC-20 you control.
///
/// Env (required):
/// - `PRIVATE_KEY` — hex private key of the deployer (with Sepolia ETH).
///
/// Env (optional):
/// - `ENTRY_POINT_ADDRESS` — ERC-4337 v0.8 EntryPoint (default: canonical v0.8).
/// - `FEE_RECIPIENT` — TodoEscrow fee recipient (default: deployer).
/// - `FEE_BPS` — fee basis points out of 10_000 (default: 1500 = 15%).
/// - `SKIP_MOCK_IMPLEMENTATION` — if `1`, skip MockOpenfort7702Implementation (use Openfort’s
///   `VITE_IMPLEMENTATION_CONTRACT` on Sepolia instead). **Warning:** mock is dev-only; not for production.
contract DeploySepolia is Script {
  /// @dev Default 15% TodoEscrow fee. Override with `FEE_BPS` (e.g. `0` to disable).
  uint256 internal constant DEFAULT_FEE_BPS = 1500;

  /// @dev Canonical EntryPoint v0.8 — same on Sepolia as mainnet (see Openfort entity addresses).
  address internal constant DEFAULT_ENTRY_POINT_V08 = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

  /// @dev Common public “Test Tether USD” on Sepolia (6 decimals), Etherscan-verified — not mainnet USDT.
  address internal constant SUGGESTED_VITE_USDT_ADDRESS =
    0x7169D38820dfd117C3FA1f22a697dBA58d90BA06;

  function run() external {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(deployerKey);

    address entryPoint = vm.envOr("ENTRY_POINT_ADDRESS", DEFAULT_ENTRY_POINT_V08);
    address initialFeeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
    uint16 initialFeeBps = uint16(vm.envOr("FEE_BPS", DEFAULT_FEE_BPS));

    bool skipImpl = vm.envOr("SKIP_MOCK_IMPLEMENTATION", uint256(0)) != 0;

    vm.startBroadcast(deployerKey);

    address implAddr;
    if (!skipImpl) {
      MockOpenfort7702Implementation implementation = new MockOpenfort7702Implementation(entryPoint);
      implAddr = address(implementation);
    }

    TodoEscrow escrow = new TodoEscrow(deployer, initialFeeRecipient, initialFeeBps);

    vm.stopBroadcast();

    console.log("--- Sepolia deployment (addresses for .env.sepolia) ---");
    console.log("VITE_CHAIN_ID=11155111");
    console.log("VITE_USDT_ADDRESS=", SUGGESTED_VITE_USDT_ADDRESS);
    console.log("(use public Sepolia test USDT above; or set another ERC-20)");
    if (!skipImpl) {
      console.log("VITE_IMPLEMENTATION_CONTRACT=", implAddr);
    } else {
      console.log("VITE_IMPLEMENTATION_CONTRACT=(skipped - set Openfort Sepolia implementation)");
    }
    console.log("VITE_ENTRY_POINT_ADDRESS=", entryPoint);
    console.log("VITE_ESCROW_CONTRACT=", address(escrow));
    console.log("---");
    console.log("EntryPoint used:", entryPoint);
    console.log("Deployer:", deployer);
  }
}
