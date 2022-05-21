// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Dependencies/TroveManagerBase.sol";
import "../Dependencies/SafeERC20.sol";

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
 * @notice TroveManagerRedemptions is derived from TroveManager and handles all redemption activity of troves.
 * Instead of calculating redemption fees in ETH like Liquity used to, we now calculate it as a portion
 * of YUSD passed in to redeem. The YUSDAmount is still how much we would like to redeem, but the
 * YUSDFee is now the maximum amount of YUSD extra that will be paid and must be in the balance of the
 * redeemer for the redemption to succeed. This fee is the same as before in terms of percentage of value,
 * but now it is in terms of YUSD. We now use a helper function to be able to estimate how much YUSD will
 * be actually needed to perform a redemption of a certain amount, and also given an amount of YUSD balance,
 * the max amount of YUSD that can be used for a redemption, and a max fee such that it will always go through.
 *
 * Given a balance of YUSD, Z, the amount that can actually be redeemed is :
 * Y = YUSD you can actually redeem
 * BR = decayed base rate
 * X = YUSD Fee
 * S = Total YUSD Supply
 * The redemption fee rate is = (Y / S * 1 / BETA + BR + 0.5%)
 * This is because the new base rate = BR + Y / S * 1 / BETA
 * We pass in X + Y = Z, and want to find X and Y.
 * Y is calculated to be = S * (sqrt((1.005 + BR)**2 + BETA * Z / S) - 1.005 - BR)
 * through the quadratic formula, and X = Z - Y.
 * Therefore the amount we can actually redeem given Z is Y, and the max fee is X.
 *
 * To find how much the fee is given Y, we can multiply Y by the new base rate, which is BR + Y / S * 1 / BETA.
 *
 * To the redemption function, we pass in Y and X.
 */

