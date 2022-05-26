// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Interfaces/ITroveManager.sol";
import "../Interfaces/ISortedTroves.sol";
import "../Interfaces/IPreonController.sol";
import "../Interfaces/ITroveManagerLiquidations.sol";
import "../Interfaces/ITroveManagerRedemptions.sol";
import "../Interfaces/IERC20.sol";
import "../Dependencies/TroveManagerBase.sol";
import "../Dependencies/ReentrancyGuardUpgradeable.sol";

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
 * @title Deals with state of all system troves
 * @notice It has all the external functions for liquidations, redemptions,
 * as well as functions called by BorrowerOperations function calls.
 */

contract TroveManager is
  TroveManagerBase,
  ITroveManager,
  ReentrancyGuardUpgradeable
{
  address internal borrowerOperationsAddress;

  ITroveManager internal troveManager;

  ITroveManagerRedemptions internal troveManagerRedemptions;

  ITroveManagerLiquidations internal troveManagerLiquidations;

  ISortedTroves internal sortedTroves;

  bytes32 public constant NAME = "TroveManager";

  // --- Data structures ---

  uint256 internal constant SECONDS_IN_ONE_MINUTE = 60;

  /*
   * Half-life of 12h. 12h = 720 min
   * (1/2) = d^720 => d = (1/2)^(1/720)
   */
  uint256 public constant MINUTE_DECAY_FACTOR = 999037758833783000;
  uint256 public constant MAX_BORROWING_FEE = (DECIMAL_PRECISION * 5) / 100; // 5%

  // During bootsrap period redemptions are not allowed
  uint256 public constant BOOTSTRAP_PERIOD = 14 days;

  // See documentation for explanation of baseRate
  uint256 public baseRate;

  // The timestamp of the latest fee operation (redemption or new PUSD issuance)
  uint256 public lastFeeOperationTime;

  // Mapping of all troves in the system
  mapping(address => Trove) Troves;

  // Total stakes keeps track of the sum of all stakes for each collateral, across all users.
  mapping(address => uint256) public totalStakes;

  // Snapshot of the value of totalStakes, taken immediately after the latest liquidation
  mapping(address => uint256) public totalStakesSnapshot;

  // Snapshot of the total collateral across the ActivePool and DefaultPool, immediately after the latest liquidation.
  mapping(address => uint256) public totalCollateralSnapshot;

  /*
   * L_Coll and L_PUSDDebt track the sums of accumulated liquidation rewards per unit staked. Each collateral type has
   * its own L_Coll and L_PUSDDebt.
   * During its lifetime, each stake earns:
   *
   * A Collateral gain of ( stake * [L_Coll[coll] - L_Coll[coll](0)] )
   * A PUSDDebt increase  of ( stake * [L_PUSDDebt - L_PUSDDebt(0)] )
   *
   * Where L_Coll[coll](0) and L_PUSDDebt(0) are snapshots of L_Coll[coll] and L_PUSDDebt for the active Trove taken at the instant the stake was made
   */
  mapping(address => uint256) public L_Coll;
  mapping(address => uint256) public L_PUSDDebt;

  // Map addresses with active troves to their RewardSnapshot
  mapping(address => RewardSnapshot) rewardSnapshots;

  // Object containing the reward snapshots for a given active trove
  struct RewardSnapshot {
    mapping(address => uint256) CollRewards;
    mapping(address => uint256) PUSDDebts;
  }

  // Array of all active trove addresses - used to to compute an approximate hint off-chain, for the sorted list insertion
  address[] public TroveOwners;

  // Error trackers for the trove redistribution calculation
  mapping(address => uint256) public lastCollError_Redistribution;
  mapping(address => uint256) public lastPUSDDebtError_Redistribution;

  /*
   * --- Variable container structs for liquidations ---
   *
   * These structs are used to hold, return and assign variables inside the liquidation functions,
   * in order to avoid the error: "CompilerError: Stack too deep".
   **/

  // --- Events ---

  event BaseRateUpdated(uint256 _baseRate);
  event LastFeeOpTimeUpdated(uint256 _lastFeeOpTime);
  event TotalStakesUpdated(address token, uint256 _newTotalStakes);
  event SystemSnapshotsUpdated(uint256 _unix);

  event Liquidation(
    uint256 liquidatedAmount,
    uint256 totalPUSDGasCompensation,
    address[] totalCollTokens,
    uint256[] totalCollAmounts,
    address[] totalCollGasCompTokens,
    uint256[] totalCollGasCompAmounts
  );

  event LTermsUpdated(
    address _Coll_Address,
    uint256 _L_Coll,
    uint256 _L_PUSDDebt
  );
  event TroveSnapshotsUpdated(uint256 _unix);
  event TroveIndexUpdated(address _borrower, uint256 _newIndex);
  event TroveUpdated(
    address indexed _borrower,
    uint256 _debt,
    address[] _tokens,
    uint256[] _amounts,
    TroveManagerOperation operation
  );

  bool private addressSet;

  function setAddresses(
    address _borrowerOperationsAddress,
    address _activePoolAddress,
    address _defaultPoolAddress,
    address _sortedTrovesAddress,
    address _controllerAddress,
    address _troveManagerRedemptionsAddress,
    address _troveManagerLiquidationsAddress
  ) external override {
    require(addressSet == false, "Addresses already set");
    addressSet = true;
    __ReentrancyGuard_init();

    borrowerOperationsAddress = _borrowerOperationsAddress;
    activePool = IActivePool(_activePoolAddress);
    defaultPool = IDefaultPool(_defaultPoolAddress);
    controller = IPreonController(_controllerAddress);
    sortedTroves = ISortedTroves(_sortedTrovesAddress);
    troveManagerRedemptions = ITroveManagerRedemptions(
      _troveManagerRedemptionsAddress
    );
    troveManagerLiquidations = ITroveManagerLiquidations(
      _troveManagerLiquidationsAddress
    );
  }

  // --- Trove Liquidation functions ---

  /**
   * @notice Single liquidation function. Closes the trove if its ICR is lower than the minimum collateral ratio.
   * @param _borrower The address of the Trove owner
   */
  function liquidate(address _borrower) external override nonReentrant {
    _requireTroveIsActive(_borrower);

    address[] memory borrowers = new address[](1);
    borrowers[0] = _borrower;
    troveManagerLiquidations.batchLiquidateTroves(borrowers, msg.sender);
  }

  /**
   * @notice Attempt to liquidate a custom list of troves provided by the caller.
   * @param _troveArray The list of Troves' Addresses
   * @param _liquidator The address of the liquidator
   */
  function batchLiquidateTroves(
    address[] memory _troveArray,
    address _liquidator
  ) external override nonReentrant {
    troveManagerLiquidations.batchLiquidateTroves(_troveArray, _liquidator);
  }

  // --- Liquidation helper functions ---

  /**
   * @notice Move a Trove's pending debt and collateral rewards from distributions, from the Default Pool to the Active Pool
   */
  function _movePendingTroveRewardsToActivePool(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _PUSD,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) internal {
    _defaultPool.decreasePUSDDebt(_PUSD);
    _activePool.increasePUSDDebt(_PUSD);
    _defaultPool.sendCollsToActivePool(_tokens, _amounts);
  }

  /**
   * @notice Update position for a set of troves using latest price data. This can be called by anyone.
   * Preon Finance will also be running a bot to assist with keeping the list from becoming too stale.
   * @param _borrowers The list of addresses of the troves to update
   * @param _lowerHints The list of lower hints for the troves which are to be updated
   * @param _upperHints The list of upper hints for the troves which are to be updated
   */
  function updateTroves(
    address[] calldata _borrowers,
    address[] calldata _lowerHints,
    address[] calldata _upperHints
  ) external override {
    uint256 lowerHintsLen = _lowerHints.length;
    _revertLenInput(
      _borrowers.length == lowerHintsLen && lowerHintsLen == _upperHints.length
    );

    uint256[] memory AICRList = new uint256[](lowerHintsLen);

    for (uint256 i; i < lowerHintsLen; ++i) {
      (
        address[] memory tokens,
        uint256[] memory amounts,
        uint256 debt
      ) = _getCurrentTroveState(_borrowers[i]);
      AICRList[i] = _getAICR(tokens, amounts, debt);
    }
    sortedTroves.reInsertMany(_borrowers, AICRList, _lowerHints, _upperHints);
  }

  /**
   * @notice Update a particular trove address in the underCollateralized troves list
   * @dev This function is called by the UpdateTroves bot if there are many underCollateralized troves
   * during congested network conditions where potentially it is tough to liquidate them all.
   * In this case, the function adds to the underCollateralizedTroves list so no SP withdrawal can happen.
   * If the trove is no longer underCollateralized then this function will remove
   * it from the list. This function calls sortedTroves' updateUnderCollateralizedTrove function.
   * Intended to be a cheap function call since it is going to be called when liquidations are not possible
   * @param _ids Trove ids
   */
  function updateUnderCollateralizedTroves(address[] memory _ids)
    external
    override
  {
    uint256 len = _ids.length;
    for (uint256 i; i < len; i++) {
      uint256 ICR = getCurrentICR(_ids[i]);
      // If ICR < MCR, is undercollateralized
      _updateUnderCollateralizedTrove(_ids[i], ICR < MCR);
    }
  }

  /**
   * @notice Send _PUSDamount PUSD to the system and redeem the corresponding amount of collateral
   * from as many Troves as are needed to fill the redemption request. Applies pending rewards to a Trove before reducing its debt and coll.
   * @dev if _amount is very large, this function can run out of gas, specially if traversed troves are small. This can be easily avoided by
   * splitting the total _amount in appropriate chunks and calling the function multiple times.
   *
   * Param `_maxIterations` can also be provided, so the loop through Troves is capped (if it’s zero, it will be ignored).This makes it easier to
   * avoid OOG for the frontend, as only knowing approximately the average cost of an iteration is enough, without needing to know the “topology”
   * of the trove list. It also avoids the need to set the cap in stone in the contract, nor doing gas calculations, as both gas price and opcode
   * costs can vary.
   *
   * All Troves that are redeemed from -- with the likely exception of the last one -- will end up with no debt left, therefore they will be closed.
   * If the last Trove does have some remaining debt, it has a finite ICR, and the reinsertion could be anywhere in the list, therefore it requires a hint.
   * A frontend should use getRedemptionHints() to calculate what the ICR of this Trove will be after redemption, and pass a hint for its position
   * in the sortedTroves list along with the ICR value that the hint was found for.
   *
   * If another transaction modifies the list between calling getRedemptionHints() and passing the hints to redeemCollateral(), it is very
   * likely that the last (partially) redeemed Trove would end up with a different ICR than what the hint is for. In this case the redemption
   * will stop after the last completely redeemed Trove and the sender will keep the remaining PUSD amount, which they can attempt to redeem later.
   * @param _PUSDamount The intended amount of PUSD to redeem
   * @param _PUSDMaxFee The maximum accepted fee in PUSD the user is willing to pay
   * @param _firstRedemptionHint The hint for the position of the first redeemed Trove in the sortedTroves list
   * @param _upperPartialRedemptionHint The upper hint for the position of the last partially redeemed Trove in the sortedTroves list
   * @param _lowerPartialRedemptionHint The lower hint for the position of the last partially redeemed Trove in the sortedTroves list
   * @param _partialRedemptionHintAICR The AICR of the last partially redeemed Trove in the sortedTroves list
   * @param _maxIterations The maximum number of iterations to perform. If zero, the function will run until it runs out of gas.
   */
  function redeemCollateral(
    uint256 _PUSDamount,
    uint256 _PUSDMaxFee,
    address _firstRedemptionHint,
    address _upperPartialRedemptionHint,
    address _lowerPartialRedemptionHint,
    uint256 _partialRedemptionHintAICR,
    uint256 _maxIterations
  ) external override nonReentrant {
    troveManagerRedemptions.redeemCollateral(
      _PUSDamount,
      _PUSDMaxFee,
      _firstRedemptionHint,
      _upperPartialRedemptionHint,
      _lowerPartialRedemptionHint,
      _partialRedemptionHintAICR,
      _maxIterations,
      msg.sender
    );
  }

  /**
   * @notice Secondary function for redeeming collateral. See above for how PUSDMaxFee is calculated.
            Redeems one collateral type from only one trove. Included for gas efficiency of arbitrages.
     * @param _PUSDamount is equal to the amount of PUSD to actually redeem.
     * @param _PUSDMaxFee is equal to the max fee in PUSD that the sender is willing to pay
     * @param _target is the hint for the single trove to redeem against
     * @param _upperHint is the upper hint for reinsertion of the trove
     * @param _lowerHint is the lower hint for reinsertion of the trove
     * @param _hintAICR is the target hint AICR for the the trove redeemed
     * @param _collToRedeem is the collateral address to redeem. Only this token.
     * _PUSDamount + _PUSDMaxFee must be less than the balance of the sender.
     */
  function redeemCollateralSingle(
    uint256 _PUSDamount,
    uint256 _PUSDMaxFee,
    address _target,
    address _upperHint,
    address _lowerHint,
    uint256 _hintAICR,
    address _collToRedeem
  ) external override nonReentrant {
    troveManagerRedemptions.redeemCollateralSingle(
      _PUSDamount,
      _PUSDMaxFee,
      _target,
      _upperHint,
      _lowerHint,
      _hintAICR,
      _collToRedeem,
      msg.sender
    );
  }

  // --- Getters ---

  function getTroveOwnersCount() external view override returns (uint256) {
    return TroveOwners.length;
  }

  function getTroveFromTroveOwnersArray(uint256 _index)
    external
    view
    override
    returns (address)
  {
    return TroveOwners[_index];
  }

  // --- Helper functions ---

  /**
   * @notice Helper function to return the current individual collateral ratio (ICR) of a given Trove.
   * @dev Takes a trove's pending coll and debt rewards from redistributions into account.
   * @param _borrower The address of the Trove to get the ICR
   * @return ICR
   */
  function getCurrentICR(address _borrower)
    public
    view
    override
    returns (uint256 ICR)
  {
    (
      address[] memory tokens,
      uint256[] memory amounts,
      uint256 currentPUSDDebt
    ) = _getCurrentTroveState(_borrower);

    ICR = _getICR(tokens, amounts, currentPUSDDebt);
  }

  /**
   *   @notice Helper function to return the current recovery individual collateral ratio (AICR) of a given Trove.
   *           AICR uses recovery ratios which are higher for more stable assets like stablecoins.
   *   @dev Takes a trove's pending coll and debt rewards from redistributions into account.
   *   @param _borrower The address of the Trove to get the AICR
   *   @return AICR
   */
  function getCurrentAICR(address _borrower)
    external
    view
    override
    returns (uint256 AICR)
  {
    (
      address[] memory tokens,
      uint256[] memory amounts,
      uint256 currentPUSDDebt
    ) = _getCurrentTroveState(_borrower);

    AICR = _getAICR(tokens, amounts, currentPUSDDebt);
  }

  /**
   *   @notice Gets current trove state as colls and debt.
   *   @param _borrower The address of the Trove
   *   @return colls -- newColls of the trove tokens and amounts
   *   @return PUSDdebt -- the current debt of the trove
   */
  function _getCurrentTroveState(address _borrower)
    internal
    view
    returns (
      address[] memory,
      uint256[] memory,
      uint256
    )
  {
    newColls memory pendingCollReward = _getPendingCollRewards(_borrower);
    uint256 pendingPUSDDebtReward = getPendingPUSDDebtReward(_borrower);

    uint256 PUSDdebt = Troves[_borrower].debt.add(pendingPUSDDebtReward);
    newColls memory colls = _sumColls(
      Troves[_borrower].colls,
      pendingCollReward
    );
    return (colls.tokens, colls.amounts, PUSDdebt);
  }

  /**
   * @notice Add the borrowers's coll and debt rewards earned from redistributions, to their Trove
   * @param _borrower The address of the Trove
   */
  function applyPendingRewards(address _borrower) external override {
    _requireCallerIsBOorTMR();
    return _applyPendingRewards(activePool, defaultPool, _borrower);
  }

  /**
   * @notice Add the borrowers's coll and debt rewards earned from redistributions, to their Trove
   * @param _borrower The address of the Trove
   */
  function _applyPendingRewards(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    address _borrower
  ) internal {
    if (hasPendingRewards(_borrower)) {
      _requireTroveIsActive(_borrower);

      // Compute pending collateral rewards
      newColls memory pendingCollReward = _getPendingCollRewards(_borrower);
      uint256 pendingPUSDDebtReward = getPendingPUSDDebtReward(_borrower);

      // Apply pending rewards to trove's state
      Troves[_borrower].colls = _sumColls(
        Troves[_borrower].colls,
        pendingCollReward
      );
      Troves[_borrower].debt = Troves[_borrower].debt.add(
        pendingPUSDDebtReward
      );

      _updateTroveRewardSnapshots(_borrower);

      // Transfer from DefaultPool to ActivePool
      _movePendingTroveRewardsToActivePool(
        _activePool,
        _defaultPool,
        pendingPUSDDebtReward,
        pendingCollReward.tokens,
        pendingCollReward.amounts
      );

      emit TroveUpdated(
        _borrower,
        Troves[_borrower].debt,
        Troves[_borrower].colls.tokens,
        Troves[_borrower].colls.amounts,
        TroveManagerOperation.applyPendingRewards
      );
    }
  }

  /**
   * @notice Update borrower's snapshots of L_Coll and L_PUSDDebt to reflect the current values
   * @param _borrower The address of the Trove
   */
  function updateTroveRewardSnapshots(address _borrower) external override {
    _requireCallerIsBorrowerOperations();
    _updateTroveRewardSnapshots(_borrower);
  }

  /**
   * @notice Internal function to update borrower's snapshots of L_Coll and L_PUSDDebt to reflect the current values
   *         Called when updating trove reward snapshots or when applying pending rewards
   * @param _borrower The address of the Trove
   */
  function _updateTroveRewardSnapshots(address _borrower) internal {
    address[] memory allColls = Troves[_borrower].colls.tokens;
    uint256 allCollsLen = allColls.length;
    for (uint256 i; i < allCollsLen; ++i) {
      address asset = allColls[i];
      rewardSnapshots[_borrower].CollRewards[asset] = L_Coll[asset];
      rewardSnapshots[_borrower].PUSDDebts[asset] = L_PUSDDebt[asset];
    }
    emit TroveSnapshotsUpdated(block.timestamp);
  }

  /**
   * @notice Get the borrower's pending accumulated Coll rewards, earned by their stake
   * @dev Returned tokens and amounts are the length of controller.getValidCollateral()
   * @param _borrower The address of the Trove
   * @return The borrower's pending accumulated Coll rewards tokens
   * @return The borrower's pending accumulated Coll rewards amounts
   */
  function getPendingCollRewards(address _borrower)
    external
    view
    override
    returns (address[] memory, uint256[] memory)
  {
    newColls memory pendingCollRewards = _getPendingCollRewards(_borrower);
    return (pendingCollRewards.tokens, pendingCollRewards.amounts);
  }

  /**
   * @notice Get the borrower's pending accumulated Coll rewards, earned by their stake
   * @param _borrower The address of the Trove
   * @return pendingCollRewards
   */
  function _getPendingCollRewards(address _borrower)
    internal
    view
    returns (newColls memory pendingCollRewards)
  {
    if (Troves[_borrower].status != Status.active) {
      newColls memory emptyColls;
      return emptyColls;
    }

    address[] memory allColls = Troves[_borrower].colls.tokens;
    pendingCollRewards.amounts = new uint256[](allColls.length);
    pendingCollRewards.tokens = allColls;
    uint256 allCollsLen = allColls.length;
    for (uint256 i; i < allCollsLen; ++i) {
      address coll = allColls[i];
      uint256 snapshotCollReward = rewardSnapshots[_borrower].CollRewards[coll];
      uint256 rewardPerUnitStaked = L_Coll[coll].sub(snapshotCollReward);
      if (rewardPerUnitStaked == 0) {
        pendingCollRewards.amounts[i] = 0;
        continue;
      }

      uint256 stake = Troves[_borrower].stakes[coll];
      uint256 dec = IERC20(coll).decimals();
      uint256 assetCollReward = stake.mul(rewardPerUnitStaked).div(10**dec);
      pendingCollRewards.amounts[i] = assetCollReward;
    }
  }

  /**
   * @notice : Get the borrower's pending accumulated PUSD reward, earned by their stake
   * @param _borrower The address of the Trove
   */
  function getPendingPUSDDebtReward(address _borrower)
    public
    view
    override
    returns (uint256 pendingPUSDDebtReward)
  {
    if (Troves[_borrower].status != Status.active) {
      return 0;
    }
    address[] memory allColls = Troves[_borrower].colls.tokens;

    uint256 allCollsLen = allColls.length;
    for (uint256 i; i < allCollsLen; ++i) {
      address coll = allColls[i];
      uint256 snapshotPUSDDebt = rewardSnapshots[_borrower].PUSDDebts[coll];
      uint256 rewardPerUnitStaked = L_PUSDDebt[allColls[i]].sub(
        snapshotPUSDDebt
      );
      if (rewardPerUnitStaked == 0) {
        continue;
      }

      uint256 stake = Troves[_borrower].stakes[coll];
      uint256 dec = IERC20(coll).decimals();
      uint256 assetPUSDDebtReward = stake.mul(rewardPerUnitStaked).div(10**dec);
      pendingPUSDDebtReward = pendingPUSDDebtReward.add(assetPUSDDebtReward);
    }
  }

  /**
   * @notice Checks if borrower has pending rewards
   * @dev A Trove has pending rewards if its snapshot is less than the current rewards per-unit-staked sum:
   * this indicates that rewards have occured since the snapshot was made, and the user therefore has pending rewards
   * @param _borrower The address of the Trove
   * @return True if Trove has pending rewards, False if Trove doesn't have pending rewards
   */
  function hasPendingRewards(address _borrower)
    public
    view
    override
    returns (bool)
  {
    if (Troves[_borrower].status != Status.active) {
      return false;
    }
    address[] memory assets = Troves[_borrower].colls.tokens;
    uint256 assetsLen = assets.length;
    for (uint256 i; i < assetsLen; ++i) {
      address token = assets[i];
      if (rewardSnapshots[_borrower].CollRewards[token] < L_Coll[token]) {
        return true;
      }
    }
    return false;
  }

  /**
   * @notice Gets the entire debt and collateral of a borrower
   * @param _borrower The address of the Trove
   * @return debt, collsTokens, collsAmounts, pendingPUSDDebtReward, pendingRewardTokens, pendingRewardAmouns
   */
  function getEntireDebtAndColls(address _borrower)
    external
    view
    override
    returns (
      uint256,
      address[] memory,
      uint256[] memory,
      uint256,
      address[] memory,
      uint256[] memory
    )
  {
    uint256 debt = Troves[_borrower].debt;
    newColls memory colls = Troves[_borrower].colls;

    uint256 pendingPUSDDebtReward = getPendingPUSDDebtReward(_borrower);
    newColls memory pendingCollReward = _getPendingCollRewards(_borrower);

    debt = debt.add(pendingPUSDDebtReward);

    // add in pending rewards to colls
    colls = _sumColls(colls, pendingCollReward);

    return (
      debt,
      colls.tokens,
      colls.amounts,
      pendingPUSDDebtReward,
      pendingCollReward.tokens,
      pendingCollReward.amounts
    );
  }

  /**
   * @notice Borrower operations remove stake sum
   * @param _borrower The address of the Trove
   */
  function removeStakeAndCloseTrove(address _borrower) external override {
    _requireCallerIsBorrowerOperations();
    _removeStake(_borrower);
    _closeTrove(_borrower, Status.closedByOwner);
  }

  /**
   * @notice Remove borrower's stake from the totalStakes sum, and set their stake to 0
   * @param _borrower The address of the Trove
   */
  function _removeStake(address _borrower) internal {
    address[] memory borrowerColls = Troves[_borrower].colls.tokens;
    uint256 borrowerCollsLen = borrowerColls.length;
    for (uint256 i; i < borrowerCollsLen; ++i) {
      address coll = borrowerColls[i];
      uint256 stake = Troves[_borrower].stakes[coll];
      totalStakes[coll] = totalStakes[coll].sub(stake);
      Troves[_borrower].stakes[coll] = 0;
    }
  }

  function _updateStakeAndTotalStakes(address _borrower) internal {
    uint256 troveOwnerLen = Troves[_borrower].colls.tokens.length;
    for (uint256 i; i < troveOwnerLen; ++i) {
      address token = Troves[_borrower].colls.tokens[i];
      uint256 amount = Troves[_borrower].colls.amounts[i];

      uint256 newStake = _computeNewStake(token, amount);
      uint256 oldStake = Troves[_borrower].stakes[token];

      Troves[_borrower].stakes[token] = newStake;
      totalStakes[token] = totalStakes[token].sub(oldStake).add(newStake);

      emit TotalStakesUpdated(token, totalStakes[token]);
    }
  }

  /**
   * @notice Calculate a new stake based on the snapshots of the totalStakes and totalCollateral taken at the last liquidation
     * @dev The following assert() holds true because:
        - The system always contains >= 1 trove
        - When we close or liquidate a trove, we redistribute the pending rewards, so if all troves were closed/liquidated,
        rewards would’ve been emptied and totalCollateralSnapshot would be zero too.
     * @param token The token
     * @param _coll The collateral
     * @return The New stake
     */
  function _computeNewStake(address token, uint256 _coll)
    internal
    view
    returns (uint256)
  {
    uint256 stake;
    if (totalCollateralSnapshot[token] == 0) {
      stake = _coll;
    } else {
      require(totalStakesSnapshot[token] != 0, "TM:stake=0");
      stake = _coll.mul(totalStakesSnapshot[token]).div(
        totalCollateralSnapshot[token]
      );
    }
    return stake;
  }

  /**
   * @notice Add distributed coll and debt rewards-per-unit-staked to the running totals. Division uses a "feedback"
        error correction, to keep the cumulative error low in the running totals L_Coll and L_PUSDDebt:
     * @dev
        This function is only called in batchLiquidateTroves() in TroveManagerLiquidations.
        Debt that cannot be offset from the stability pool has to be redistributed to other troves.
        The collateral that backs this debt also gets redistributed to these troves.


        1) Form numerators which compensate for the floor division errors that occurred the last time this
        2) Calculate "per-unit-staked" ratios.
        3) Multiply each ratio back by its denominator, to reveal the current floor division error.
        4) Store these errors for use in the next correction when this function is called.
        5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
     */
  function redistributeDebtAndColl(
    IActivePool _activePool,
    IDefaultPool _defaultPool,
    uint256 _debt,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external override {
    _requireCallerIsTML();
    uint256 tokensLen = _tokens.length;
    _revertLenInput(tokensLen == _amounts.length);

    if (_debt == 0) {
      return;
    }

    uint256 totalCollateralVC = _getVC(_tokens, _amounts); // total collateral value in VC terms
    uint256[] memory collateralsVC = controller.getValuesVCIndividual(
      _tokens,
      _amounts
    ); // collaterals in VC terms
    for (uint256 i; i < tokensLen; ++i) {
      address token = _tokens[i];

      // Prorate debt per collateral by dividing each collateral value by cumulative collateral value and multiply by outstanding debt
      uint256 proratedDebt = collateralsVC[i].mul(_debt).div(totalCollateralVC);
      uint256 debtNumerator = proratedDebt.mul(DECIMAL_PRECISION).add(
        lastPUSDDebtError_Redistribution[token]
      );

      if (totalStakes[token] != 0) {
        _updateStakesOnRedistribution(token, _amounts[i], debtNumerator, true);
      } else {
        // no other troves in the system with this collateral.
        // In this case we distribute the debt across
        // the absorptionCollaterals according to absorptionWeight

        (address[] memory absColls, uint256[] memory absWeights) = controller
          .getAbsorptionCollParams();
        uint256 unAllocatedAbsWeight;

        for (uint256 j; j < absColls.length; ++j) {
          // Also can't redistribute to this token, save it for later.
          if (totalStakes[absColls[j]] == 0) {
            unAllocatedAbsWeight += absWeights[j];
            absWeights[j] = 0;
          }
        }

        // Should not be empty, and unallocated should not be all weight.
        require(
          absColls.length != 0 && unAllocatedAbsWeight != 1e18,
          "TM:absCollsInvalid"
        );

        for (uint256 j; j < absColls.length; ++j) {
          // If there is no debt to be distributed for this abs coll, continue to next
          if (absWeights[j] == 0) {
            continue;
          }
          address absToken = absColls[j];
          // First found eligible redistribute-able token, so give unallocated weight here.
          if (unAllocatedAbsWeight != 0) {
            absWeights[j] += unAllocatedAbsWeight;
            unAllocatedAbsWeight = 0;
          }
          debtNumerator = proratedDebt.mul(absWeights[j]).add(
            lastPUSDDebtError_Redistribution[absToken]
          );

          _updateStakesOnRedistribution(absToken, 0, debtNumerator, false);
        }

        // send the collateral that can't be redistributed to anyone, to the claimAddress
        activePool.sendSingleCollateral(
          controller.getClaimAddress(),
          token,
          _amounts[i]
        );

        // this collateral should no longer be sent from the active pool to the default pool:
        _amounts[i] = 0;
      }
    }

    // Transfer coll and debt from ActivePool to DefaultPool
    _activePool.decreasePUSDDebt(_debt);
    _defaultPool.increasePUSDDebt(_debt);
    _activePool.sendCollaterals(address(_defaultPool), _tokens, _amounts);
  }

  function _updateStakesOnRedistribution(
    address _token,
    uint256 _amount,
    uint256 _debtNumerator,
    bool _updateColl
  ) internal {
    uint256 dec = IERC20(_token).decimals();
    uint256 thisTotalStakes = totalStakes[_token];
    uint256 adjustedTotalStakes;
    if (dec > 18) {
      adjustedTotalStakes = thisTotalStakes.div(10**(dec - 18));
    } else {
      adjustedTotalStakes = thisTotalStakes.mul(10**(18 - dec));
    }

    uint256 PUSDDebtRewardPerUnitStaked = _debtNumerator.div(
      adjustedTotalStakes
    );

    lastPUSDDebtError_Redistribution[_token] = _debtNumerator.sub(
      PUSDDebtRewardPerUnitStaked.mul(adjustedTotalStakes)
    );

    L_PUSDDebt[_token] = L_PUSDDebt[_token].add(PUSDDebtRewardPerUnitStaked);

    if (_updateColl) {
      uint256 CollNumerator = _amount.mul(DECIMAL_PRECISION).add(
        lastCollError_Redistribution[_token]
      );

      uint256 CollRewardPerUnitStaked = CollNumerator.div(adjustedTotalStakes);

      lastCollError_Redistribution[_token] = CollNumerator.sub(
        CollRewardPerUnitStaked.mul(adjustedTotalStakes)
      );

      // Add per-unit-staked terms to the running totals
      L_Coll[_token] = L_Coll[_token].add(CollRewardPerUnitStaked);
    }

    emit LTermsUpdated(_token, L_Coll[_token], L_PUSDDebt[_token]);
  }

  /**
   * @notice Closes trove by liquidation
   * @param _borrower The address of the Trove
   */
  function closeTroveLiquidation(address _borrower) external override {
    _requireCallerIsTML();
    return _closeTrove(_borrower, Status.closedByLiquidation);
  }

  /**
   * @notice Closes trove by redemption
   * @param _borrower The address of the Trove
   */
  function closeTroveRedemption(address _borrower) external override {
    _requireCallerIsTMR();
    return _closeTrove(_borrower, Status.closedByRedemption);
  }

  function _closeTrove(address _borrower, Status closedStatus) internal {
    require(
      closedStatus != Status.nonExistent && closedStatus != Status.active,
      "TM:invalid trove"
    );

    // Remove from UnderCollateralizedTroves if it was there.
    _updateUnderCollateralizedTrove(_borrower, false);

    uint256 TroveOwnersArrayLength = TroveOwners.length;
    _requireMoreThanOneTroveInSystem(TroveOwnersArrayLength);
    newColls memory emptyColls;

    // Zero all collaterals owned by the user and snapshots
    address[] memory allColls = Troves[_borrower].colls.tokens;
    uint256 allCollsLen = allColls.length;
    for (uint256 i; i < allCollsLen; ++i) {
      address thisAllColls = allColls[i];
      rewardSnapshots[_borrower].CollRewards[thisAllColls] = 0;
      rewardSnapshots[_borrower].PUSDDebts[thisAllColls] = 0;
    }

    Troves[_borrower].status = closedStatus;
    Troves[_borrower].colls = emptyColls;
    Troves[_borrower].debt = 0;

    _removeTroveOwner(_borrower, TroveOwnersArrayLength);
    sortedTroves.remove(_borrower);
  }

  /**
   * @notice Updates snapshots of system total stakes and total collateral,
     *  excluding a given collateral remainder from the calculation. Used in a liquidation sequence.
     * @dev The calculation excludes a portion of collateral that is in the ActivePool:
        the total Coll gas compensation from the liquidation sequence
        The Coll as compensation must be excluded as it is always sent out at the very end of the liquidation sequence.
     */
  function updateSystemSnapshots_excludeCollRemainder(
    IActivePool _activePool,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external override {
    _requireCallerIsTML();
    // Collect Active pool + Default pool balances of the passed in tokens and update snapshots accordingly
    uint256[] memory activeAndLiquidatedColl = _activePool
      .getAmountsSubsetSystem(_tokens);
    for (uint256 i; i < _tokens.length; ++i) {
      address token = _tokens[i];
      totalStakesSnapshot[token] = totalStakes[token];
      totalCollateralSnapshot[token] = activeAndLiquidatedColl[i].sub(
        _amounts[i]
      );
    }
    emit SystemSnapshotsUpdated(block.timestamp);
  }

  /**
   * @notice Push the owner's address to the Trove owners list, and record the corresponding array index on the Trove struct
     * @dev Max array size is 2**128 - 1, i.e. ~3e30 troves. No risk of overflow, since troves have minimum PUSD
        debt of liquidation reserve plus MIN_NET_DEBT. 3e30 PUSD dwarfs the value of all wealth in the world ( which is < 1e15 USD).
     * @param _borrower The address of the Trove
     * @return index Push Trove Owner to array
     */
  function addTroveOwnerToArray(address _borrower)
    external
    override
    returns (uint256)
  {
    _requireCallerIsBorrowerOperations();
    TroveOwners.push(_borrower);

    // Record the index of the new Troveowner on their Trove struct
    uint128 index = uint128(TroveOwners.length.sub(1));
    Troves[_borrower].arrayIndex = index;
    return uint256(index);
  }

  /**
   * @notice Remove a Trove owner from the TroveOwners array, not preserving array order.
   * @dev Removing owner 'B' does the following: [A B C D E] => [A E C D], and updates E's Trove struct to point to its new array index.
   * @param _borrower THe address of the Trove
   */
  function _removeTroveOwner(address _borrower, uint256 TroveOwnersArrayLength)
    internal
  {
    Status troveStatus = Troves[_borrower].status;
    // It’s set in caller function `_closeTrove`
    require(
      troveStatus != Status.nonExistent && troveStatus != Status.active,
      "TM:invalid trove"
    );

    uint128 index = Troves[_borrower].arrayIndex;
    uint256 length = TroveOwnersArrayLength;
    uint256 idxLast = length.sub(1);

    require(index <= idxLast, "TM:index>last");

    address addressToMove = TroveOwners[idxLast];

    TroveOwners[index] = addressToMove;
    Troves[addressToMove].arrayIndex = index;
    emit TroveIndexUpdated(addressToMove, index);

    TroveOwners.pop();
  }

  // --- Recovery Mode and TCR functions ---

  // @notice Helper function for calculating TCR of the system
  function getTCR() external view override returns (uint256) {
    return _getTCR();
  }

  // @notice Helper function for checking recovery mode
  // @return True if in recovery mode, false otherwise
  function checkRecoveryMode() external view override returns (bool) {
    return _checkRecoveryMode();
  }

  // --- Redemption fee functions ---

  /**
   * @notice Updates base rate via redemption, called from TMR
   * @param newBaseRate The new base rate
   */
  function updateBaseRate(uint256 newBaseRate) external override {
    _requireCallerIsTMR();
    // After redemption, new base rate is always > 0
    require(newBaseRate != 0, "TM:BR!=0");
    baseRate = newBaseRate;
    emit BaseRateUpdated(newBaseRate);
    _updateLastFeeOpTime();
  }

  function getRedemptionRate() external view override returns (uint256) {
    return _calcRedemptionRate(baseRate);
  }

  function getRedemptionRateWithDecay() public view override returns (uint256) {
    return _calcRedemptionRate(calcDecayedBaseRate());
  }

  function _calcRedemptionRate(uint256 _baseRate)
    internal
    pure
    returns (uint256)
  {
    return
      PreonMath._min(
        REDEMPTION_FEE_FLOOR.add(_baseRate),
        DECIMAL_PRECISION // cap at a maximum of 100%
      );
  }

  function getRedemptionFeeWithDecay(uint256 _PUSDRedeemed)
    external
    view
    override
    returns (uint256)
  {
    return _calcRedemptionFee(getRedemptionRateWithDecay(), _PUSDRedeemed);
  }

  function _calcRedemptionFee(uint256 _redemptionRate, uint256 _PUSDRedeemed)
    internal
    pure
    returns (uint256)
  {
    uint256 redemptionFee = _redemptionRate.mul(_PUSDRedeemed).div(
      DECIMAL_PRECISION
    );
    require(redemptionFee < _PUSDRedeemed, "TM:RedempFee>colls");
    return redemptionFee;
  }

  // --- Borrowing fee functions ---

  function getBorrowingRate() public view override returns (uint256) {
    return _calcBorrowingRate(baseRate);
  }

  function getBorrowingRateWithDecay() public view override returns (uint256) {
    return _calcBorrowingRate(calcDecayedBaseRate());
  }

  function _calcBorrowingRate(uint256 _baseRate)
    internal
    pure
    returns (uint256)
  {
    return PreonMath._min(BORROWING_FEE_FLOOR.add(_baseRate), MAX_BORROWING_FEE);
  }

  function getBorrowingFee(uint256 _PUSDDebt)
    external
    view
    override
    returns (uint256)
  {
    return _calcBorrowingFee(getBorrowingRate(), _PUSDDebt);
  }

  function getBorrowingFeeWithDecay(uint256 _PUSDDebt)
    external
    view
    override
    returns (uint256)
  {
    return _calcBorrowingFee(getBorrowingRateWithDecay(), _PUSDDebt);
  }

  function _calcBorrowingFee(uint256 _borrowingRate, uint256 _PUSDDebt)
    internal
    pure
    returns (uint256)
  {
    return _borrowingRate.mul(_PUSDDebt).div(DECIMAL_PRECISION);
  }

  // @notice Updates the baseRate state variable based on time elapsed since the last redemption
  // or PUSD borrowing operation
  function decayBaseRateFromBorrowingAndCalculateFee(uint256 _PUSDDebt)
    external
    override
    returns (uint256)
  {
    _requireCallerIsBorrowerOperations();

    uint256 decayedBaseRate = calcDecayedBaseRate();
    require(decayedBaseRate <= DECIMAL_PRECISION, "TM:BR>1e18"); // The baseRate can decay to 0

    baseRate = decayedBaseRate;
    emit BaseRateUpdated(decayedBaseRate);

    _updateLastFeeOpTime();
    return _calcBorrowingFee(getBorrowingRate(), _PUSDDebt);
  }

  // --- Internal fee functions ---

  // @notice Update the last fee operation time only if time passed >= decay interval. This prevents base rate griefing.
  function _updateLastFeeOpTime() internal {
    uint256 timePassed = block.timestamp.sub(lastFeeOperationTime);

    if (timePassed >= SECONDS_IN_ONE_MINUTE) {
      lastFeeOperationTime = block.timestamp;
      emit LastFeeOpTimeUpdated(block.timestamp);
    }
  }

  function calcDecayedBaseRate() public view override returns (uint256) {
    uint256 minutesPassed = _minutesPassedSinceLastFeeOp();
    uint256 decayFactor = PreonMath._decPow(MINUTE_DECAY_FACTOR, minutesPassed);

    return baseRate.mul(decayFactor).div(DECIMAL_PRECISION);
  }

  function _minutesPassedSinceLastFeeOp() internal view returns (uint256) {
    return
      (block.timestamp.sub(lastFeeOperationTime)).div(SECONDS_IN_ONE_MINUTE);
  }

  // --- 'require' wrapper functions ---

  function _requireCallerIsBorrowerOperations() internal view {
    if (msg.sender != borrowerOperationsAddress) {
      _revertWrongFuncCaller();
    }
  }

  function _requireCallerIsBOorTMR() internal view {
    if (
      msg.sender != borrowerOperationsAddress &&
      msg.sender != address(troveManagerRedemptions)
    ) {
      _revertWrongFuncCaller();
    }
  }

  function _requireCallerIsTMR() internal view {
    if (msg.sender != address(troveManagerRedemptions)) {
      _revertWrongFuncCaller();
    }
  }

  function _requireCallerIsTML() internal view {
    if (msg.sender != address(troveManagerLiquidations)) {
      _revertWrongFuncCaller();
    }
  }

  function _requireCallerIsTMLorTMR() internal view {
    if (
      msg.sender != address(troveManagerLiquidations) &&
      msg.sender != address(troveManagerRedemptions)
    ) {
      _revertWrongFuncCaller();
    }
  }

  function _requireTroveIsActive(address _borrower) internal view {
    require(Troves[_borrower].status == Status.active, "TM:trove inactive");
  }

  function _requireMoreThanOneTroveInSystem(uint256 TroveOwnersArrayLength)
    internal
    pure
  {
    require(TroveOwnersArrayLength > 1, "TM:last trove");
  }

  function _updateUnderCollateralizedTrove(
    address _borrower,
    bool _isUnderCollateralized
  ) internal {
    sortedTroves.updateUnderCollateralizedTrove(
      _borrower,
      _isUnderCollateralized
    );
  }

  // --- Trove property getters ---

  function getTroveStatus(address _borrower)
    external
    view
    override
    returns (uint256)
  {
    return uint256(Troves[_borrower].status);
  }

  function isTroveActive(address _borrower)
    external
    view
    override
    returns (bool)
  {
    return Troves[_borrower].status == Status.active;
  }

  function getTroveStake(address _borrower, address _token)
    external
    view
    override
    returns (uint256)
  {
    return Troves[_borrower].stakes[_token];
  }

  function getTroveDebt(address _borrower)
    external
    view
    override
    returns (uint256)
  {
    return Troves[_borrower].debt;
  }

  // -- Trove Manager State Variable Getters --

  function getTotalStake(address _token)
    external
    view
    override
    returns (uint256)
  {
    return totalStakes[_token];
  }

  function getL_Coll(address _token) external view override returns (uint256) {
    return L_Coll[_token];
  }

  function getL_PUSD(address _token) external view override returns (uint256) {
    return L_PUSDDebt[_token];
  }

  function getRewardSnapshotColl(address _borrower, address _token)
    external
    view
    override
    returns (uint256)
  {
    return rewardSnapshots[_borrower].CollRewards[_token];
  }

  function getRewardSnapshotPUSD(address _borrower, address _token)
    external
    view
    override
    returns (uint256)
  {
    return rewardSnapshots[_borrower].PUSDDebts[_token];
  }

  /**
   * @notice recomputes VC given current prices and returns it
   * @param _borrower The address of the Trove
   * @return The Trove's VC
   */
  function getTroveVC(address _borrower)
    external
    view
    override
    returns (uint256)
  {
    return _getVCColls(Troves[_borrower].colls);
  }

  function getTroveColls(address _borrower)
    external
    view
    override
    returns (address[] memory, uint256[] memory)
  {
    return (Troves[_borrower].colls.tokens, Troves[_borrower].colls.amounts);
  }

  function getCurrentTroveState(address _borrower)
    external
    view
    override
    returns (
      address[] memory,
      uint256[] memory,
      uint256
    )
  {
    return _getCurrentTroveState(_borrower);
  }

  // --- Called by TroveManagerRedemptions Only ---

  function updateTroveDebt(address _borrower, uint256 debt) external override {
    _requireCallerIsTMR();
    Troves[_borrower].debt = debt;
  }

  function removeStake(address _borrower) external override {
    _requireCallerIsTMLorTMR();
    _removeStake(_borrower);
  }

  // --- Trove property setters, called by BorrowerOperations ---

  function setTroveStatus(address _borrower, uint256 _num) external override {
    _requireCallerIsBorrowerOperations();
    Troves[_borrower].status = Status(_num);
  }

  /**
   * @notice Update borrower's stake based on their latest collateral value. Also update their
   * trove state with new tokens and amounts. Called by BO or TMR
   * @dev computed at time function is called based on current price of collateral
   * @param _borrower The address of the Trove
   * @param _tokens The array of tokens to set to the borrower's trove
   * @param _amounts The array of amounts to set to the borrower's trove
   */
  function updateTroveCollAndStakeAndTotalStakes(
    address _borrower,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external override {
    _requireCallerIsBOorTMR();
    _revertLenInput(_tokens.length == _amounts.length);
    (Troves[_borrower].colls.tokens, Troves[_borrower].colls.amounts) = (
      _tokens,
      _amounts
    );
    _updateStakeAndTotalStakes(_borrower);
  }

  function increaseTroveDebt(address _borrower, uint256 _debtIncrease)
    external
    override
    returns (uint256)
  {
    _requireCallerIsBorrowerOperations();
    uint256 newDebt = Troves[_borrower].debt.add(_debtIncrease);
    Troves[_borrower].debt = newDebt;
    return newDebt;
  }

  function decreaseTroveDebt(address _borrower, uint256 _debtDecrease)
    external
    override
    returns (uint256)
  {
    _requireCallerIsBorrowerOperations();
    uint256 newDebt = Troves[_borrower].debt.sub(_debtDecrease);
    Troves[_borrower].debt = newDebt;
    return newDebt;
  }

  function _revertLenInput(bool _lenInput) internal pure {
    require(_lenInput, "TM:Len input");
  }

  // --- System param getter functions ---

  function getMCR() external view override returns (uint256) {
    return MCR;
  }

  function getCCR() external view override returns (uint256) {
    return CCR;
  }

  function getPUSD_GAS_COMPENSATION() external view override returns (uint256) {
    return PUSD_GAS_COMPENSATION;
  }

  function getMIN_NET_DEBT() external view override returns (uint256) {
    return MIN_NET_DEBT;
  }

  function getBORROWING_FEE_FLOOR() external view override returns (uint256) {
    return BORROWING_FEE_FLOOR;
  }

  function getREDEMPTION_FEE_FLOOR() external view override returns (uint256) {
    return REDEMPTION_FEE_FLOOR;
  }
}
