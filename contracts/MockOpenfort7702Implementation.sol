// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Dev-only mock implementation for local EIP-7702 + ERC-4337 testing.
/// It mirrors the Openfort-style initialize/execute surface closely enough for
/// app integration work, but intentionally keeps validation permissive so local
/// setup is easy.
/// DO NOT use this contract in production.
///
/// @dev Local note: EIP-7702 type-4 txs must use enough gas for `execute` to run an
/// inner `CALL` (e.g. TodoEscrow). Underestimated gas yields success with no logs;
/// the passkey wallet sets an explicit gas limit on Anvil for bootstrap + delegated calls.
contract MockOpenfort7702Implementation {
  enum KeyType {
    EOA,
    WEBAUTHN,
    P256,
    P256NONKEY
  }

  enum KeyControl {
    Self,
    Custodial
  }

  struct PubKey {
    bytes32 x;
    bytes32 y;
  }

  struct Key {
    PubKey pubKey;
    address eoaAddress;
    KeyType keyType;
  }

  struct KeyData {
    KeyType keyType;
    bool isActive;
    bool masterKey;
    bool isDelegatedControl;
    uint48 validUntil;
    uint48 validAfter;
    uint48 limits;
    bytes key;
  }

  struct KeyDataReg {
    KeyType keyType;
    uint48 validUntil;
    uint48 validAfter;
    uint48 limits;
    bytes key;
    KeyControl keyControl;
  }

  struct Call {
    address target;
    uint256 value;
    bytes data;
  }

  // PackedUserOperation (v0.7/v0.8 layout used by EntryPoint validation calls)
  struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
  }

  bytes32 private constant INIT_TYPEHASH =
    0x82dc6262fca76342c646d126714aa4005dfcd866448478747905b2e7b9837183;
  bytes32 private constant EIP712_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
  bytes32 private constant HASHED_NAME = keccak256("OPF7702Recoverable");
  bytes32 private constant HASHED_VERSION = keccak256("1");

  address public immutable entryPoint;
  bool public initialized;
  mapping(uint256 => bytes32) internal idKeys;
  mapping(bytes32 => KeyData) internal keys;

  constructor(address _entryPoint) {
    require(_entryPoint != address(0), "entryPoint=0");
    entryPoint = _entryPoint;
  }

  modifier onlyAuthorized() {
    require(msg.sender == entryPoint || msg.sender == address(this), "not authorized");
    _;
  }

  receive() external payable {}

  function getDigestToInit(
    KeyDataReg calldata _keyData,
    KeyDataReg calldata _sessionKeyData,
    bytes32 _initialGuardian
  ) public view returns (bytes32 digest) {
    bytes memory keyDataEnc = abi.encode(
      _keyData.keyType,
      _keyData.validUntil,
      _keyData.validAfter,
      _keyData.limits,
      _keyData.key,
      _keyData.keyControl
    );

    bytes memory sessionKeyDataEnc = abi.encode(
      _sessionKeyData.keyType,
      _sessionKeyData.validUntil,
      _sessionKeyData.validAfter,
      _sessionKeyData.limits,
      _sessionKeyData.key,
      _sessionKeyData.keyControl
    );

    bytes32 structHash =
      keccak256(abi.encode(INIT_TYPEHASH, keyDataEnc, sessionKeyDataEnc, _initialGuardian));
    return _hashTypedDataV4(structHash);
  }

  function initialize(
    KeyDataReg calldata _keyData,
    KeyDataReg calldata _sessionKeyData,
    bytes calldata _signature,
    bytes32 _initialGuardian
  ) external {
    _initialGuardian;
    // Keep idempotent for easier local resets.
    require(msg.sender == entryPoint || msg.sender == address(this), "not authorized");
    require(_checkSignature(getDigestToInit(_keyData, _sessionKeyData, _initialGuardian), _signature), "invalid sig");
    _setMasterKey(_keyData);
    if (_sessionKeyData.key.length != 0) {
      registerKey(_sessionKeyData);
    }
    initialized = true;
  }

  function registerKey(KeyDataReg calldata _keyData) public onlyAuthorized {
    bytes32 keyId = _computeKeyId(_keyData.keyType, _keyData.key);
    KeyData storage stored = keys[keyId];
    stored.keyType = _keyData.keyType;
    stored.isActive = true;
    stored.masterKey = false;
    stored.isDelegatedControl = _keyData.keyControl == KeyControl.Custodial;
    stored.validUntil = _keyData.validUntil;
    stored.validAfter = _keyData.validAfter;
    stored.limits = _keyData.limits;
    stored.key = _keyData.key;
  }

  function getKeyById(uint256 _id, KeyType _keyType) external view returns (Key memory) {
    bytes32 keyId = idKeys[_id];
    KeyData storage stored = keys[keyId];
    require(stored.isActive, "key missing");
    require(stored.keyType == _keyType, "wrong keyType");

    if (_keyType == KeyType.EOA) {
      return Key({ pubKey: PubKey({x: bytes32(0), y: bytes32(0)}), eoaAddress: abi.decode(stored.key, (address)), keyType: _keyType });
    }

    (bytes32 x, bytes32 y) = abi.decode(stored.key, (bytes32, bytes32));
    return Key({ pubKey: PubKey({x: x, y: y}), eoaAddress: address(0), keyType: _keyType });
  }

  function execute(address dest, uint256 value, bytes calldata func) external payable onlyAuthorized {
    _call(dest, value, func);
  }

  function executeBatch(Call[] calldata calls) external onlyAuthorized {
    uint256 length = calls.length;
    for (uint256 i = 0; i < length; i++) {
      _call(calls[i].target, calls[i].value, calls[i].data);
    }
  }

  function executeBatch(
    address[] calldata _target,
    uint256[] calldata _value,
    bytes[] calldata _calldata
  ) external payable onlyAuthorized {
    require(_target.length == _value.length && _value.length == _calldata.length, "length mismatch");
    uint256 length = _target.length;
    for (uint256 i = 0; i < length; i++) {
      _call(_target[i], _value[i], _calldata[i]);
    }
  }

  /// @notice Permissive local validator expected by EntryPoint.
  /// Any signature is accepted in this mock, so local bootstrap focuses on
  /// calldata shape and prefund behavior instead of real passkey verification.
  function validateUserOp(PackedUserOperation calldata, bytes32, uint256 missingAccountFunds)
    external
    returns (uint256 validationData)
  {
    require(msg.sender == entryPoint, "not entryPoint");
    if (missingAccountFunds > 0) {
      (bool sent,) = payable(msg.sender).call{value: missingAccountFunds}("");
      require(sent, "fund transfer failed");
    }
    return 0;
  }

  function isValidSignature(bytes32, bytes calldata _signature) external view returns (bytes4) {
    if (_signature.length == 0 || !initialized) return 0xffffffff;
    return 0x1626ba7e;
  }

  function _setMasterKey(KeyDataReg calldata _keyData) internal {
    bytes32 keyId = _computeKeyId(_keyData.keyType, _keyData.key);
    KeyData storage stored = keys[keyId];
    stored.keyType = _keyData.keyType;
    stored.isActive = true;
    stored.masterKey = true;
    stored.isDelegatedControl = _keyData.keyControl == KeyControl.Custodial;
    stored.validUntil = type(uint48).max;
    stored.validAfter = 0;
    stored.limits = 0;
    stored.key = _keyData.key;
    idKeys[0] = keyId;
  }

  function _checkSignature(bytes32 hash, bytes memory signature) internal view returns (bool) {
    // The real Openfort contract expects the recovered signer to equal
    // `address(this)` under 7702 delegation semantics. In local Anvil/override
    // simulation this assumption can differ, so for the dev mock we accept any
    // structurally valid ECDSA signature over the init digest.
    return _recover(hash, signature) != address(0);
  }

  function _computeKeyId(KeyType keyType, bytes memory key) internal pure returns (bytes32) {
    return keccak256(abi.encode(keyType, key));
  }

  function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
    bytes32 domainSeparator = keccak256(
      abi.encode(EIP712_DOMAIN_TYPEHASH, HASHED_NAME, HASHED_VERSION, block.chainid, address(this))
    );
    return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
  }

  function _recover(bytes32 hash, bytes memory signature) internal pure returns (address recovered) {
    require(signature.length == 65, "bad sig length");

    bytes32 r;
    bytes32 s;
    uint8 v;
    assembly {
      r := mload(add(signature, 0x20))
      s := mload(add(signature, 0x40))
      v := byte(0, mload(add(signature, 0x60)))
    }
    if (v < 27) v += 27;
    require(v == 27 || v == 28, "bad sig v");

    recovered = ecrecover(hash, v, r, s);
    require(recovered != address(0), "bad sig");
  }

  function _call(address target, uint256 value, bytes memory data) internal {
    (bool success, bytes memory result) = target.call{value: value}(data);
    if (!success) {
      if (result.length == 0) revert("call failed");
      assembly {
        revert(add(result, 32), mload(result))
      }
    }
  }
}
