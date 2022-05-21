// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface ITroveManagerRedemptions {
  function redeemCollateral(
    uint256 _YUSDamount,
    uint256 _YUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintNICR,
    uint256 _maxIterations,
    // uint _maxFeePercentage,
    address _redeemSender
  ) external;
}
