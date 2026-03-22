// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../MockOpenfort7702Implementation.sol";

/// @dev Deploy local Openfort-style 7702 implementation wired to ERC-4337 EntryPoint.
/// Env `ENTRY_POINT_ADDRESS` must be EntryPoint v0.8 (this repo standard):
/// `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` on local Anvil when using docker-compose.aa-local.yml + Alto.
contract DeployMockOpenfort7702Implementation is Script {
  function run() external returns (MockOpenfort7702Implementation implementation) {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address entryPoint = vm.envAddress("ENTRY_POINT_ADDRESS");

    vm.startBroadcast(deployerKey);
    implementation = new MockOpenfort7702Implementation(entryPoint);
    vm.stopBroadcast();
  }
}
