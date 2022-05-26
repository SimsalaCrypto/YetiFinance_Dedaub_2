// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Interfaces/IPREONToken.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Dependencies/PreonMath.sol";
import "../Dependencies/OwnableUpgradeable.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/SafeMath.sol";

/*
 * The treasury needs to keep this contract supplied with PREON tokens.
 * The amount of issued PREON is equal to rewardRate * deltaT (time since emission)
 * Preon emissions are split on a pro-rata basis across stability pool depositors.
 * This tracking is done with the "G" parameter in the stability pool
 */
contract CommunityIssuance is
  ICommunityIssuance,
  OwnableUpgradeable,
  CheckContract
{
  using SafeMath for uint256;

  // --- Data ---

  string public constant NAME = "CommunityIssuance";

  IPREONToken public preonToken;

  address public stabilityPoolAddress;

  uint256 rewardRate;
  uint256 public newRate;
  uint256 public newRateUpdateTime;
  bool public rateUpdate;

  uint256 public lastUpdateTime;
  uint256 public unclaimedIssuedPreon;
  uint256 public totalPreonIssued;

  bool internal addressesSet;

  // --- Functions ---

  function setAddresses(
    address _preonTokenAddress,
    address _stabilityPoolAddress
  ) external override {
    require(!addressesSet, "Addresses Already Set");
    _transferOwnership(msg.sender);
    lastUpdateTime = block.timestamp;

    preonToken = IPREONToken(_preonTokenAddress);
    stabilityPoolAddress = _stabilityPoolAddress;

    addressesSet = true;
  }

  /**
   * @notice rewardRate will be set to newRate
   * @param _newRewardRate New PREON / second emission rate
   */
  function setRate(uint256 _newRewardRate) external override onlyOwner {
    newRate = _newRewardRate;
    newRateUpdateTime = block.timestamp;
    rateUpdate = true;

    emit NewRewardRate(_newRewardRate, newRateUpdateTime);
  }

  /**
   * @notice Called by SP whenever an action takes place.
   * New PREON tokens are emitted and the amount emitted
   * is returned
   */
  function issuePREON() external override returns (uint256) {
    _requireCallerIsSP();

    uint256 issuance = _getNewIssuance();

    unclaimedIssuedPreon = unclaimedIssuedPreon.add(issuance);
    totalPreonIssued = totalPreonIssued.add(issuance);

    lastUpdateTime = block.timestamp;

    emit NewPreonIssued(issuance);
    emit TotalPREONIssuedUpdated(totalPreonIssued);

    return issuance;
  }

  /**
   * @notice Returns the amount of Preon to emit given the reward rate
   * and how long it has been since the last emission.
   * Returns the minimum between the amount of Preon tokens
   * in this contract that have not been allocated,
   * and the amount of PREON that should be issued at the
   * given reward rate.
   */
  function _getNewIssuance() internal returns (uint256) {
    uint256 newIssuance;
    if (rateUpdate) {
      // New Issuance will be split between new rate and old at that update time.
      newIssuance = (block.timestamp.sub(newRateUpdateTime)).mul(newRate);
      newIssuance = newIssuance.add(
        (newRateUpdateTime.sub(lastUpdateTime)).mul(rewardRate)
      );
      rewardRate = newRate;
      rateUpdate = false;
    } else {
      newIssuance = (block.timestamp.sub(lastUpdateTime)).mul(rewardRate);
    }

    uint256 availableToEmit;
    if (preonToken.balanceOf(address(this)) > unclaimedIssuedPreon) {
      availableToEmit = preonToken.balanceOf(address(this)).sub(
        unclaimedIssuedPreon
      );
    }

    return PreonMath._min(newIssuance, availableToEmit);
  }

  /**
   * @notice Send PREON to an address-only callable by SP
   */
  function sendPREON(address _account, uint256 _PREONamount) external override {
    _requireCallerIsSP();

    unclaimedIssuedPreon = unclaimedIssuedPreon.sub(_PREONamount);
    require(preonToken.transfer(_account, _PREONamount));

    emit RewardPaid(_account, _PREONamount);
  }

  /**
   * @notice Returns current reward rate
   */
  function getRewardRate() external view override returns (uint256) {
    return rewardRate;
  }

  /**
   * @notice Checks that caller is the Stability Pool, reverts if not
   */
  function _requireCallerIsSP() internal view {
    require(
      msg.sender == stabilityPoolAddress,
      "CommunityIssuance: caller is not SP"
    );
  }
}
