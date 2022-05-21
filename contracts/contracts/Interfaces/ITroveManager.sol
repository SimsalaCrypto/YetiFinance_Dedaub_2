// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./ILiquityBase.sol";
import "./IStabilityPool.sol";
import "./IYUSDToken.sol";
import "./IYETIToken.sol";
import "./ISYETI.sol";
import "./IActivePool.sol";
import "./IDefaultPool.sol";

// Common interface for the Trove Manager.
interface ITroveManager is ILiquityBase {
  // --- Events ---

  event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
  event PriceFeedAddressChanged(address _newPriceFeedAddress);
  event YUSDTokenAddressChanged(address _newYUSDTokenAddress);
  event ActivePoolAddressChanged(address _activePoolAddress);
  event DefaultPoolAddressChanged(address _defaultPoolAddress);
  event StabilityPoolAddressChanged(address _stabilityPoolAddress);
  event GasPoolAddressChanged(address _gasPoolAddress);
  event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
  event SortedTrovesAddressChanged(address _sortedTrovesAddress);
  event YETITokenAddressChanged(address _yetiTokenAddress);
  event SYETIAddressChanged(address _sYETIAddress);

  event Liquidation(
    uint256 liquidatedAmount,
    uint256 totalYUSDGasCompensation,
    address[] totalCollTokens,
    uint256[] totalCollAmounts,
    address[] totalCollGasCompTokens,
    uint256[] totalCollGasCompAmounts
  );
  event Redemption(
    uint256 _attemptedYUSDAmount,
    uint256 _actualYUSDAmount,
    uint256 YUSDfee,
    address[] tokens,
    uint256[] amounts
  );
  event TroveLiquidated(
    address indexed _borrower,
    uint256 _debt,
    uint256 _coll,
    uint8 operation
  );
  event BaseRateUpdated(uint256 _baseRate);
  event LastFeeOpTimeUpdated(uint256 _lastFeeOpTime);
  event TotalStakesUpdated(address token, uint256 _newTotalStakes);
  event SystemSnapshotsUpdated(
    uint256 _totalStakesSnapshot,
    uint256 _totalCollateralSnapshot
  );
  event LTermsUpdated(uint256 _L_ETH, uint256 _L_YUSDDebt);
  event TroveSnapshotsUpdated(uint256 _L_ETH, uint256 _L_YUSDDebt);
  event TroveIndexUpdated(address _borrower, uint256 _newIndex);

  // --- Functions ---

  function setAddresses(
    address _borrowerOperationsAddress,
    address _activePoolAddress,
    address _defaultPoolAddress,
    address _stabilityPoolAddress,
    address _gasPoolAddress,
    address _collSurplusPoolAddress,
    address _yusdTokenAddress,
    address _sortedTrovesAddress,
    address _yetiTokenAddress,
    address _sYETIAddress,
    address _whitelistAddress,
    address _troveManagerRedemptionsAddress,
    address _troveManagerLiquidationsAddress
  ) external;

  function stabilityPool() external view returns (IStabilityPool);

  function yusdToken() external view returns (IYUSDToken);

  function yetiToken() external view returns (IYETIToken);

  function sYETI() external view returns (ISYETI);

  function getTroveOwnersCount() external view returns (uint256);

  function getTroveFromTroveOwnersArray(uint256 _index)
    external
    view
    returns (address);

  function getCurrentICR(address _borrower) external view returns (uint256);

  function getCurrentRICR(address _borrower) external view returns (uint256);

  function liquidate(address _borrower) external;

  function batchLiquidateTroves(
    address[] calldata _troveArray,
    address _liquidator
  ) external;

  function redeemCollateral(
    uint256 _YUSDAmount,
    uint256 _YUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintNICR,
    uint256 _maxIterations
  ) external;

  function updateStakeAndTotalStakes(address _borrower) external;

  function updateTroveCollTMR(
    address _borrower,
    address[] memory addresses,
    uint256[] memory amounts
  ) external;

