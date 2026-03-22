// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * Minimal escrow for todo payouts.
 * - Alice locks ETH or ERC20 for a todoId.
 * - Alice releases to Bob after off-chain completion + confirmation.
 *
 * NOTE: This contract does not verify WebAuthn signatures.
 * It relies on Alice calling release from her passkey smart account.
 */
contract TodoEscrow {
  struct Escrow {
    address creator;
    address beneficiary;
    address token; // address(0) for ETH
    uint256 amount;
    bool released;
    bool refunded;
    uint64 deadline; // unix timestamp, 0 = no deadline
  }

  mapping(bytes32 => Escrow) public escrows;

  event EscrowLocked(bytes32 indexed todoId, address indexed creator, address indexed beneficiary, address token, uint256 amount, uint64 deadline);
  event EscrowReleased(bytes32 indexed todoId, address indexed beneficiary, address token, uint256 amount);
  event EscrowRefunded(bytes32 indexed todoId, address indexed creator, address token, uint256 amount);

  function lockEth(bytes32 todoId, address beneficiary, uint64 deadline) external payable {
    require(beneficiary != address(0), "beneficiary required");
    require(msg.value > 0, "amount required");
    _lock(todoId, beneficiary, address(0), msg.value, deadline);
  }

  function lockToken(bytes32 todoId, address token, uint256 amount, address beneficiary, uint64 deadline) external {
    require(token != address(0), "token required");
    require(beneficiary != address(0), "beneficiary required");
    require(amount > 0, "amount required");
    _lock(todoId, beneficiary, token, amount, deadline);
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
  }

  function release(bytes32 todoId) external {
    Escrow storage e = escrows[todoId];
    require(e.creator != address(0), "escrow not found");
    require(msg.sender == e.creator, "only creator");
    require(!e.released, "already released");
    require(!e.refunded, "already refunded");
    e.released = true;

    if (e.token == address(0)) {
      (bool ok, ) = e.beneficiary.call{ value: e.amount }("");
      require(ok, "eth transfer failed");
    } else {
      require(IERC20(e.token).transfer(e.beneficiary, e.amount), "transfer failed");
    }

    emit EscrowReleased(todoId, e.beneficiary, e.token, e.amount);
  }

  function refund(bytes32 todoId) external {
    Escrow storage e = escrows[todoId];
    require(e.creator != address(0), "escrow not found");
    require(msg.sender == e.creator, "only creator");
    require(!e.released, "already released");
    require(!e.refunded, "already refunded");
    require(e.deadline != 0 && block.timestamp > e.deadline, "deadline not passed");
    e.refunded = true;

    if (e.token == address(0)) {
      (bool ok, ) = e.creator.call{ value: e.amount }("");
      require(ok, "eth refund failed");
    } else {
      require(IERC20(e.token).transfer(e.creator, e.amount), "refund failed");
    }

    emit EscrowRefunded(todoId, e.creator, e.token, e.amount);
  }

  function _lock(bytes32 todoId, address beneficiary, address token, uint256 amount, uint64 deadline) internal {
    Escrow storage existing = escrows[todoId];
    require(existing.creator == address(0), "todoId already locked");

    escrows[todoId] = Escrow({
      creator: msg.sender,
      beneficiary: beneficiary,
      token: token,
      amount: amount,
      released: false,
      refunded: false,
      deadline: deadline
    });

    emit EscrowLocked(todoId, msg.sender, beneficiary, token, amount, deadline);
  }
}
