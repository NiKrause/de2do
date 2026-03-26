// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "openzeppelin-contracts/contracts/access/Ownable.sol";
import "../TodoEscrow.sol";
import "../MockUSDT.sol";

contract TodoEscrowTest is Test {
  TodoEscrow escrow;
  MockUSDT usdt;

  address alice = address(0xA11CE);
  address bob = address(0xB0B);
  address feeCollector = address(0xFEE);

  function setUp() public {
    escrow = new TodoEscrow(address(this), feeCollector, 0);
    usdt = new MockUSDT();
    vm.deal(alice, 10 ether);
  }

  function testOwnerCanConfigureFee() public {
    escrow.setFeeConfig(feeCollector, 500);

    assertEq(escrow.feeRecipient(), feeCollector);
    assertEq(escrow.feeBps(), 500);
  }

  function testNonOwnerCannotConfigureFee() public {
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
    escrow.setFeeConfig(feeCollector, 500);
  }

  function testSetFeeBpsRejectsAboveOneHundredPercent() public {
    vm.expectRevert("fee exceeds 100%");
    escrow.setFeeBps(10_001);
  }

  function testFeeRecipientRequiredWhenFeeEnabled() public {
    vm.expectRevert("fee recipient required");
    escrow.setFeeConfig(address(0), 100);
  }

  function testLockEthAndReleaseWithoutFee() public {
    bytes32 todoId = keccak256("todo-1");
    vm.startPrank(alice);
    escrow.lockEth{ value: 1 ether }(todoId, bob, 0);
    escrow.release(todoId);
    vm.stopPrank();

    assertEq(bob.balance, 1 ether);
    assertEq(feeCollector.balance, 0);
  }

  function testLockEthAndReleaseSplitsFee() public {
    bytes32 todoId = keccak256("todo-1-fee");
    escrow.setFeeConfig(feeCollector, 500);

    vm.startPrank(alice);
    escrow.lockEth{ value: 1 ether }(todoId, bob, 0);
    escrow.release(todoId);
    vm.stopPrank();

    assertEq(bob.balance, 0.95 ether);
    assertEq(feeCollector.balance, 0.05 ether);
  }

  function testLockTokenAndReleaseWithoutFee() public {
    bytes32 todoId = keccak256("todo-2");
    usdt.mint(alice, 1_000_000);
    vm.startPrank(alice);
    usdt.approve(address(escrow), 1_000_000);
    escrow.lockToken(todoId, address(usdt), 1_000_000, bob, 0);
    escrow.release(todoId);
    vm.stopPrank();

    assertEq(usdt.balanceOf(bob), 1_000_000);
    assertEq(usdt.balanceOf(feeCollector), 0);
  }

  function testLockTokenAndReleaseSplitsFee() public {
    bytes32 todoId = keccak256("todo-2-fee");
    escrow.setFeeConfig(feeCollector, 500);
    usdt.mint(alice, 1_000_000);
    vm.startPrank(alice);
    usdt.approve(address(escrow), 1_000_000);
    escrow.lockToken(todoId, address(usdt), 1_000_000, bob, 0);
    escrow.release(todoId);
    vm.stopPrank();

    assertEq(usdt.balanceOf(bob), 950_000);
    assertEq(usdt.balanceOf(feeCollector), 50_000);
  }

  function testRefundAfterDeadline() public {
    bytes32 todoId = keccak256("todo-3");
    uint64 deadline = uint64(block.timestamp + 1 days);
    escrow.setFeeConfig(feeCollector, 500);
    vm.startPrank(alice);
    escrow.lockEth{ value: 0.5 ether }(todoId, bob, deadline);
    vm.warp(block.timestamp + 2 days);
    escrow.refund(todoId);
    vm.stopPrank();

    assertEq(alice.balance, 10 ether);
    assertEq(feeCollector.balance, 0);
  }

  function testRefundBeforeDeadlineReverts() public {
    bytes32 todoId = keccak256("todo-4");
    uint64 deadline = uint64(block.timestamp + 1 days);
    vm.startPrank(alice);
    escrow.lockEth{ value: 0.25 ether }(todoId, bob, deadline);
    vm.expectRevert();
    escrow.refund(todoId);
    vm.stopPrank();
  }
}
