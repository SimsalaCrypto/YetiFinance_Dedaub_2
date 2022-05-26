// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Dependencies/SafeMath.sol";
import "../Dependencies/SafeERC20.sol";
import "../Interfaces/IPREONToken.sol";

/*
 * The lockup contract architecture utilizes a single LockupContract, with an unlockTime. The unlockTime is passed as an argument
 * to the LockupContract's constructor. The contract's balance can be withdrawn by the beneficiary when block.timestamp > unlockTime.
 * At construction, the contract checks that unlockTime is at least one year later than the Liquity system's deployment time.
 */
contract ShortLockupContract {
  using SafeMath for uint256;
  using SafeERC20 for IPREONToken;

  // --- Data ---
  bytes32 public constant NAME = "LockupContract";

  uint256 public constant SECONDS_IN_ONE_YEAR = 31536000;

  address public immutable beneficiary;

  IPREONToken public immutable preonToken;

  // Unlock time is the Unix point in time at which the beneficiary can withdraw.
  uint256 public unlockTime;

  // --- Events ---

  event LockupContractCreated(address _beneficiary, uint256 _unlockTime);
  event LockupContractEmptied(uint256 _PREONwithdrawal);

  // --- Functions ---

  constructor(
    address _preonTokenAddress,
    address _beneficiary,
    uint256 _unlockTime
  ) public {
    preonToken = IPREONToken(_preonTokenAddress);

    /*
     * Set the unlock time to a chosen instant in the future, as long as it is at least 1 year after
     * the system was deployed
     */
    unlockTime = _unlockTime;

    beneficiary = _beneficiary;
    emit LockupContractCreated(_beneficiary, _unlockTime);
  }

  function withdrawPREON() external {
    _requireCallerIsBeneficiary();
    _requireLockupDurationHasPassed();

    IPREONToken preonTokenCached = preonToken;
    uint256 PREONBalance = preonTokenCached.balanceOf(address(this));
    preonTokenCached.safeTransfer(beneficiary, PREONBalance);
    emit LockupContractEmptied(PREONBalance);
  }

  // --- 'require' functions ---

  function _requireCallerIsBeneficiary() internal view {
    require(
      msg.sender == beneficiary,
      "LockupContract: caller is not the beneficiary"
    );
  }

  function _requireLockupDurationHasPassed() internal view {
    require(
      block.timestamp >= unlockTime,
      "LockupContract: The lockup duration must have passed"
    );
  }

  function _requireUnlockTimeIsAtLeastOneYearAfterSystemDeployment(
    uint256 _unlockTime
  ) internal view {
    uint256 systemDeploymentTime = preonToken.getDeploymentStartTime();
    require(
      _unlockTime >= systemDeploymentTime.add(SECONDS_IN_ONE_YEAR),
      "LockupContract: unlock time must be at least one year after system deployment"
    );
  }
}