  function updateTroveRewardSnapshots(address _borrower) external;

  function addTroveOwnerToArray(address _borrower)
    external
    returns (uint256 index);

  function applyPendingRewards(address _borrower) external;

  //    function getPendingETHReward(address _borrower) external view returns (uint);
  function getPendingCollRewards(address _borrower)
    external
    view
    returns (address[] memory, uint256[] memory);

  function getPendingYUSDDebtReward(address _borrower)
    external
    view
    returns (uint256);

  function hasPendingRewards(address _borrower) external view returns (bool);

  //    function getEntireDebtAndColl(address _borrower) external view returns (
  //        uint debt,
  //        uint coll,
  //        uint pendingYUSDDebtReward,
  //        uint pendingETHReward
  //    );

  function closeTrove(address _borrower) external;

  function removeStake(address _borrower) external;

  function removeStakeTMR(address _borrower) external;

  function updateTroveDebt(address _borrower, uint256 debt) external;

  function getRedemptionRate() external view returns (uint256);

  function getRedemptionRateWithDecay() external view returns (uint256);

  function getRedemptionFeeWithDecay(uint256 _ETHDrawn)
    external
    view
    returns (uint256);

  function getBorrowingRate() external view returns (uint256);

  function getBorrowingRateWithDecay() external view returns (uint256);

  function getBorrowingFee(uint256 YUSDDebt) external view returns (uint256);

  function getBorrowingFeeWithDecay(uint256 _YUSDDebt)
    external
    view
    returns (uint256);

  function decayBaseRateFromBorrowing() external;

  function getTroveStatus(address _borrower) external view returns (uint256);

  function isTroveActive(address _borrower) external view returns (bool);

  function getTroveStake(address _borrower, address _token)
    external
    view
    returns (uint256);

  function getTotalStake(address _token) external view returns (uint256);

  function getTroveDebt(address _borrower) external view returns (uint256);

  function getL_Coll(address _token) external view returns (uint256);

  function getL_YUSD(address _token) external view returns (uint256);

  function getRewardSnapshotColl(address _borrower, address _token)
    external
    view
    returns (uint256);

  function getRewardSnapshotYUSD(address _borrower, address _token)
    external
    view
    returns (uint256);

  // returns the VC value of a trove
  function getTroveVC(address _borrower) external view returns (uint256);

  function getTroveColls(address _borrower)
    external
    view
    returns (address[] memory, uint256[] memory);

  function getCurrentTroveState(address _borrower)
    external
    view
    returns (
      address[] memory,
      uint256[] memory,
      uint256
    );

  function setTroveStatus(address _borrower, uint256 num) external;

  function updateTroveColl(
    address _borrower,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;

  function increaseTroveDebt(address _borrower, uint256 _debtIncrease)
    external
    returns (uint256);

  function decreaseTroveDebt(address _borrower, uint256 _collDecrease)
    external
    returns (uint256);

  function getTCR() external view returns (uint256);

  function checkRecoveryMode() external view returns (bool);

  function closeTroveRedemption(address _borrower) external;

  function closeTroveLiquidation(address _borrower) external;

  function removeStakeTLR(address _borrower) external;

  function updateBaseRate(uint256 newBaseRate) external;

  function calcDecayedBaseRate() external view returns (uint256);

  function redistributeDebtAndColl(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _debt,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;

  function updateSystemSnapshots_excludeCollRemainder(
    IActivePool _activePool,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;

  function getEntireDebtAndColls(address _borrower)
    external
    view
    returns (
      uint256,
      address[] memory,
      uint256[] memory,
      uint256,
      address[] memory,
      uint256[] memory
    );

  function movePendingTroveRewardsToActivePool(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _YUSD,
    address[] memory _tokens,
    uint256[] memory _amounts,
    address _borrower
  ) external;

  function collSurplusUpdate(
    address _account,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;
}