contract TroveManagerRedemptions is TroveManagerBase, ITroveManagerRedemptions {
  bytes32 public constant NAME = "TroveManagerRedemptions";

  using SafeERC20 for IYUSDToken;

  ITroveManager internal troveManager;

  IYUSDToken internal yusdTokenContract;

  address internal gasPoolAddress;

  ISortedTroves internal sortedTroves;

  ICollSurplusPool internal collSurplusPool;

  struct RedemptionTotals {
    uint256 remainingYUSD;
    uint256 totalYUSDToRedeem;
    newColls CollsDrawn;
    uint256 YUSDfee;
    uint256 decayedBaseRate;
    uint256 totalYUSDSupplyAtStart;
    uint256 maxYUSDFeeAmount;
  }

  struct SingleRedemptionValues {
    uint256 YUSDLot;
    newColls CollLot;
    uint256 troveDebt;
    bool cancelledPartial;
  }

  struct Hints {
    address upper;
    address lower;
    address target;
    uint256 AICR;
  }

  /*
   * BETA: 18 digit decimal. Parameter by which to divide the redeemed fraction, in order to calc the new base rate from a redemption.
   * Corresponds to (1 / ALPHA) in the white paper.
   */
  uint256 public constant BETA = 2;

  bool redemptionsEnabled;

  // The borrower Fee Split is also parameter important for this contract, but it is mutable by timelock through YetiController.sol
  // thorugh function controller.getRedemptionBorrowerFeeSplit()
  // By default it is 20%

  event Redemption(
    uint256 _attemptedYUSDAmount,
    uint256 _actualYUSDAmount,
    uint256 YUSDfee,
    address[] tokens,
    uint256[] amounts
  );

  bool private addressSet;

  function setAddresses(
    address _activePoolAddress,
    address _defaultPoolAddress,
    address _gasPoolAddress,
    address _collSurplusPoolAddress,
    address _yusdTokenAddress,
    address _sortedTrovesAddress,
    address _controllerAddress,
    address _troveManagerAddress
  ) external {
    require(addressSet == false, "Addresses already set");
    addressSet = true;
    activePool = IActivePool(_activePoolAddress);
    defaultPool = IDefaultPool(_defaultPoolAddress);
    controller = IYetiController(_controllerAddress);
    gasPoolAddress = _gasPoolAddress;
    collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
    yusdTokenContract = IYUSDToken(_yusdTokenAddress);
    sortedTroves = ISortedTroves(_sortedTrovesAddress);
    troveManager = ITroveManager(_troveManagerAddress);
  }

  /**
   * @notice Main function for redeeming collateral. See above for how YUSDMaxFee is calculated.
   * @param _YUSDamount is equal to the amount of YUSD to actually redeem.
   * @param _YUSDMaxFee is equal to the max fee in YUSD that the sender is willing to pay
   * @param _firstRedemptionHint is the hint for the first trove to redeem against
   * @param _upperPartialRedemptionHint is the upper hint for reinsertion of last trove
   * @param _lowerPartialRedemptionHint is the lower hint for reinsertion of last trove
   * @param _partialRedemptionHintAICR is the target hint AICR for the last trove redeemed
   * @param _maxIterations is the maximum number of iterations to run the loop
   * @param _redeemer is the redeemer address
   * _YUSDamount + _YUSDMaxFee must be less than the balance of the sender.
   */
  function redeemCollateral(
    uint256 _YUSDamount,
    uint256 _YUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintAICR,
    uint256 _maxIterations,
    address _redeemer
  ) external override {
    _requireCallerisTroveManager();
    ContractsCache memory contractsCache = ContractsCache(
      activePool,
      defaultPool,
      yusdTokenContract,
      sortedTroves,
      collSurplusPool,
      gasPoolAddress,
      controller
    );
    RedemptionTotals memory totals;

    _requireValidMaxFee(_YUSDamount, _YUSDMaxFee);
    _requireRedemptionsEnabled();
    _requireTCRoverMCR();
    _requireAmountGreaterThanZero(_YUSDamount);

    totals.totalYUSDSupplyAtStart = getEntireSystemDebt();

    // Confirm redeemer's balance is less than total YUSD supply
    require(
      contractsCache.yusdToken.balanceOf(_redeemer) <=
        totals.totalYUSDSupplyAtStart,
      "TMR: redeemer balance too high"
    );

    totals.remainingYUSD = _YUSDamount;
    address currentBorrower;
    if (
      _isValidFirstRedemptionHint(
        contractsCache.sortedTroves,
        _firstRedemptionHint
      )
    ) {
      currentBorrower = _firstRedemptionHint;
    } else {
      currentBorrower = contractsCache.sortedTroves.getLast();
      // Find the first trove with ICR >= MCR
      while (
        currentBorrower != address(0) &&
        troveManager.getCurrentAICR(currentBorrower) < MCR
      ) {
        currentBorrower = contractsCache.sortedTroves.getPrev(currentBorrower);
      }
    }
    // Loop through the Troves starting from the one with lowest collateral ratio until _amount of YUSD is exchanged for collateral
    if (_maxIterations == 0) {
      _maxIterations = uint256(-1);
    }
    uint256 borrowerFeeSplit = contractsCache
      .controller
      .getRedemptionBorrowerFeeSplit();
    while (
      currentBorrower != address(0) &&
      totals.remainingYUSD != 0 &&
      _maxIterations != 0
    ) {
      _maxIterations--;
      // Save the address of the Trove preceding the current one, before potentially modifying the list
      address nextUserToCheck = contractsCache.sortedTroves.getPrev(
        currentBorrower
      );

      if (troveManager.getCurrentAICR(currentBorrower) >= MCR) {
        troveManager.applyPendingRewards(currentBorrower);

        SingleRedemptionValues
          memory singleRedemption = _redeemCollateralFromTrove(
            contractsCache,
            currentBorrower,
            _redeemer,
            totals.remainingYUSD,
            _upperPartialRedemptionHint,
            _lowerPartialRedemptionHint,
            _partialRedemptionHintAICR,
            borrowerFeeSplit
          );

        if (singleRedemption.cancelledPartial) {
          // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove
          // The YUSD Amount actually redeemed is thus less than the intended amount by some amount. totalYUSDToRedeem holds the correct value
          // Otherwise totalYUSDToRedeem == _YUSDAmount
          break;
        }

        totals.totalYUSDToRedeem = totals.totalYUSDToRedeem.add(
          singleRedemption.YUSDLot
        );

        totals.CollsDrawn = _sumColls(
          totals.CollsDrawn,
          singleRedemption.CollLot
        );
        totals.remainingYUSD = totals.remainingYUSD.sub(
          singleRedemption.YUSDLot
        );
      }

      currentBorrower = nextUserToCheck;
    }

    require(isNonzero(totals.CollsDrawn), "TMR:noCollsDrawn");
    // Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
    // Use the saved total YUSD supply value, from before it was reduced by the redemption.
    _updateBaseRateFromRedemption(
      totals.totalYUSDToRedeem,
      totals.totalYUSDSupplyAtStart
    );

    totals.YUSDfee = _getRedemptionFee(totals.totalYUSDToRedeem);
    uint256 borrowerSplitInYUSD = totals
      .totalYUSDToRedeem
      .mul(5e15)
      .div(DECIMAL_PRECISION)
      .mul(contractsCache.controller.getRedemptionBorrowerFeeSplit())
      .div(DECIMAL_PRECISION);
    // check user has enough YUSD to pay fee and redemptions
    // Already paid borrower split fee.
    _requireYUSDBalanceCoversRedemption(
      contractsCache.yusdToken,
      _redeemer,
      totals.totalYUSDToRedeem.add(totals.YUSDfee).sub(borrowerSplitInYUSD)
    );

    // check to see that the fee doesn't exceed the max fee
    _requireUserAcceptsFeeRedemption(totals.YUSDfee, _YUSDMaxFee);

    // send fee from user to YETI stakers and treasury
    _transferAndSplitFee(
      contractsCache,
      _redeemer,
      totals.YUSDfee,
      borrowerSplitInYUSD
    );

    emit Redemption(
      _YUSDamount,
      totals.totalYUSDToRedeem,
      totals.YUSDfee,
      totals.CollsDrawn.tokens,
      totals.CollsDrawn.amounts
    );
    // Burn the total YUSD that is cancelled with debt
    contractsCache.yusdToken.burn(_redeemer, totals.totalYUSDToRedeem);
    // Update Active Pool YUSD, and send Collaterals to account
    contractsCache.activePool.decreaseYUSDDebt(totals.totalYUSDToRedeem);

    contractsCache.activePool.sendCollateralsUnwrap(
      _redeemer,
      totals.CollsDrawn.tokens,
      totals.CollsDrawn.amounts
    );
  }

  /**
   * @notice Secondary function for redeeming collateral. See above for how YUSDMaxFee is calculated.
   *         Redeems one collateral type from only one trove. Included for gas efficiency of arbitrages.
   * @param _YUSDamount is equal to the amount of YUSD to actually redeem.
   * @param _YUSDMaxFee is equal to the max fee in YUSD that the sender is willing to pay
   * @param _target is the hint for the single trove to redeem against
   * @param _upperHint is the upper hint for reinsertion of the trove
   * @param _lowerHint is the lower hint for reinsertion of the trove
   * @param _hintAICR is the target hint AICR for the the trove redeemed
   * @param _collToRedeem is the collateral address to redeem. Only this token.
   * _YUSDamount + _YUSDMaxFee must be less than the balance of the sender.
   */
  function redeemCollateralSingle(
    uint256 _YUSDamount,
    uint256 _YUSDMaxFee,
    address _target, // _firstRedemptionHint
    address _upperHint, // _upperPartialRedemptionHint
    address _lowerHint, // _lowerPartialRedemptionHint
    uint256 _hintAICR, // _partialRedemptionHintAICR
    address _collToRedeem,
    address _redeemer
  ) external override {
    _requireCallerisTroveManager();
    ContractsCache memory contractsCache = ContractsCache(
      activePool,
      defaultPool,
      yusdTokenContract,
      sortedTroves,
      collSurplusPool,
      gasPoolAddress,
      controller
    );
    RedemptionTotals memory totals;

    _requireValidMaxFee(_YUSDamount, _YUSDMaxFee);
    _requireRedemptionsEnabled();
    _requireTCRoverMCR();
    _requireAmountGreaterThanZero(_YUSDamount);
    totals.totalYUSDSupplyAtStart = getEntireSystemDebt();

    // Confirm redeemer's balance is less than total YUSD supply
    require(
      contractsCache.yusdToken.balanceOf(_redeemer) <=
        totals.totalYUSDSupplyAtStart,
      "TMR:Redeemer YUSD Bal too high"
    );

    totals.remainingYUSD = _YUSDamount;
    require(
      _isValidFirstRedemptionHint(contractsCache.sortedTroves, _target),
      "TMR:Invalid first redemption hint"
    );
    troveManager.applyPendingRewards(_target);

    SingleRedemptionValues memory singleRedemption;
    // Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve

    uint256[] memory amounts;
    (
      singleRedemption.CollLot.tokens,
      amounts,
      singleRedemption.troveDebt
    ) = troveManager.getCurrentTroveState(_target);

    singleRedemption.YUSDLot = YetiMath._min(
      totals.remainingYUSD,
      singleRedemption.troveDebt.sub(YUSD_GAS_COMPENSATION)
    );

    uint256 i; // i term will be used as the index of the collateral to redeem later too
    uint256 tokensLen = singleRedemption.CollLot.tokens.length;
    {
      //Make sure single collateral to redeem exists in trove
      bool foundCollateral;

      for (i = 0; i < tokensLen; ++i) {
        if (singleRedemption.CollLot.tokens[i] == _collToRedeem) {
          foundCollateral = true;
          break;
        }
      }
      require(foundCollateral, "TMR:Coll not in trove");
    }

    {
      // Get usd value of only the collateral being redeemed
      uint256 singleCollUSD = contractsCache.controller.getValueUSD(
        _collToRedeem,
        amounts[i]
      );

      // Cap redemption amount to the max amount of collateral that can be redeemed
      singleRedemption.YUSDLot = YetiMath._min(
        singleCollUSD,
        singleRedemption.YUSDLot
      );

      // redemption addresses are the same as coll addresses for trove
      // Calculation for how much collateral to send of each type.
      singleRedemption.CollLot.amounts = new uint256[](tokensLen);

      uint256 tokenAmountToRedeem = singleRedemption
        .YUSDLot
        .mul(amounts[i])
        .div(singleCollUSD);
      amounts[i] = amounts[i].sub(tokenAmountToRedeem);
      singleRedemption.CollLot.amounts[i] = tokenAmountToRedeem;
    }

    // Send the trove being redeemed against 20% of the minimum fee of 0.5%
    _sendBorrowerFeeSplit(
      contractsCache,
      _redeemer,
      _target,
      singleRedemption.YUSDLot,
      contractsCache.controller.getRedemptionBorrowerFeeSplit()
    );

    // Decrease the debt and collateral of the current Trove according to the YUSD lot and corresponding Collateral to send
    singleRedemption.troveDebt = singleRedemption.troveDebt.sub(
      singleRedemption.YUSDLot
    );

    if (singleRedemption.troveDebt == YUSD_GAS_COMPENSATION) {
      // No debt left in the Trove (except for the liquidation reserve), therefore the trove gets closed
      troveManager.removeStake(_target);
      troveManager.closeTroveRedemption(_target);
      _redeemCloseTrove(
        contractsCache,
        _target,
        YUSD_GAS_COMPENSATION,
        singleRedemption.CollLot.tokens,
        amounts
      );

      emit TroveUpdated(
        _target,
        0,
        new address[](0),
        new uint256[](0),
        TroveManagerOperation.redeemCollateral
      );
    } else {
      uint256 newAICR = _getAICRColls(
        newColls(singleRedemption.CollLot.tokens, amounts),
        singleRedemption.troveDebt
      );

      /*
       * If the provided hint is too inaccurate of date, we bail since trying to reinsert without a good hint will almost
       * certainly result in running out of gas. Arbitrary measures of this mean newAICR must be greater than hint AICR - 2%,
       * and smaller than hint ICR + 2%.
       *
       * If the resultant net debt of the partial is less than the minimum, net debt we bail.
       */
      {
        // Stack scope
        if (
          newAICR >= _hintAICR.add(2e16) ||
          newAICR <= _hintAICR.sub(2e16) ||
          _getNetDebt(singleRedemption.troveDebt) < MIN_NET_DEBT
        ) {
          revert(
            "Invalid partial redemption hint or remaining debt is too low"
          );
        }

        contractsCache.sortedTroves.reInsert(
          _target,
          newAICR,
          _upperHint,
          _lowerHint
        );
      }
      troveManager.updateTroveDebt(_target, singleRedemption.troveDebt);
      troveManager.updateTroveCollAndStakeAndTotalStakes(
        _target,
        singleRedemption.CollLot.tokens,
        amounts
      );

      emit TroveUpdated(
        _target,
        singleRedemption.troveDebt,
        singleRedemption.CollLot.tokens,
        amounts,
        TroveManagerOperation.redeemCollateral
      );
    }

    totals.totalYUSDToRedeem = singleRedemption.YUSDLot;

    totals.CollsDrawn = singleRedemption.CollLot;

    require(isNonzero(totals.CollsDrawn), "TMR: non zero collsDrawn");
    // Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
    // Use the saved total YUSD supply value, from before it was reduced by the redemption.
    _updateBaseRateFromRedemption(
      totals.totalYUSDToRedeem,
      totals.totalYUSDSupplyAtStart
    );

    totals.YUSDfee = _getRedemptionFee(totals.totalYUSDToRedeem);

    uint256 borrowerSplitInYUSD = totals
      .totalYUSDToRedeem
      .mul(5e15)
      .div(DECIMAL_PRECISION)
      .mul(contractsCache.controller.getRedemptionBorrowerFeeSplit())
      .div(DECIMAL_PRECISION);

    // check user has enough YUSD to pay fee and redemptions
    // Already paid borrower split fee.
    _requireYUSDBalanceCoversRedemption(
      contractsCache.yusdToken,
      _redeemer,
      totals.remainingYUSD.add(totals.YUSDfee).sub(borrowerSplitInYUSD)
    );

    // check to see that the fee doesn't exceed the max fee
    _requireUserAcceptsFeeRedemption(totals.YUSDfee, _YUSDMaxFee);

    // send fee from user to YETI stakers and treasury
    _transferAndSplitFee(
      contractsCache,
      _redeemer,
      totals.YUSDfee,
      borrowerSplitInYUSD
    );

    emit Redemption(
      totals.remainingYUSD,
      totals.totalYUSDToRedeem,
      totals.YUSDfee,
      totals.CollsDrawn.tokens,
      totals.CollsDrawn.amounts
    );
    // Burn the total YUSD that is cancelled with debt
    contractsCache.yusdToken.burn(_redeemer, totals.totalYUSDToRedeem);
    // Update Active Pool YUSD, and send Collaterals to account
    contractsCache.activePool.decreaseYUSDDebt(totals.totalYUSDToRedeem);

    contractsCache.activePool.sendCollateralsUnwrap(
      _redeemer, // tokens to
      totals.CollsDrawn.tokens,
      totals.CollsDrawn.amounts
    );
  }

  /**
   * @notice Redeem as much collateral as possible from _borrower's Trove in exchange for YUSD up to _maxYUSDamount
   * Special calculation for determining how much collateral to send of each type to send.
   * We want to redeem equivalent to the USD value instead of the VC value here, so we take the YUSD amount
   * which we are redeeming from this trove, and calculate the ratios at which we would redeem a single
   * collateral type compared to all others.
   * For example if we are redeeming 10,000 from this trove, and it has collateral A with a safety ratio of 1,
   * collateral B with safety ratio of 0.5. Let's say their price is each 1. The trove is composed of 10,000 A and
   * 10,000 B, so we would redeem 5,000 A and 5,000 B, instead of 6,666 A and 3,333 B. To do calculate this we take
   * the USD value of that collateral type, and divide it by the total USD value of all collateral types. The price
   * actually cancels out here so we just do YUSD amount * token amount / total USD value, instead of
   * YUSD amount * token value / total USD value / token price, since we are trying to find token amount.
   * @param _borrower The address of the borrower
   * @param _redeemer The address of the redeemer
   * @param _maxYUSDAmount Passed in, try to redeem up to this amount of YUSD
   * @param _upperPartialRedemptionHint is the upper hint for reinsertion of last trove
   * @param _lowerPartialRedemptionHint is the lower hint for reinsertion of last trove
   * @param _partialRedemptionHintAICR is the target hint AICR for the last trove redeemed
   * @return singleRedemption is the data about the redemption that was made, including collsDrawn, debtDrawn, etc.
   */
  function _redeemCollateralFromTrove(
    ContractsCache memory contractsCache,
    address _borrower,
    address _redeemer,
    uint256 _maxYUSDAmount,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintAICR,
    uint256 _redemptionBorrowerFeeSplit
  ) internal returns (SingleRedemptionValues memory singleRedemption) {
    uint256[] memory amounts;
    (
      singleRedemption.CollLot.tokens,
      amounts,
      singleRedemption.troveDebt
    ) = troveManager.getCurrentTroveState(_borrower);

    uint256 collsLen = singleRedemption.CollLot.tokens.length;
    uint256[] memory finalAmounts = new uint256[](collsLen);

    // Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
    singleRedemption.YUSDLot = YetiMath._min(
      _maxYUSDAmount,
      singleRedemption.troveDebt.sub(YUSD_GAS_COMPENSATION)
    );

    // redemption addresses are the same as coll addresses for trove
    // Calculation for how much collateral to send of each type.
    singleRedemption.CollLot.amounts = new uint256[](collsLen);
    {
      uint256 totalCollUSD = _getUSDColls(
        newColls(singleRedemption.CollLot.tokens, amounts)
      );
      uint256 baseLot = singleRedemption.YUSDLot.mul(DECIMAL_PRECISION);
      for (uint256 i; i < collsLen; ++i) {
        uint256 tokenAmountToRedeem = baseLot
          .mul(amounts[i])
          .div(totalCollUSD)
          .div(1e18);

        finalAmounts[i] = amounts[i].sub(tokenAmountToRedeem);
        singleRedemption.CollLot.amounts[i] = tokenAmountToRedeem;
      }
    }

    // Decrease the debt and collateral of the current Trove according to the YUSD lot and corresponding Collateral to send
    uint256 newDebt = singleRedemption.troveDebt.sub(singleRedemption.YUSDLot);

    if (newDebt == YUSD_GAS_COMPENSATION) {
      // No debt left in the Trove (except for the liquidation reserve), therefore the trove gets closed
      troveManager.removeStake(_borrower);
      troveManager.closeTroveRedemption(_borrower);
      _redeemCloseTrove(
        contractsCache,
        _borrower,
        YUSD_GAS_COMPENSATION,
        singleRedemption.CollLot.tokens,
        finalAmounts
      );

      emit TroveUpdated(
        _borrower,
        0,
        new address[](0),
        new uint256[](0),
        TroveManagerOperation.redeemCollateral
      );
    } else {
      uint256 newAICR = _computeCR(
        _getRVC(singleRedemption.CollLot.tokens, finalAmounts),
        newDebt
      );

      /*
       * If the provided hint is too inaccurate of date, we bail since trying to reinsert without a good hint will almost
       * certainly result in running out of gas. Arbitrary measures of this mean newICR must be greater than hint ICR - 2%,
       * and smaller than hint ICR + 2%.
       *
       * If the resultant net debt of the partial is less than the minimum, net debt we bail.
       */

      if (
        newAICR >= _partialRedemptionHintAICR.add(2e16) ||
        newAICR <= _partialRedemptionHintAICR.sub(2e16) ||
        _getNetDebt(newDebt) < MIN_NET_DEBT
      ) {
        singleRedemption.cancelledPartial = true;
        return singleRedemption;
      }

      contractsCache.sortedTroves.reInsert(
        _borrower,
        newAICR,
        _upperPartialRedemptionHint,
        _lowerPartialRedemptionHint
      );

      troveManager.updateTroveDebt(_borrower, newDebt);
      collsLen = singleRedemption.CollLot.tokens.length;
      for (uint256 i; i < collsLen; ++i) {
        amounts[i] = finalAmounts[i];
      }
      troveManager.updateTroveCollAndStakeAndTotalStakes(
        _borrower,
        singleRedemption.CollLot.tokens,
        amounts
      );

      emit TroveUpdated(
        _borrower,
        newDebt,
        singleRedemption.CollLot.tokens,
        finalAmounts,
        TroveManagerOperation.redeemCollateral
      );
    }

    // Send the trove being redeemed against 20% of the minimum fee of 0.5%
    // Send after all other logic to skip the cancelledPartial possibility, where they are eligible for no fee.
    _sendBorrowerFeeSplit(
      contractsCache,
      _redeemer,
      _borrower,
      singleRedemption.YUSDLot,
      _redemptionBorrowerFeeSplit
    );
  }

  function updateRedemptionsEnabled(bool _enabled) external override {
    _requireCallerisController();
    redemptionsEnabled = _enabled;
  }

  /*
   * @notice Called when a full redemption occurs, and closes the trove.
   * The redeemer swaps (debt - liquidation reserve) YUSD for (debt - liquidation reserve) worth of Collateral, so the YUSD liquidation reserve left corresponds to the remaining debt.
   * In order to close the trove, the YUSD liquidation reserve is burned, and the corresponding debt is removed from the active pool.
   * The debt recorded on the trove's struct is zero'd elswhere, in _closeTrove.
   * Any surplus Collateral left in the trove, is sent to the Coll surplus pool, and can be later claimed by the borrower.
   * @param _YUSD Liquidation reserve to burn
   * @param _colls Collateral to send to coll surplus pool
   * @param _collsAmounts Amounts of collateral to send to coll surplus pool
   */
  function _redeemCloseTrove(
    ContractsCache memory contractsCache,
    address _borrower,
    uint256 _YUSD,
    address[] memory _remainingColls,
    uint256[] memory _remainingCollsAmounts
  ) internal {
    contractsCache.yusdToken.burn(gasPoolAddress, _YUSD);
    // Update Active Pool YUSD, and send Collateral to account
    contractsCache.activePool.decreaseYUSDDebt(_YUSD);

    // send Collaterals from Active Pool to CollSurplus Pool
    contractsCache.collSurplusPool.accountSurplus(
      _borrower,
      _remainingColls,
      _remainingCollsAmounts
    );
    contractsCache.activePool.sendCollaterals(
      address(contractsCache.collSurplusPool),
      _remainingColls,
      _remainingCollsAmounts
    );
  }

  /*
   * @notice This function has two impacts on the baseRate state variable:
   * 1) decays the baseRate based on time passed since last redemption or YUSD borrowing operation.
   * then,
   * 2) increases the baseRate based on the amount redeemed, as a proportion of total supply
   * @param _YUSDDrawn : Amount of YUSD Drawn total from this redemption
   * @param _totalYUSDSupply : Total YUSD supply to decay base rate from.
   */
  function _updateBaseRateFromRedemption(
    uint256 _YUSDDrawn,
    uint256 _totalYUSDSupply
  ) internal returns (uint256) {
    uint256 decayedBaseRate = troveManager.calcDecayedBaseRate();

    /* Convert the drawn Collateral back to YUSD at face value rate (1 YUSD:1 USD), in order to get
     * the fraction of total supply that was redeemed at face value. */
    uint256 redeemedYUSDFraction = _YUSDDrawn.mul(1e18).div(_totalYUSDSupply);

    uint256 newBaseRate = decayedBaseRate.add(redeemedYUSDFraction.div(BETA));
    newBaseRate = YetiMath._min(newBaseRate, DECIMAL_PRECISION); // cap baseRate at a maximum of 100%

    troveManager.updateBaseRate(newBaseRate);
    return newBaseRate;
  }

  /**
   * @notice Checks that the first redemption hint is correct considering the state of sortedTroves
   */
  function _isValidFirstRedemptionHint(
    ISortedTroves _sortedTroves,
    address _firstRedemptionHint
  ) internal view returns (bool) {
    if (
      _firstRedemptionHint == address(0) ||
      !_sortedTroves.contains(_firstRedemptionHint) ||
      troveManager.getCurrentICR(_firstRedemptionHint) < MCR
    ) {
      return false;
    }

    address nextTrove = _sortedTroves.getNext(_firstRedemptionHint);
    return
      nextTrove == address(0) || troveManager.getCurrentICR(nextTrove) < MCR;
  }

  function _requireUserAcceptsFeeRedemption(uint256 _actualFee, uint256 _maxFee)
    internal
    pure
  {
    require(_actualFee <= _maxFee, "TMR:User must accept fee");
  }

  function _requireValidMaxFee(uint256 _YUSDAmount, uint256 _maxYUSDFee)
    internal
    pure
  {
    uint256 _maxFeePercentage = _maxYUSDFee.mul(DECIMAL_PRECISION).div(
      _YUSDAmount
    );
    require(
      _maxFeePercentage >= REDEMPTION_FEE_FLOOR,
      "TMR:Passed in max fee <0.5%"
    );
    require(
      _maxFeePercentage <= DECIMAL_PRECISION,
      "TMR:Passed in max fee >100%"
    );
  }

  function _requireRedemptionsEnabled() internal view {
    require(redemptionsEnabled, "TMR:RedemptionsDisabled");
  }

  function _requireTCRoverMCR() internal view {
    require(_getTCR() >= MCR, "TMR: Cannot redeem when TCR<MCR");
  }

  function _requireAmountGreaterThanZero(uint256 _amount) internal pure {
    require(_amount != 0, "TMR:ReqNonzeroAmount");
  }

  function _requireYUSDBalanceCoversRedemption(
    IYUSDToken _yusdToken,
    address _redeemer,
    uint256 _amount
  ) internal view {
    require(
      _yusdToken.balanceOf(_redeemer) >= _amount,
      "TMR:InsufficientYUSDBalance"
    );
  }

  function isNonzero(newColls memory coll) internal pure returns (bool) {
    uint256 collsLen = coll.amounts.length;
    for (uint256 i; i < collsLen; ++i) {
      if (coll.amounts[i] != 0) {
        return true;
      }
    }
    return false;
  }

  function _requireCallerisTroveManager() internal view {
    require(msg.sender == address(troveManager), "TMR:Caller not TM");
  }

  function _requireCallerisController() internal view {
    require(msg.sender == address(controller), "TMR:Caller not Controller");
  }

  function _getRedemptionFee(uint256 _YUSDRedeemed)
    internal
    view
    returns (uint256)
  {
    return _calcRedemptionFee(troveManager.getRedemptionRate(), _YUSDRedeemed);
  }

  function _calcRedemptionFee(uint256 _redemptionRate, uint256 _YUSDRedeemed)
    internal
    pure
    returns (uint256)
  {
    uint256 redemptionFee = _redemptionRate.mul(_YUSDRedeemed).div(
      DECIMAL_PRECISION
    );
    require(redemptionFee < _YUSDRedeemed, "TM: Fee > YUSD Redeemed");
    return redemptionFee;
  }

  /**
   * @notice Transfers the fee from the redeemer to the treasury partially, and the rest to the Fee recipient (sYETI) Contract
   * @param _YUSDFee : YUSD Fee which has been calculated from the amount redeemed
   * @param _borrowerSplitInYUSD : The amount in YUSD which has already been transferred to the borrower
   */
  function _transferAndSplitFee(
    ContractsCache memory contractsCache,
    address _redeemer,
    uint256 _YUSDFee,
    uint256 _borrowerSplitInYUSD
  ) internal {
    (
      uint256 treasuryFeeSplit,
      address yetiTreasury,
      address YUSDFeeRecipient
    ) = contractsCache.controller.getFeeSplitInformation();
    // Get the treasury split in YUSD
    uint256 treasurySplitInYUSD = treasuryFeeSplit.mul(_YUSDFee).div(
      DECIMAL_PRECISION
    );
    // If the treasury fee split is more than 1 - borrower split, then the treasury will receive the remainder instead of its supposed split
    treasurySplitInYUSD = YetiMath._min(
      treasurySplitInYUSD,
      _YUSDFee.sub(_borrowerSplitInYUSD)
    );

    // Send a percentage to the treasury
    contractsCache.yusdToken.safeTransferFrom(
      _redeemer,
      yetiTreasury,
      treasurySplitInYUSD
    );

    // And send the rest to YUSDFeeRecipient
    contractsCache.yusdToken.safeTransferFrom(
      _redeemer,
      YUSDFeeRecipient,
      _YUSDFee.sub(treasurySplitInYUSD).sub(_borrowerSplitInYUSD)
    );
  }

  /**
   * @notice Send a flat rate of the base redeem fee to the borrower who is being redeemed again.
   * The extra is accounted for in the collsurpluspool
   * @param _redeemedAmount : Amount redeemed, send 20% * 0.5% to the borrower.
   */
  function _sendBorrowerFeeSplit(
    ContractsCache memory contractsCache,
    address _redeemer,
    address _borrower,
    uint256 _redeemedAmount,
    uint256 _redemptionBorrowerFeeSplit
  ) internal {
    uint256 toSendToBorrower = (_redeemedAmount)
      .mul(5e15)
      .div(DECIMAL_PRECISION)
      .mul(_redemptionBorrowerFeeSplit)
      .div(DECIMAL_PRECISION);
    contractsCache.yusdToken.safeTransferFrom(
      _redeemer,
      address(contractsCache.collSurplusPool),
      toSendToBorrower
    );
    contractsCache.collSurplusPool.accountRedemptionBonus(
      _borrower,
      toSendToBorrower
    );
  }
}
