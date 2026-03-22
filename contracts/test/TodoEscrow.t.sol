// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../TodoEscrow.sol";
import "../MockUSDT.sol";

contract TodoEscrowTest is Test {
  TodoEscrow escrow;
  MockUSDT usdt;

  address alice = address(0xA11CE);
  address bob = address(0xB0B);

  function setUp() public {
    escrow = new TodoEscrow();
    usdt = new MockUSDT();
    vm.deal(alice, 10 ether);
  }

  function testLockEthAndRelease() public {
    bytes32 todoId = keccak256("todo-1");
    vm.startPrank(alice);
    escrow.lockEth{ value: 1 ether }(todoId, bob, 0);
    escrow.release(todoId);
    vm.stopPrank();

    assertEq(bob.balance, 1 ether);
  }

  function testLockTokenAndRelease() public {
    bytes32 todoId = keccak256("todo-2");
    usdt.mint(alice, 1_000_000);
    vm.startPrank(alice);
    usdt.approve(address(escrow), 1_000_000);
    escrow.lockToken(todoId, address(usdt), 1_000_000, bob, 0);
    escrow.release(todoId);
    vm.stopPrank();

    assertEq(usdt.balanceOf(bob), 1_000_000);
  }

  function testRefundAfterDeadline() public {
    bytes32 todoId = keccak256("todo-3");
    uint64 deadline = uint64(block.timestamp + 1 days);
    vm.startPrank(alice);
    escrow.lockEth{ value: 0.5 ether }(todoId, bob, deadline);
    vm.warp(block.timestamp + 2 days);
    escrow.refund(todoId);
    vm.stopPrank();

    assertEq(alice.balance, 10 ether);
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
