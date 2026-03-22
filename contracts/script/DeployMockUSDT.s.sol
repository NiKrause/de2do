// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../MockUSDT.sol";

contract DeployMockUSDT is Script {
  function run() external returns (MockUSDT token) {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address mintTo = vm.envOr("MINT_TO", address(0));
    uint256 mintAmount = vm.envOr("MINT_AMOUNT", uint256(0));

    vm.startBroadcast(deployerKey);
    token = new MockUSDT();
    if (mintTo != address(0) && mintAmount > 0) {
      token.mint(mintTo, mintAmount);
    }
    vm.stopBroadcast();
  }
}
