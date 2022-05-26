// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./ILiquityBase.sol";
import "./IStabilityPool.sol";
import "./IPUSDToken.sol";
import "./IPREONToken.sol";
import "./IActivePool.sol";
import "./IDefaultPool.sol";

// Common interface for the Trove Manager.
interface ITroveManager is ILiquityBase {
  // --- Events ---

  event Redemption(
    uint256 _attemptedPUSDAmount,
    uint256 _actualPUSDAmount,
    uint256 PUSDfee,
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
  event LTermsUpdated(uint256 _L_ETH, uint256 _L_PUSDDebt);
  event TroveSnapshotsUpdated(uint256 _L_ETH, uint256 _L_PUSDDebt);
  event TroveIndexUpdated(address _borrower, uint256 _newIndex);

  // --- Functions ---

  function setAddresses(
    address _borrowerOperationsAddress,
    address _activePoolAddress,
    address _defaultPoolAddress,
    address _sortedTrovesAddress,
    address _controllerAddress,
    address _troveManagerRedemptionsAddress,
    address _troveManagerLiquidationsAddress
  ) external;

  function getTroveOwnersCount() external view returns (uint256);

  function getTroveFromTroveOwnersArray(uint256 _index)
    external
    view
    returns (address);

  function getCurrentICR(address _borrower) external view returns (uint256);

  function getCurrentAICR(address _borrower) external view returns (uint256);

  function liquidate(address _borrower) external;

  function batchLiquidateTroves(
    address[] calldata _troveArray,
    address _liquidator
  ) external;

  function redeemCollateral(
    uint256 _PUSDAmount,
    uint256 _PUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintNICR,
    uint256 _maxIterations
  ) external;

  function redeemCollateralSingle(
    uint256 _PUSDamount,
    uint256 _PUSDMaxFee,
    address _target,
    address _upperHint,
    address _lowerHint,
    uint256 _hintAICR,
    address _collToRedeem
  ) external;

  function updateTroveRewardSnapshots(address _borrower) external;

  function addTroveOwnerToArray(address _borrower)
    external
    returns (uint256 index);

  function applyPendingRewards(address _borrower) external;

  function getPendingCollRewards(address _borrower)
    external
    view
    returns (address[] memory, uint256[] memory);

  function getPendingPUSDDebtReward(address _borrower)
    external
    view
    returns (uint256);

  function hasPendingRewards(address _borrower) external view returns (bool);

  function removeStakeAndCloseTrove(address _borrower) external;

  function updateTroveDebt(address _borrower, uint256 debt) external;

  function getRedemptionRate() external view returns (uint256);

  function getRedemptionRateWithDecay() external view returns (uint256);

  function getRedemptionFeeWithDecay(uint256 _ETHDrawn)
    external
    view
    returns (uint256);

  function getBorrowingRate() external view returns (uint256);

  function getBorrowingRateWithDecay() external view returns (uint256);

  function getBorrowingFee(uint256 PUSDDebt) external view returns (uint256);

  function getBorrowingFeeWithDecay(uint256 _PUSDDebt)
    external
    view
    returns (uint256);

  function decayBaseRateFromBorrowingAndCalculateFee(uint256 _PUSDDebt)
    external
    returns (uint256);

  function getTroveStatus(address _borrower) external view returns (uint256);

  function isTroveActive(address _borrower) external view returns (bool);

  function getTroveStake(address _borrower, address _token)
    external
    view
    returns (uint256);

  function getTotalStake(address _token) external view returns (uint256);

  function getTroveDebt(address _borrower) external view returns (uint256);

  function getL_Coll(address _token) external view returns (uint256);

  function getL_PUSD(address _token) external view returns (uint256);

  function getRewardSnapshotColl(address _borrower, address _token)
    external
    view
    returns (uint256);

  function getRewardSnapshotPUSD(address _borrower, address _token)
    external
    view
    returns (uint256);

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

  function updateTroveCollAndStakeAndTotalStakes(
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

  function removeStake(address _borrower) external;

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

  function updateTroves(
    address[] calldata _borrowers,
    address[] calldata _lowerHints,
    address[] calldata _upperHints
  ) external;

  function updateUnderCollateralizedTroves(address[] memory _ids) external;

  function getMCR() external view returns (uint256);

  function getCCR() external view returns (uint256);

  function getPUSD_GAS_COMPENSATION() external view returns (uint256);

  function getMIN_NET_DEBT() external view returns (uint256);

  function getBORROWING_FEE_FLOOR() external view returns (uint256);

  function getREDEMPTION_FEE_FLOOR() external view returns (uint256);
}
