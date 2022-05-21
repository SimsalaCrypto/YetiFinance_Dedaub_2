// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../TroveManager.sol";
import "../BorrowerOperations.sol";
import "../StabilityPool.sol";
import "../YUSDToken.sol";

contract EchidnaProxy {
  TroveManager troveManager;
  BorrowerOperations borrowerOperations;
  StabilityPool stabilityPool;
  YUSDToken yusdToken;

  constructor(
    TroveManager _troveManager,
    BorrowerOperations _borrowerOperations,
    StabilityPool _stabilityPool,
    YUSDToken _yusdToken
  ) public {
    troveManager = _troveManager;
    borrowerOperations = _borrowerOperations;
    stabilityPool = _stabilityPool;
    yusdToken = _yusdToken;
  }

  receive() external payable {
    // do nothing
  }

  // TroveManager

  function liquidatePrx(address _user) external {
    troveManager.liquidate(_user);
  }

  function liquidateTrovesPrx(uint256 _n) external {
    // pass
    // @KingYeti: we no longer have this function
    //        troveManager.liquidateTroves(_n);
  }

  function batchLiquidateTrovesPrx(address[] calldata _troveArray) external {
    troveManager.batchLiquidateTroves(_troveArray, msg.sender);
  }

  function redeemCollateralPrx(
    uint256 _YUSDAmount,
    uint256 _YUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintNICR,
    uint256 _maxIterations // uint _maxFee
  ) external {
    troveManager.redeemCollateral(
      _YUSDAmount,
      _YUSDMaxFee,
      _firstRedemptionHint,
      _upperPartialRedemptionHint,
      _lowerPartialRedemptionHint,
      _partialRedemptionHintNICR,
      _maxIterations
    );
  }

  // Borrower Operations
  // @KingYeti: changed parameters
  function openTrovePrx(
    uint256 _maxFeePercentage,
    uint256 _YUSDAmount,
    address _upperHint,
    address _lowerHint,
    address[] memory _colls,
    uint256[] memory _amounts
  ) external payable {
    borrowerOperations.openTrove(
      _maxFeePercentage,
      _YUSDAmount,
      _upperHint,
      _lowerHint,
      _colls,
      _amounts
    );
  }

  // @KingYeti: changed params
  function addCollPrx(
    address[] memory _collsIn,
    uint256[] memory _amountsIn,
    address _upperHint,
    address _lowerHint,
    uint256 _maxFeePercentage
  ) external payable {
    borrowerOperations.addColl(
      _collsIn,
      _amountsIn,
      _upperHint,
      _lowerHint,
      _maxFeePercentage
    );
  }

  function withdrawCollPrx(
    address[] memory _collsOut,
    uint256[] memory _amountsOut,
    address _upperHint,
    address _lowerHint
  ) external {
    borrowerOperations.withdrawColl(
      _collsOut,
      _amountsOut,
      _upperHint,
      _lowerHint
    );
  }

  function withdrawYUSDPrx(
    uint256 _amount,
    address _upperHint,
    address _lowerHint,
    uint256 _maxFee
  ) external {
    borrowerOperations.withdrawYUSD(_maxFee, _amount, _upperHint, _lowerHint);
  }

  function repayYUSDPrx(
    uint256 _amount,
    address _upperHint,
    address _lowerHint
  ) external {
    borrowerOperations.repayYUSD(_amount, _upperHint, _lowerHint);
  }

  function closeTrovePrx() external {
    borrowerOperations.closeTrove();
  }

  function adjustTrovePrx(
    address[] memory _collsIn,
    uint256[] memory _amountsIn,
    address[] memory _collsOut,
    uint256[] memory _amountsOut,
    uint256 _YUSDChange,
    bool _isDebtIncrease,
    address _upperHint,
    address _lowerHint,
    uint256 _maxFeePercentage
  ) external {
    borrowerOperations.adjustTrove(
      _collsIn,
      _amountsIn,
      _collsOut,
      _amountsOut,
      _YUSDChange,
      _isDebtIncrease,
      _upperHint,
      _lowerHint,
      _maxFeePercentage
    );
  }

  // Pool Manager
  function provideToSPPrx(uint256 _amount, address _frontEndTag) external {
    stabilityPool.provideToSP(_amount, _frontEndTag);
  }

  function withdrawFromSPPrx(uint256 _amount) external {
    stabilityPool.withdrawFromSP(_amount);
  }

  // YUSD Token

  function transferPrx(address recipient, uint256 amount)
    external
    returns (bool)
  {
    return yusdToken.transfer(recipient, amount);
  }

  function approvePrx(address spender, uint256 amount) external returns (bool) {
    return yusdToken.increaseAllowance(spender, amount);
  }

  function transferFromPrx(
    address sender,
    address recipient,
    uint256 amount
  ) external returns (bool) {
    return yusdToken.transferFrom(sender, recipient, amount);
  }

  function increaseAllowancePrx(address spender, uint256 addedValue)
    external
    returns (bool)
  {
    require(yusdToken.approve(spender, 0));
    return yusdToken.increaseAllowance(spender, addedValue);
  }

  function decreaseAllowancePrx(address spender, uint256 subtractedValue)
    external
    returns (bool)
  {
    return yusdToken.decreaseAllowance(spender, subtractedValue);
  }
}
