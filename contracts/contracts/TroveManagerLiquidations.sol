// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Dependencies/TroveManagerBase.sol";

// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@&@@@@@@@@@@@@@@@@@@@@@@@@@@
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@&   ,.@@@@@@@@@@@@@@@@@@@@@@@
// @@@@@@@@@@@@@@@@@@@@@@@@&&&.,,      ,,**.&&&&&@@@@@@@@@@@@@@
// @@@@@@@@@@@@@@@@@@@@@@,               ..,,,,,,,,,&@@@@@@@@@@
// @@@@@@,,,,,,&@@@@@@@@&                       ,,,,,&@@@@@@@@@
// @@@&,,,,,,,,@@@@@@@@@                        ,,,,,*@@@/@@@@@
// @@,*,*,*,*#,,*,&@@@@@   $$          $$       *,,,  ***&@@@@@
// @&***********(@@@@@@&   $$          $$       ,,,%&. & %@@@@@
// @(*****&**     &@@@@#                        *,,%  ,#%@*&@@@
// @... &             &                         **,,*&,(@*,*,&@
// @&,,.              &                         *,*       **,,@
// @@@,,,.            *                         **         ,*,,
// @@@@@,,,...   .,,,,&                        .,%          *,*
// @@@@@@@&/,,,,,,,,,,,,&,,,,,.         .,,,,,,,,.           *,
// @@@@@@@@@@@@&&@(,,,,,(@&&@@&&&&&%&&&&&%%%&,,,&            .(
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@&,,,,,,,,,,,,,,&             &
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@/,,,,,,,,,,,,&             &
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@/            &             &
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@&              &             &
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@&      ,,,@@@&  &  &&  .&( &#%
// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@&&&&&%#**@@@&*&*******,,,,,**
//
//  $$\     $$\          $$\     $$\       $$$$$$$$\ $$\
//  \$$\   $$  |         $$ |    \__|      $$  _____|\__|
//   \$$\ $$  /$$$$$$\ $$$$$$\   $$\       $$ |      $$\ $$$$$$$\   $$$$$$\  $$$$$$$\   $$$$$$$\  $$$$$$\
//    \$$$$  /$$  __$$\\_$$  _|  $$ |      $$$$$\    $$ |$$  __$$\  \____$$\ $$  __$$\ $$  _____|$$  __$$\
//     \$$  / $$$$$$$$ | $$ |    $$ |      $$  __|   $$ |$$ |  $$ | $$$$$$$ |$$ |  $$ |$$ /      $$$$$$$$ |
//      $$ |  $$   ____| $$ |$$\ $$ |      $$ |      $$ |$$ |  $$ |$$  __$$ |$$ |  $$ |$$ |      $$   ____|
//      $$ |  \$$$$$$$\  \$$$$  |$$ |      $$ |      $$ |$$ |  $$ |\$$$$$$$ |$$ |  $$ |\$$$$$$$\ \$$$$$$$\
//      \__|   \_______|  \____/ \__|      \__|      \__|\__|  \__| \_______|\__|  \__| \_______| \_______|

/**
 * @notice TroveManagerLiquidations is derived from TroveManager and has all the functions
 * related to Liquidations.
 */

contract TroveManagerLiquidations is
  TroveManagerBase,
  ITroveManagerLiquidations
{
  bytes32 public constant NAME = "TroveManagerLiquidations";

  uint256 internal constant _100pct = 1e18; // 1e18 == 100%

  // Additional 1e9 precision for the SP Ratio calculation
  uint256 internal constant SPRatioPrecision = 1e27;

  uint256 internal constant PERCENT_DIVISOR = 200; // dividing by 200 yields 0.5%

  IStabilityPool internal stabilityPoolContract;

  ITroveManager internal troveManager;

  IYUSDToken internal yusdTokenContract;

  address internal gasPoolAddress;

  ICollSurplusPool internal collSurplusPool;

  struct LiquidationValues {
    uint256 entireTroveDebt;
    newColls entireTroveColl;
    newColls collGasCompensation;
    uint256 YUSDGasCompensation;
    uint256 debtToOffset;
    newColls collToSendToSP;
    uint256 debtToRedistribute;
    newColls collToRedistribute;
    newColls collSurplus;
  }

  struct LiquidationTotals {
    uint256 totalVCInSequence;
    uint256 totalDebtInSequence;
    newColls totalCollGasCompensation;
    uint256 totalYUSDGasCompensation;
    uint256 totalDebtToOffset;
    newColls totalCollToSendToSP;
    uint256 totalDebtToRedistribute;
    newColls totalCollToRedistribute;
    newColls totalCollSurplus;
  }

  struct LocalVariables_LiquidationSequence {
    uint256 remainingYUSDInStabPool;
    uint256 i;
    uint256 ICR;
    address user;
    bool backToNormalMode;
  }

  struct LocalVariables_OuterLiquidationFunction {
    uint256 YUSDInStabPool;
    bool recoveryModeAtStart;
    uint256 liquidatedDebt;
  }

  struct LocalVariables_InnerSingleLiquidateFunction {
    newColls collToLiquidate;
    uint256 pendingDebtReward;
    newColls pendingCollReward;
  }

  struct LocalVariables_ORVals {
    uint256 debtToOffset;
    newColls collToSendToSP;
    uint256 debtToRedistribute;
    newColls collToRedistribute;
    newColls collSurplus;
  }

  event TroveLiquidated(
    address indexed _borrower,
    uint256 _debt,
    TroveManagerOperation _operation
  );
  event Liquidation(
    uint256 liquidatedAmount,
    uint256 totalYUSDGasCompensation,
    address[] totalCollTokens,
    uint256[] totalCollAmounts,
    address[] totalCollGasCompTokens,
    uint256[] totalCollGasCompAmounts
  );

  bool private addressSet;

  function setAddresses(
    address _activePoolAddress,
    address _defaultPoolAddress,
    address _stabilityPoolAddress,
    address _gasPoolAddress,
    address _collSurplusPoolAddress,
    address _yusdTokenAddress,
    address _controllerAddress,
    address _troveManagerAddress
  ) external {
    require(addressSet == false, "Addresses already set");
    addressSet = true;
    activePool = IActivePool(_activePoolAddress);
    defaultPool = IDefaultPool(_defaultPoolAddress);
    stabilityPoolContract = IStabilityPool(_stabilityPoolAddress);
    controller = IYetiController(_controllerAddress);
    gasPoolAddress = _gasPoolAddress;
    collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
    yusdTokenContract = IYUSDToken(_yusdTokenAddress);
    troveManager = ITroveManager(_troveManagerAddress);
  }

  /**
   * @notice Function for liquidating a list of troves in a single transaction
   * @dev Will perform as many as it can and looks at if it is eligible for liquidation based on the current ICR value
   */
  function batchLiquidateTroves(
    address[] memory _troveArray,
    address _liquidator
  ) external override {
    _requireCallerisTroveManager();
    require(_troveArray.length != 0, "TML: One trove must exist");

    IActivePool activePoolCached = activePool;
    IDefaultPool defaultPoolCached = defaultPool;
    IStabilityPool stabilityPoolCached = stabilityPoolContract;

    LocalVariables_OuterLiquidationFunction memory vars;
    LiquidationTotals memory totals;

    vars.YUSDInStabPool = stabilityPoolCached.getTotalYUSDDeposits();
    uint256 systemCollVC;
    uint256 systemDebt;
    // System coll RVC not needed here.
    (
      vars.recoveryModeAtStart,
      systemCollVC,
      ,
      systemDebt
    ) = _checkRecoveryModeAndSystem();

    // Perform the appropriate liquidation sequence - tally values and obtain their totals.
    if (vars.recoveryModeAtStart) {
      totals = _getTotalFromBatchLiquidate_RecoveryMode(
        activePoolCached,
        defaultPoolCached,
        vars.YUSDInStabPool,
        systemCollVC,
        systemDebt,
        _troveArray
      );
    } else {
      //  if !vars.recoveryModeAtStart
      totals = _getTotalsFromBatchLiquidate_NormalMode(
        activePoolCached,
        defaultPoolCached,
        vars.YUSDInStabPool,
        _troveArray
      );
    }

    require(totals.totalDebtInSequence != 0, "TML: nothing to liquidate");
    // Move liquidated Collateral and YUSD to the appropriate pools
    stabilityPoolCached.offset(
      totals.totalDebtToOffset,
      totals.totalCollToSendToSP.tokens,
      totals.totalCollToSendToSP.amounts
    );
    troveManager.redistributeDebtAndColl(
      activePoolCached,
      defaultPoolCached,
      totals.totalDebtToRedistribute,
      totals.totalCollToRedistribute.tokens,
      totals.totalCollToRedistribute.amounts
    );
    if (_collsIsNonZero(totals.totalCollSurplus)) {
      activePoolCached.sendCollaterals(
        address(collSurplusPool),
        totals.totalCollSurplus.tokens,
        totals.totalCollSurplus.amounts
      );
    }

    // Update system snapshots
    troveManager.updateSystemSnapshots_excludeCollRemainder(
      activePoolCached,
      totals.totalCollGasCompensation.tokens,
      totals.totalCollGasCompensation.amounts
    );

    vars.liquidatedDebt = totals.totalDebtInSequence;

    // merge the colls into one to emit correct event.
    newColls memory sumCollsResult = _sumColls(
      totals.totalCollToSendToSP,
      totals.totalCollToRedistribute
    );
    sumCollsResult = _sumColls(sumCollsResult, totals.totalCollSurplus);

    emit Liquidation(
      vars.liquidatedDebt,
      totals.totalYUSDGasCompensation,
      sumCollsResult.tokens,
      sumCollsResult.amounts,
      totals.totalCollGasCompensation.tokens,
      totals.totalCollGasCompensation.amounts
    );

    // Send gas compensation to caller
    _sendGasCompensation(
      activePoolCached,
      _liquidator,
      totals.totalYUSDGasCompensation,
      totals.totalCollGasCompensation.tokens,
      totals.totalCollGasCompensation.amounts
    );
  }

  /**
   * @notice This function is used when the batch liquidation sequence starts during Recovery Mode
   * @dev It handles the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
   * @return totals from batch liquidate
   */
  function _getTotalFromBatchLiquidate_RecoveryMode(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _YUSDInStabPool,
    uint256 _systemCollVC,
    uint256 _systemDebt,
    address[] memory _troveArray
  ) internal returns (LiquidationTotals memory totals) {
    LocalVariables_LiquidationSequence memory vars;
    LiquidationValues memory singleLiquidation;

    vars.remainingYUSDInStabPool = _YUSDInStabPool;
    vars.backToNormalMode = false;
    uint256 troveArrayLen = _troveArray.length;
    for (vars.i = 0; vars.i < troveArrayLen; ++vars.i) {
      vars.user = _troveArray[vars.i];

      // Skip non-active troves
      Status userStatus = Status(troveManager.getTroveStatus(vars.user));
      if (userStatus != Status.active) {
        continue;
      }
      vars.ICR = troveManager.getCurrentICR(vars.user);

      if (!vars.backToNormalMode) {
        // Skip this trove if ICR is greater than MCR and Stability Pool is empty
        if (vars.ICR >= MCR && vars.remainingYUSDInStabPool == 0) {
          continue;
        }

        uint256 TCR = _computeCR(_systemCollVC, _systemDebt);

        singleLiquidation = _liquidateRecoveryMode(
          _activePool,
          _defaultPool,
          vars.user,
          vars.ICR,
          vars.remainingYUSDInStabPool,
          TCR
        );

        // Update aggregate trackers
        vars.remainingYUSDInStabPool = vars.remainingYUSDInStabPool.sub(
          singleLiquidation.debtToOffset
        );

        _systemDebt = _systemDebt.sub(singleLiquidation.debtToOffset);

        uint256 collToSendToSpVc = _getVCColls(
          singleLiquidation.collToSendToSP
        );
        uint256 collGasCompensationTotal = _getVCColls(
          singleLiquidation.collGasCompensation
        );
        uint256 collSurplusTotal = _getVCColls(singleLiquidation.collSurplus);

        // Two calls stack too deep
        _systemCollVC = _systemCollVC.sub(collToSendToSpVc).sub(
          collGasCompensationTotal
        );
        _systemCollVC = _systemCollVC.sub(collSurplusTotal);

        // Add liquidation values to their respective running totals
        totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

        vars.backToNormalMode = !_checkPotentialRecoveryMode(
          _systemCollVC,
          _systemDebt
        );
      } else if (vars.backToNormalMode && vars.ICR < MCR) {
        singleLiquidation = _liquidateNormalMode(
          _activePool,
          _defaultPool,
          vars.user,
          vars.remainingYUSDInStabPool
        );
        vars.remainingYUSDInStabPool = vars.remainingYUSDInStabPool.sub(
          singleLiquidation.debtToOffset
        );

        // Add liquidation values to their respective running totals
        totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
      } else continue; // In Normal Mode skip troves with ICR >= MCR
    }
  }

  /**
   * @notice This function is used when the batch liquidation sequence starts during Normal Mode
   * @return totals from batch liquidate
   */
  function _getTotalsFromBatchLiquidate_NormalMode(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _YUSDInStabPool,
    address[] memory _troveArray
  ) internal returns (LiquidationTotals memory totals) {
    LocalVariables_LiquidationSequence memory vars;
    LiquidationValues memory singleLiquidation;

    vars.remainingYUSDInStabPool = _YUSDInStabPool;
    uint256 troveArrayLen = _troveArray.length;
    for (vars.i = 0; vars.i < troveArrayLen; ++vars.i) {
      vars.user = _troveArray[vars.i];
      vars.ICR = troveManager.getCurrentICR(vars.user);
      if (vars.ICR < MCR) {
        singleLiquidation = _liquidateNormalMode(
          _activePool,
          _defaultPool,
          vars.user,
          vars.remainingYUSDInStabPool
        );
        vars.remainingYUSDInStabPool = vars.remainingYUSDInStabPool.sub(
          singleLiquidation.debtToOffset
        );

        // Add liquidation values to their respective running totals
        totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
      }
    }
  }

  /**
   * @notice Liquidate one trove, in Normal Mode
   * @return singleLiquidation values
   */
  function _liquidateNormalMode(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    address _borrower,
    uint256 _YUSDInStabPool
  ) internal returns (LiquidationValues memory singleLiquidation) {
    LocalVariables_InnerSingleLiquidateFunction memory vars;
    (
      singleLiquidation.entireTroveDebt,
      singleLiquidation.entireTroveColl.tokens,
      singleLiquidation.entireTroveColl.amounts,
      vars.pendingDebtReward,
      vars.pendingCollReward.tokens,
      vars.pendingCollReward.amounts
    ) = troveManager.getEntireDebtAndColls(_borrower);

    _movePendingTroveRewardsToActivePool(
      _activePool,
      _defaultPool,
      vars.pendingDebtReward,
      vars.pendingCollReward.tokens,
      vars.pendingCollReward.amounts
    );
    troveManager.removeStake(_borrower);

    singleLiquidation.collGasCompensation = _getCollGasCompensation(
      singleLiquidation.entireTroveColl
    );

    singleLiquidation.YUSDGasCompensation = YUSD_GAS_COMPENSATION;

    vars.collToLiquidate.tokens = singleLiquidation.entireTroveColl.tokens;
    uint256 collToLiquidateLen = vars.collToLiquidate.tokens.length;
    vars.collToLiquidate.amounts = new uint256[](collToLiquidateLen);
    for (uint256 i; i < collToLiquidateLen; ++i) {
      vars.collToLiquidate.amounts[i] = singleLiquidation
        .entireTroveColl
        .amounts[i]
        .sub(singleLiquidation.collGasCompensation.amounts[i]);
    }

    LocalVariables_ORVals memory or_vals = _getOffsetAndRedistributionVals(
      singleLiquidation.entireTroveDebt,
      vars.collToLiquidate,
      _YUSDInStabPool
    );

    singleLiquidation = _updateSingleLiquidation(or_vals, singleLiquidation);
    troveManager.closeTroveLiquidation(_borrower);

    if (_collsIsNonZero(singleLiquidation.collSurplus)) {
      collSurplusPool.accountSurplus(
        _borrower,
        singleLiquidation.collSurplus.tokens,
        singleLiquidation.collSurplus.amounts
      );
    }

    emit TroveLiquidated(
      _borrower,
      singleLiquidation.entireTroveDebt,
      TroveManagerOperation.liquidateInNormalMode
    );
    newColls memory borrowerColls;
    emit TroveUpdated(
      _borrower,
      0,
      borrowerColls.tokens,
      borrowerColls.amounts,
      TroveManagerOperation.liquidateInNormalMode
    );
  }

  /**
   * @notice Liquidate one trove, in Recovery Mode
   * @return singleLiquidation Liquidation Values
   */
  function _liquidateRecoveryMode(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    address _borrower,
    uint256 _ICR,
    uint256 _YUSDInStabPool,
    uint256 _TCR
  ) internal returns (LiquidationValues memory singleLiquidation) {
    LocalVariables_InnerSingleLiquidateFunction memory vars;

    if (troveManager.getTroveOwnersCount() <= 1) {
      return singleLiquidation;
    } // don't liquidate if last trove

    (
      singleLiquidation.entireTroveDebt,
      singleLiquidation.entireTroveColl.tokens,
      singleLiquidation.entireTroveColl.amounts,
      vars.pendingDebtReward,
      vars.pendingCollReward.tokens,
      vars.pendingCollReward.amounts
    ) = troveManager.getEntireDebtAndColls(_borrower);

    singleLiquidation.collGasCompensation = _getCollGasCompensation(
      singleLiquidation.entireTroveColl
    );

    singleLiquidation.YUSDGasCompensation = YUSD_GAS_COMPENSATION;

    vars.collToLiquidate.tokens = singleLiquidation.entireTroveColl.tokens;
    uint256 collToLiquidateLen = vars.collToLiquidate.tokens.length;
    vars.collToLiquidate.amounts = new uint256[](collToLiquidateLen);
    for (uint256 i; i < collToLiquidateLen; ++i) {
      vars.collToLiquidate.amounts[i] = singleLiquidation
        .entireTroveColl
        .amounts[i]
        .sub(singleLiquidation.collGasCompensation.amounts[i]);
    }

    // If ICR <= 100%, purely redistribute the Trove across all active Troves
    if (_ICR <= _100pct) {
      _movePendingTroveRewardsToActivePool(
        _activePool,
        _defaultPool,
        vars.pendingDebtReward,
        vars.pendingCollReward.tokens,
        vars.pendingCollReward.amounts
      );
      troveManager.removeStake(_borrower);

      singleLiquidation.debtToOffset = 0;
      newColls memory emptyColls;
      singleLiquidation.collToSendToSP = emptyColls;
      singleLiquidation.debtToRedistribute = singleLiquidation.entireTroveDebt;
      singleLiquidation.collToRedistribute = vars.collToLiquidate;

      troveManager.closeTroveLiquidation(_borrower);
      emit TroveLiquidated(
        _borrower,
        singleLiquidation.entireTroveDebt,
        TroveManagerOperation.liquidateInRecoveryMode
      );
      newColls memory borrowerColls;
      emit TroveUpdated(
        _borrower,
        0,
        borrowerColls.tokens,
        borrowerColls.amounts,
        TroveManagerOperation.liquidateInRecoveryMode
      );

      // If 100% < ICR < MCR, offset as much as possible, and redistribute the remainder
      // ICR > 100% is implied by prevoius state.
    } else if (_ICR < MCR) {
      _movePendingTroveRewardsToActivePool(
        _activePool,
        _defaultPool,
        vars.pendingDebtReward,
        vars.pendingCollReward.tokens,
        vars.pendingCollReward.amounts
      );

      troveManager.removeStake(_borrower);

      LocalVariables_ORVals memory or_vals = _getOffsetAndRedistributionVals(
        singleLiquidation.entireTroveDebt,
        vars.collToLiquidate,
        _YUSDInStabPool
      );

      singleLiquidation = _updateSingleLiquidation(or_vals, singleLiquidation);

      troveManager.closeTroveLiquidation(_borrower);
      emit TroveLiquidated(
        _borrower,
        singleLiquidation.entireTroveDebt,
        TroveManagerOperation.liquidateInRecoveryMode
      );
      newColls memory borrowerColls;
      emit TroveUpdated(
        _borrower,
        0,
        borrowerColls.tokens,
        borrowerColls.amounts,
        TroveManagerOperation.liquidateInRecoveryMode
      );
      /*
       * If 110% <= AICR < current TCR (accounting for the preceding liquidations in the current sequence)
       * and there is YUSD in the Stability Pool, only offset, with no redistribution,
       * but at a capped rate of 1.1 and only if the whole debt can be liquidated.
       * The remainder due to the capped rate will be claimable as collateral surplus.
       * ICR >= 110% is implied from last else if statement. AICR is always >= ICR since that is a rule of
       * the recovery ratio.
       * We use AICR here instead of ICR since for troves with stablecoins or anything
       * with recovery ratio > safety ratio, liquidating a trove with ICR < TCR may not increase the TCR
       * since recovery ratios are used to calculate the TCR. The purpose of recovery mode is to increase the
       * TCR and this may put all stablecoin troves at risk of liquidation instantly if we used ICR. So, we only
       * do actions which will increase the TCR.
       */
    } else if (
      (troveManager.getCurrentAICR(_borrower) < _TCR) &&
      (singleLiquidation.entireTroveDebt <= _YUSDInStabPool)
    ) {
      _movePendingTroveRewardsToActivePool(
        _activePool,
        _defaultPool,
        vars.pendingDebtReward,
        vars.pendingCollReward.tokens,
        vars.pendingCollReward.amounts
      );

      troveManager.removeStake(_borrower);

      singleLiquidation = _getCappedOffsetVals(
        singleLiquidation.entireTroveDebt,
        vars.collToLiquidate.tokens,
        vars.collToLiquidate.amounts,
        singleLiquidation.entireTroveColl.amounts,
        singleLiquidation.collGasCompensation.amounts
      );

      troveManager.closeTroveLiquidation(_borrower);

      emit TroveLiquidated(
        _borrower,
        singleLiquidation.entireTroveDebt,
        TroveManagerOperation.liquidateInRecoveryMode
      );
      newColls memory borrowerColls;
      emit TroveUpdated(
        _borrower,
        0,
        borrowerColls.tokens,
        borrowerColls.amounts,
        TroveManagerOperation.liquidateInRecoveryMode
      );
    } else {
      // if (_ICR >= MCR && ( AICR >= _TCR || singleLiquidation.entireTroveDebt > _YUSDInStabPool))
      LiquidationValues memory zeroVals;
      return zeroVals;
    }

    if (_collsIsNonZero(singleLiquidation.collSurplus)) {
      collSurplusPool.accountSurplus(
        _borrower,
        singleLiquidation.collSurplus.tokens,
        singleLiquidation.collSurplus.amounts
      );
    }
  }

  function _updateSingleLiquidation(
    LocalVariables_ORVals memory or_vals,
    LiquidationValues memory singleLiquidation
  ) internal pure returns (LiquidationValues memory) {
    singleLiquidation.debtToOffset = or_vals.debtToOffset;
    singleLiquidation.collToSendToSP = or_vals.collToSendToSP;
    singleLiquidation.debtToRedistribute = or_vals.debtToRedistribute;
    singleLiquidation.collToRedistribute = or_vals.collToRedistribute;
    singleLiquidation.collSurplus = or_vals.collSurplus;
    return singleLiquidation;
  }

  /**
   * @notice Move a Trove's pending debt and collateral rewards from distributions, from the Default Pool to the Active Pool
   */
  function _movePendingTroveRewardsToActivePool(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _YUSD,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) internal {
    _defaultPool.decreaseYUSDDebt(_YUSD);
    _activePool.increaseYUSDDebt(_YUSD);
    _defaultPool.sendCollsToActivePool(_tokens, _amounts);
  }

  /**
   * @notice In a full liquidation, returns the values for a trove's coll and debt to be offset, and coll and debt to be redistributed to active troves
   * @dev _colls parameters is the _colls to be liquidated (total trove colls minus collateral for gas compensation)
   * collsToRedistribute.tokens and collsToRedistribute.amounts should be the same length and should be the same length as _colls.tokens and _colls.amounts.
   * If there is any colls redistributed to stability pool, collsToSendToSP.tokens and collsToSendToSP.amounts
   * will be length equal to _colls.tokens and _colls.amounts. However, if no colls are redistributed to stability pool (which is the case when _YUSDInStabPool == 0),
   * then collsToSendToSP.tokens and collsToSendToSP.amounts will be empty.
   * @return or_vals Values for trove's collateral and debt to be offset
   */
  function _getOffsetAndRedistributionVals(
    uint256 _entireTroveDebt,
    newColls memory _collsToLiquidate,
    uint256 _YUSDInStabPool
  ) internal view returns (LocalVariables_ORVals memory or_vals) {
    or_vals.collToRedistribute.tokens = _collsToLiquidate.tokens;
    uint256 collsToLiquidateLen = _collsToLiquidate.tokens.length;
    or_vals.collToRedistribute.amounts = new uint256[](collsToLiquidateLen);

    if (_YUSDInStabPool != 0) {
      /*
       * Offset as much debt & collateral as possible against the Stability Pool, and redistribute the remainder
       * between all active troves.
       *
       *  If the trove's debt is larger than the deposited YUSD in the Stability Pool:
       *
       *  - Offset an amount of the trove's debt equal to the YUSD in the Stability Pool
       *  - Remainder of trove's debt will be redistributed
       *  - Trove collateral can be partitioned into two parts:
       *  - (1) Offsetting Collateral = (debtToOffset / troveDebt) * Collateral
       *  - (2) Redistributed Collateral = Total Collateral - Offsetting Collateral
       *  - The max offsetting collateral that can be sent to the stability pool is an amount of collateral such that
       *  - the stability pool receives 110% of value of the debtToOffset. Any extra Offsetting Collateral is
       *  - sent to the collSurplusPool and can be claimed by the borrower.
       */
      or_vals.collToSendToSP.tokens = _collsToLiquidate.tokens;
      or_vals.collToSendToSP.amounts = new uint256[](collsToLiquidateLen);

      or_vals.collSurplus.tokens = _collsToLiquidate.tokens;
      or_vals.collSurplus.amounts = new uint256[](collsToLiquidateLen);

      or_vals.debtToOffset = YetiMath._min(_entireTroveDebt, _YUSDInStabPool);

      or_vals.debtToRedistribute = _entireTroveDebt.sub(or_vals.debtToOffset);

      uint256 toLiquidateCollValueUSD = _getUSDColls(_collsToLiquidate);

      // collOffsetRatio: max percentage of the collateral that can be sent to the SP as offsetting collateral
      // collOffsetRatio = percentage of the trove's debt that can be offset by the stability pool
      uint256 collOffsetRatio = SPRatioPrecision.mul(or_vals.debtToOffset).div(
        _entireTroveDebt
      );

      // SPRatio: percentage of liquidated collateral that needs to be sent to SP in order to give SP depositors
      // $110 of collateral for every 100 YUSD they are using to liquidate.
      uint256 SPRatio = or_vals.debtToOffset.mul(1e9).mul(MCR).div(
        toLiquidateCollValueUSD
      );

      // But SP ratio is capped at collOffsetRatio:
      SPRatio = YetiMath._min(collOffsetRatio, SPRatio);

      // if there is extra collateral left in the offset portion of the collateral after
      // giving stability pool holders $110 of collateral for every 100 YUSD that is taken from them,
      // then this is surplus collateral that can be claimed by the borrower
      uint256 collSurplusRatio = collOffsetRatio.sub(SPRatio);

      for (uint256 i; i < collsToLiquidateLen; ++i) {
        or_vals.collToSendToSP.amounts[i] = _collsToLiquidate
          .amounts[i]
          .mul(SPRatio)
          .div(SPRatioPrecision);

        or_vals.collSurplus.amounts[i] = _collsToLiquidate
          .amounts[i]
          .mul(collSurplusRatio)
          .div(SPRatioPrecision);

        // remaining collateral is redistributed:
        or_vals.collToRedistribute.amounts[i] = _collsToLiquidate
          .amounts[i]
          .sub(or_vals.collToSendToSP.amounts[i])
          .sub(or_vals.collSurplus.amounts[i]);
      }
    } else {
      // all colls are redistributed because no YUSD in stability pool to liquidate
      or_vals.debtToOffset = 0;
      for (uint256 i; i < collsToLiquidateLen; ++i) {
        or_vals.collToRedistribute.amounts[i] = _collsToLiquidate.amounts[i];
      }
      or_vals.debtToRedistribute = _entireTroveDebt;
    }
  }

  /**
   * @notice Adds liquidation values to totals
   */
  function _addLiquidationValuesToTotals(
    LiquidationTotals memory oldTotals,
    LiquidationValues memory singleLiquidation
  ) internal view returns (LiquidationTotals memory newTotals) {
    // Tally all the values with their respective running totals
    //update one of these
    newTotals.totalCollGasCompensation = _sumColls(
      oldTotals.totalCollGasCompensation,
      singleLiquidation.collGasCompensation
    );
    newTotals.totalYUSDGasCompensation = oldTotals.totalYUSDGasCompensation.add(
      singleLiquidation.YUSDGasCompensation
    );
    newTotals.totalDebtInSequence = oldTotals.totalDebtInSequence.add(
      singleLiquidation.entireTroveDebt
    );
    newTotals.totalDebtToOffset = oldTotals.totalDebtToOffset.add(
      singleLiquidation.debtToOffset
    );
    newTotals.totalCollToSendToSP = _sumColls(
      oldTotals.totalCollToSendToSP,
      singleLiquidation.collToSendToSP
    );
    newTotals.totalDebtToRedistribute = oldTotals.totalDebtToRedistribute.add(
      singleLiquidation.debtToRedistribute
    );
    newTotals.totalCollToRedistribute = _sumColls(
      oldTotals.totalCollToRedistribute,
      singleLiquidation.collToRedistribute
    );
    newTotals.totalCollSurplus = _sumColls(
      oldTotals.totalCollSurplus,
      singleLiquidation.collSurplus
    );
  }

  /**
   * @notice Get its offset coll/debt and Collateral gas comp, and close the trove
   */
  function _getCappedOffsetVals(
    uint256 _entireTroveDebt,
    address[] memory _troveTokens,
    uint256[] memory _troveAmountsToLiquidate,
    uint256[] memory _entireTroveAmounts,
    uint256[] memory _collGasCompensation
  ) internal view returns (LiquidationValues memory singleLiquidation) {
    uint256 USD_Value_To_Send_To_SP_Base_100 = MCR.mul(_entireTroveDebt);
    uint256 USD_Value_of_Trove_Colls = _getUSDColls(
      newColls(_troveTokens, _troveAmountsToLiquidate)
    );

    uint256 SPRatio = USD_Value_To_Send_To_SP_Base_100.mul(1e9).div(
      USD_Value_of_Trove_Colls
    );
    // Min between 100% with extra 1e9 precision, and SPRatio.
    SPRatio = YetiMath._min(SPRatio, SPRatioPrecision);

    singleLiquidation.entireTroveDebt = _entireTroveDebt;
    singleLiquidation.entireTroveColl.tokens = _troveTokens;
    singleLiquidation.entireTroveColl.amounts = _entireTroveAmounts;

    singleLiquidation.YUSDGasCompensation = YUSD_GAS_COMPENSATION;

    singleLiquidation.debtToOffset = _entireTroveDebt;
    singleLiquidation.debtToRedistribute = 0;

    singleLiquidation.collToSendToSP.tokens = _troveTokens;
    uint256 troveTokensLen = _troveTokens.length;

    singleLiquidation.collToSendToSP.amounts = new uint256[](troveTokensLen);

    singleLiquidation.collSurplus.tokens = _troveTokens;
    singleLiquidation.collSurplus.amounts = new uint256[](troveTokensLen);

    singleLiquidation.collGasCompensation.tokens = _troveTokens;
    singleLiquidation.collGasCompensation.amounts = _collGasCompensation;

    for (uint256 i; i < troveTokensLen; ++i) {
      uint256 _cappedCollAmount = SPRatio.mul(_troveAmountsToLiquidate[i]).div(
        SPRatioPrecision
      );
      uint256 _collSurplus = _troveAmountsToLiquidate[i].sub(_cappedCollAmount);

      singleLiquidation.collToSendToSP.amounts[i] = _cappedCollAmount;
      singleLiquidation.collSurplus.amounts[i] = _collSurplus;
    }
  }

  function _sendGasCompensation(
    IActivePool _activePool,
    address _liquidator,
    uint256 _YUSD,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) internal {
    if (_YUSD != 0) {
      yusdTokenContract.returnFromPool(gasPoolAddress, _liquidator, _YUSD);
    }

    _activePool.sendCollateralsUnwrap(_liquidator, _tokens, _amounts);
  }

  function _requireCallerisTroveManager() internal view {
    require(msg.sender == address(troveManager), "Caller not TM");
  }

  /**
   * @notice Return the amount of collateral to be drawn from a trove's collateral and sent as gas compensation
   */
  function _getCollGasCompensation(newColls memory _coll)
    internal
    pure
    returns (newColls memory)
  {
    uint256[] memory amounts = new uint256[](_coll.tokens.length);
    for (uint256 i; i < _coll.tokens.length; ++i) {
      amounts[i] = _coll.amounts[i] / PERCENT_DIVISOR;
    }
    return newColls(_coll.tokens, amounts);
  }

  /**
   * @notice Check whether or not the system *would be* in Recovery Mode, given the entire system coll and debt
   * @param _entireSystemColl The collateral of the entire system
   * @param _entireSystemDebt The debt of the entire system
   * @return returns true if the system would be in recovery mode and false if not
   */
  function _checkPotentialRecoveryMode(
    uint256 _entireSystemColl,
    uint256 _entireSystemDebt
  ) internal pure returns (bool) {
    uint256 TCR = _computeCR(_entireSystemColl, _entireSystemDebt);

    return TCR < CCR;
  }
}
