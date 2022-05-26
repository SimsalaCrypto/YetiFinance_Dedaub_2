// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./ICollateralReceiver.sol";

/*
 * The Stability Pool holds PUSD tokens deposited by Stability Pool depositors.
 *
 * When a trove is liquidated, then depending on system conditions, some of its PUSD debt gets offset with
 * PUSD in the Stability Pool:  that is, the offset debt evaporates, and an equal amount of PUSD tokens in the Stability Pool is burned.
 *
 * Thus, a liquidation causes each depositor to receive a PUSD loss, in proportion to their deposit as a share of total deposits.
 * They also receive an ETH gain, as the ETH collateral of the liquidated trove is distributed among Stability depositors,
 * in the same proportion.
 *
 * When a liquidation occurs, it depletes every deposit by the same fraction: for example, a liquidation that depletes 40%
 * of the total PUSD in the Stability Pool, depletes 40% of each deposit.
 *
 * A deposit that has experienced a series of liquidations is termed a "compounded deposit": each liquidation depletes the deposit,
 * multiplying it by some factor in range ]0,1[
 *
 * Please see the implementation spec in the proof document, which closely follows on from the compounded deposit / ETH gain derivations:
 * https://github.com/liquity/liquity/blob/master/papers/Scalable_Reward_Distribution_with_Compounding_Stakes.pdf
 *
 * --- PREON ISSUANCE TO STABILITY POOL DEPOSITORS ---
 *
 * An PREON issuance event occurs at every deposit operation, and every liquidation.
 *
 * Each deposit is tagged with the address of the front end through which it was made.
 *
 * All deposits earn a share of the issued PREON in proportion to the deposit as a share of total deposits. The PREON earned
 * by a given deposit, is split between the depositor and the front end through which the deposit was made, based on the front end's kickbackRate.
 *
 * Please see the system Readme for an overview:
 * https://github.com/liquity/dev/blob/main/README.md#preon-issuance-to-stability-providers
 */
interface IStabilityPool is ICollateralReceiver {
  // --- Events ---

  event StabilityPoolETHBalanceUpdated(uint256 _newBalance);
  event StabilityPoolPUSDBalanceUpdated(uint256 _newBalance);

  event P_Updated(uint256 _P);
  event S_Updated(uint256 _S, uint128 _epoch, uint128 _scale);
  event G_Updated(uint256 _G, uint128 _epoch, uint128 _scale);
  event EpochUpdated(uint128 _currentEpoch);
  event ScaleUpdated(uint128 _currentScale);

  event DepositSnapshotUpdated(
    address indexed _depositor,
    uint256 _P,
    uint256 _S,
    uint256 _G
  );
  event UserDepositChanged(address indexed _depositor, uint256 _newDeposit);

  event ETHGainWithdrawn(
    address indexed _depositor,
    uint256 _ETH,
    uint256 _PUSDLoss
  );
  event PREONPaidToDepositor(address indexed _depositor, uint256 _PREON);
  event EtherSent(address _to, uint256 _amount);

  // --- Functions ---

  /*
   * Called only once on init, to set addresses of other Preon contracts
   * Callable only by owner, renounces ownership at the end
   */
  function setAddresses(
    address _borrowerOperationsAddress,
    address _troveManagerAddress,
    address _activePoolAddress,
    address _pusdTokenAddress,
    address _sortedTrovesAddress,
    address _communityIssuanceAddress,
    address _controllerAddress,
    address _troveManagerLiquidationsAddress
  ) external;

  /*
   * Initial checks:
   * - _amount is not zero
   * ---
   * - Triggers a PREON issuance, based on time passed since the last issuance. The PREON issuance is shared between *all* depositors and front ends
   * - Tags the deposit with the provided front end tag param, if it's a new deposit
   * - Sends depositor's accumulated gains (PREON, ETH) to depositor
   * - Sends the tagged front end's accumulated PREON gains to the tagged front end
   * - Increases deposit and tagged front end's stake, and takes new snapshots for each.
   */
  function provideToSP(uint256 _amount) external;

  /*
   * Initial checks:
   * - _amount is zero or there are no under collateralized troves left in the system
   * - User has a non zero deposit
   * ---
   * - Triggers a PREON issuance, based on time passed since the last issuance. The PREON issuance is shared between *all* depositors and front ends
   * - Removes the deposit's front end tag if it is a full withdrawal
   * - Sends all depositor's accumulated gains (PREON, ETH) to depositor
   * - Sends the tagged front end's accumulated PREON gains to the tagged front end
   * - Decreases deposit and tagged front end's stake, and takes new snapshots for each.
   *
   * If _amount > userDeposit, the user withdraws all of their compounded deposit.
   */
  function withdrawFromSP(uint256 _amount) external;

  function claimRewardsSwap(uint256 _pusdMinAmountTotal)
    external
    returns (uint256 amountFromSwap);

  /*
   * Initial checks:
   * - Caller is TroveManager
   * ---
   * Cancels out the specified debt against the PUSD contained in the Stability Pool (as far as possible)
   * and transfers the Trove's ETH collateral from ActivePool to StabilityPool.
   * Only called by liquidation functions in the TroveManager.
   */
  function offset(
    uint256 _debt,
    address[] memory _assets,
    uint256[] memory _amountsAdded
  ) external;

  //    /*
  //     * Returns the total amount of ETH held by the pool, accounted in an internal variable instead of `balance`,
  //     * to exclude edge cases like ETH received from a self-destruct.
  //     */
  //    function getETH() external view returns (uint);

  //*
  //     * Calculates and returns the total gains a depositor has accumulated
  //     */
  function getDepositorGains(address _depositor)
    external
    view
    returns (address[] memory assets, uint256[] memory amounts);

  /*
   * Returns the total amount of VC held by the pool, accounted for by multipliying the
   * internal balances of collaterals by the price that is found at the time getVC() is called.
   */
  function getVC() external view returns (uint256);

  /*
   * Returns PUSD held in the pool. Changes when users deposit/withdraw, and when Trove debt is offset.
   */
  function getTotalPUSDDeposits() external view returns (uint256);

  /*
   * Calculate the PREON gain earned by a deposit since its last snapshots were taken.
   * If not tagged with a front end, the depositor gets a 100% cut of what their deposit earned.
   * Otherwise, their cut of the deposit's earnings is equal to the kickbackRate, set by the front end through
   * which they made their deposit.
   */
  function getDepositorPREONGain(address _depositor)
    external
    view
    returns (uint256);

  /*
   * Return the user's compounded deposit.
   */
  function getCompoundedPUSDDeposit(address _depositor)
    external
    view
    returns (uint256);

  /*
   * Add collateral type to totalColl
   */
  function addCollateralType(address _collateral) external;

  function getDepositSnapshotS(address depositor, address collateral)
    external
    view
    returns (uint256);

  function getCollateral(address _collateral) external view returns (uint256);

  function getAllCollateral()
    external
    view
    returns (address[] memory, uint256[] memory);

  function getEstimatedPREONPoolRewards(uint256 _amount, uint256 _time)
    external
    view
    returns (uint256);
}
