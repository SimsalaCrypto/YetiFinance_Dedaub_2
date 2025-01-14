// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Interfaces/ITroveManager.sol";

contract TroveManagerScript is CheckContract {
  bytes32 public constant NAME = "TroveManagerScript";

  ITroveManager immutable troveManager;

  constructor(ITroveManager _troveManager) public {
    checkContract(address(_troveManager));
    troveManager = _troveManager;
  }

  function redeemCollateral(
    uint256 _YUSDAmount,
    uint256 _YUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintNICR,
    uint256 _maxIterations
  )
    external
    returns (
      // uint _maxFee
      uint256
    )
  {
    troveManager.redeemCollateral(
      _YUSDAmount,
      _YUSDMaxFee,
      _firstRedemptionHint,
      _upperPartialRedemptionHint,
      _lowerPartialRedemptionHint,
      _partialRedemptionHintNICR,
      _maxIterations
      // _maxFee
    );
  }
}
