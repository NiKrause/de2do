// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TodoEscrow.sol";

contract DeployEscrow is Script {
  function run() external returns (TodoEscrow escrow) {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(deployerKey);
    address initialFeeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
    uint16 initialFeeBps = uint16(vm.envOr("FEE_BPS", uint256(0)));
    vm.startBroadcast(deployerKey);
    escrow = new TodoEscrow(deployer, initialFeeRecipient, initialFeeBps);
    vm.stopBroadcast();
  }
}
