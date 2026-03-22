// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TodoEscrow.sol";

contract DeployEscrow is Script {
  function run() external returns (TodoEscrow escrow) {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    vm.startBroadcast(deployerKey);
    escrow = new TodoEscrow();
    vm.stopBroadcast();
  }
}
