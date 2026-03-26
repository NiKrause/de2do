// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TodoEscrow.sol";

contract DeployEscrow is Script {
  /// @dev Default 15% protocol fee (`feeBps` is out of 10_000). Override with `FEE_BPS` (e.g. `0` to disable).
  uint256 internal constant DEFAULT_FEE_BPS = 1500;

  function run() external returns (TodoEscrow escrow) {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(deployerKey);
    address initialFeeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
    uint16 initialFeeBps = uint16(vm.envOr("FEE_BPS", DEFAULT_FEE_BPS));
    vm.startBroadcast(deployerKey);
    escrow = new TodoEscrow(deployer, initialFeeRecipient, initialFeeBps);
    vm.stopBroadcast();
  }
}
