// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Interfaces/ILockupContractFactory.sol";
import "./LockupContract.sol";

/*
 * The LockupContractFactory deploys LockupContracts - its main purpose is to keep a registry of valid deployed
 * LockupContracts.
 *
 * This registry is checked by PREONToken when the Liquity deployer attempts to transfer PREON tokens. During the first year
 * since system deployment, the Liquity deployer is only allowed to transfer PREON to valid LockupContracts that have been
 * deployed by and recorded in the LockupContractFactory. This ensures the deployer's PREON can't be traded or staked in the
 * first year, and can only be sent to a verified LockupContract which unlocks at least one year after system deployment.
 *
 * LockupContracts can of course be deployed directly, but only those deployed through and recorded in the LockupContractFactory
 * will be considered "valid" by PREONToken. This is a convenient way to verify that the target address is a genuine
 * LockupContract.
 */

contract LockupContractFactory is
  ILockupContractFactory,
  Ownable,
  CheckContract
{
  using SafeMath for uint256;

  // --- Data ---
  bytes32 public constant NAME = "LockupContractFactory";

  uint256 public constant SECONDS_IN_ONE_YEAR = 31536000;

  address public preonTokenAddress;

  mapping(address => address) public lockupContractToDeployer;

  // --- Events ---

  event PREONTokenAddressSet(address _preonTokenAddress);
  event LockupContractDeployedThroughFactory(
    address _lockupContractAddress,
    address _beneficiary,
    uint256 _unlockTime,
    address _deployer
  );

  // --- Functions ---

  function setPREONTokenAddress(address _preonTokenAddress)
    external
    override
    onlyOwner
  {
    checkContract(_preonTokenAddress);

    preonTokenAddress = _preonTokenAddress;
    emit PREONTokenAddressSet(_preonTokenAddress);

    _renounceOwnership();
  }

  function deployLockupContract(address _beneficiary, uint256 _unlockTime)
    external
    override
  {
    address preonTokenAddressCached = preonTokenAddress;
    _requirePREONAddressIsSet(preonTokenAddressCached);
    LockupContract lockupContract = new LockupContract(
      preonTokenAddressCached,
      _beneficiary,
      _unlockTime
    );

    lockupContractToDeployer[address(lockupContract)] = msg.sender;
    emit LockupContractDeployedThroughFactory(
      address(lockupContract),
      _beneficiary,
      _unlockTime,
      msg.sender
    );
  }

  function isRegisteredLockup(address _contractAddress)
    public
    view
    override
    returns (bool)
  {
    return lockupContractToDeployer[_contractAddress] != address(0);
  }

  // --- 'require'  functions ---
  function _requirePREONAddressIsSet(address _preonTokenAddress) internal pure {
    require(_preonTokenAddress != address(0), "LCF: PREON Address is not set");
  }
}
