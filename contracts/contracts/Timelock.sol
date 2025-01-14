pragma solidity 0.6.11;

import "./Dependencies/SafeMath.sol";

contract Timelock {
  using SafeMath for uint256;

  event NewAdmin(address indexed newAdmin);
  event NewPendingAdmin(address indexed newPendingAdmin);
  event CancelTransaction(
    bytes32 indexed txHash,
    address indexed target,
    uint256 value,
    string signature,
    bytes data,
    uint256 eta
  );
  event ExecuteTransaction(
    bytes32 indexed txHash,
    address indexed target,
    uint256 value,
    string signature,
    bytes data,
    uint256 eta
  );
  event QueueTransaction(
    bytes32 indexed txHash,
    address indexed target,
    uint256 value,
    string signature,
    bytes data,
    uint256 eta
  );

  uint256 public immutable GRACE_PERIOD;
  uint256 public immutable MINIMUM_DELAY;

  address public admin;
  address public pendingAdmin;

  mapping(bytes32 => bool) public queuedTransactions;

  constructor(
    address _admin,
    uint256 _minDelay,
    uint256 _gracePeriod
  ) public {
    admin = _admin;
    MINIMUM_DELAY = _minDelay;
    GRACE_PERIOD = _gracePeriod;
  }

  function acceptAdmin() public {
    require(
      msg.sender == pendingAdmin,
      "Timelock::acceptAdmin: Call must come from pendingAdmin."
    );
    admin = msg.sender;
    pendingAdmin = address(0);

    emit NewAdmin(admin);
  }

  function setPendingAdmin(address _pendingAdmin) public {
    require(
      msg.sender == admin,
      "Timelock::setPendingAdmin: Call must come from admin."
    );
    pendingAdmin = _pendingAdmin;

    emit NewPendingAdmin(pendingAdmin);
  }

  function queueTransaction(
    address _target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 eta
  ) public returns (bytes32) {
    require(
      msg.sender == admin,
      "Timelock::queueTransaction: Call must come from admin."
    );
    require(
      eta >= getBlockTimestamp().add(MINIMUM_DELAY),
      "Timelock::queueTransaction: Estimated execution block must satisfy MINIMUM_DELAY."
    );

    bytes32 txHash = keccak256(
      abi.encode(_target, value, signature, data, eta)
    );
    queuedTransactions[txHash] = true;

    emit QueueTransaction(txHash, _target, value, signature, data, eta);
    return txHash;
  }

  function cancelTransaction(
    address _target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 eta
  ) public {
    require(
      msg.sender == admin,
      "Timelock::cancelTransaction: Call must come from admin."
    );

    bytes32 txHash = keccak256(
      abi.encode(_target, value, signature, data, eta)
    );
    queuedTransactions[txHash] = false;

    emit CancelTransaction(txHash, _target, value, signature, data, eta);
  }

  function executeTransaction(
    address _target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 eta
  ) public payable returns (bytes memory) {
    require(
      msg.sender == admin,
      "Timelock::executeTransaction: Call must come from admin."
    );

    bytes32 txHash = keccak256(
      abi.encode(_target, value, signature, data, eta)
    );
    require(
      queuedTransactions[txHash],
      "Timelock::executeTransaction: Transaction hasn't been queued."
    );
    require(
      getBlockTimestamp() >= eta,
      "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
    );
    require(
      getBlockTimestamp() <= eta.add(GRACE_PERIOD),
      "Timelock::executeTransaction: Transaction is stale."
    );

    queuedTransactions[txHash] = false;

    bytes memory callData;

    if (bytes(signature).length == 0) {
      callData = data;
    } else {
      callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
    }

    // solium-disable-next-line security/no-call-value
    (bool success, bytes memory returnData) = _target.call{value: value}(
      callData
    );
    require(
      success,
      "Timelock::executeTransaction: Transaction execution reverted."
    );

    emit ExecuteTransaction(txHash, _target, value, signature, data, eta);

    return returnData;
  }

  // TODO: can be made internal. Just public for now for testing purpose
  function getBlockTimestamp() public view returns (uint256) {
    // solium-disable-next-line security/no-block-members
    return block.timestamp;
  }
}
