// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/IYUSDToken.sol";
import "../Interfaces/ICollSurplusPool.sol";
import "../Interfaces/ISortedTroves.sol";
import "../Interfaces/IYetiController.sol";
import "../Interfaces/IYetiLever.sol";
import "../Interfaces/IERC20.sol";
import "../Interfaces/IYetiVaultToken.sol";
import "../Dependencies/LiquityBase.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/ReentrancyGuardUpgradeable.sol";
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
 * @title Handles most of external facing trove activities that a user would make with their own trove
 * @notice Trove activities like opening, closing, adjusting, increasing leverage, etc
 *
 *
 * A summary of Lever Up:
 * Takes in a collateral token A, and simulates borrowing of YUSD at a certain collateral ratio and
 * buying more token A, putting back into protocol, buying more A, etc. at a certain leverage amount.
 * So if at 3x leverage and 1000$ token A, it will mint 1000 * 3x * 2/3 = $2000 YUSD, then swap for
 * token A by using some router strategy, returning a little under $2000 token A to put back in the
 * trove. The number here is 2/3 because the math works out to be that collateral ratio is 150% if
 * we have a 3x leverage. They now have a trove with $3000 of token A and a collateral ratio of 150%.
 * Using leverage will not return YUSD debt for the borrower.
 *
 * Unlever is the opposite of this, and will take collateral in a borrower's trove, sell it on the market
 * for YUSD, and attempt to pay back a certain amount of YUSD debt in a user's trove with that amount.
 *
 */

contract BorrowerOperations is
  LiquityBase,
  IBorrowerOperations,
  ReentrancyGuardUpgradeable
{
  using SafeMath for uint256;
  using SafeERC20 for IERC20;
  bytes32 public constant NAME = "BorrowerOperations";

  // --- Connected contract declarations ---

  ITroveManager internal troveManager;

  address internal gasPoolAddress;

  ICollSurplusPool internal collSurplusPool;

  IYUSDToken internal yusdToken;

  ISortedTroves internal sortedTroves;

  address internal activePoolAddress;

  /* --- Variable container structs  ---

  Used to hold, return and assign variables inside a function, in order to avoid the error:
  "CompilerError: Stack too deep". */

  struct AdjustTrove_Params {
    uint256[] _leverages;
    address[] _collsIn;
    uint256[] _amountsIn;
    address[] _collsOut;
    uint256[] _amountsOut;
    uint256[] _maxSlippages;
    uint256 _YUSDChange;
    uint256 _totalYUSDDebtFromLever;
    address _upperHint;
    address _lowerHint;
    uint256 _maxFeePercentage;
    bool _isDebtIncrease;
    bool _isUnlever;
  }

  struct LocalVariables_adjustTrove {
    uint256 netDebtChange;
    uint256 collChangeRVC;
    uint256 currVC;
    uint256 currRVC;
    uint256 newVC;
    uint256 newRVC;
    uint256 debt;
    address[] currAssets;
    uint256[] currAmounts;
    address[] newAssets;
    uint256[] newAmounts;
    uint256 oldICR;
    uint256 newICR;
    uint256 YUSDFee;
    uint256 variableYUSDFee;
    uint256 newDebt;
    uint256 VCin;
    uint256 RVCin;
    uint256 VCout;
    uint256 RVCout;
    uint256 maxFeePercentageFactor;
    uint256 entireSystemCollVC;
    uint256 entireSystemCollRVC;
    uint256 entireSystemDebt;
    uint256 boostFactor;
    bool isRVCIncrease;
    bool isRecoveryMode;
  }

  struct OpenTrove_Params {
    uint256[] _leverages;
    uint256 _maxFeePercentage;
    uint256 _YUSDAmount;
    uint256 _totalYUSDDebtFromLever;
    address _upperHint;
    address _lowerHint;
  }

  struct LocalVariables_openTrove {
    uint256 YUSDFee;
    uint256 netDebt;
    uint256 compositeDebt;
    uint256 ICR;
    uint256 VC;
    uint256 RVC;
    uint256 entireSystemCollVC;
    uint256 entireSystemCollRVC;
    uint256 entireSystemDebt;
    uint256 boostFactor;
    bool isRecoveryMode;
  }

  struct LocalVariables_closeTrove {
    uint256 entireSystemCollRVC;
    uint256 entireSystemDebt;
    uint256 debt;
    address[] colls;
    uint256[] amounts;
    uint256 troveRVC;
    bool isRecoveryMode;
  }

  struct ContractsCache {
    ITroveManager troveManager;
    IActivePool activePool;
    IYUSDToken yusdToken;
    IYetiController controller;
  }

  enum BorrowerOperation {
    openTrove,
    closeTrove,
    adjustTrove
  }

  event TroveCreated(address indexed _borrower, uint256 arrayIndex);

  event TroveUpdated(
    address indexed _borrower,
    uint256 _debt,
    address[] _tokens,
    uint256[] _amounts,
    BorrowerOperation operation
  );
  event YUSDBorrowingFeePaid(address indexed _borrower, uint256 _YUSDFee);

  event VariableFeePaid(address indexed _borrower, uint256 _YUSDVariableFee);

  // --- Dependency setters ---
  bool private addressSet;

  /**
   * @notice Sets the addresses of all contracts used. Can only be called once.
   */
  function setAddresses(
    address _troveManagerAddress,
    address _activePoolAddress,
    address _defaultPoolAddress,
    address _gasPoolAddress,
    address _collSurplusPoolAddress,
    address _sortedTrovesAddress,
    address _yusdTokenAddress,
    address _controllerAddress
  ) external override {
    require(addressSet == false, "Addresses already set");
    addressSet = true;
    __ReentrancyGuard_init();

    troveManager = ITroveManager(_troveManagerAddress);
    activePool = IActivePool(_activePoolAddress);
    activePoolAddress = _activePoolAddress;
    defaultPool = IDefaultPool(_defaultPoolAddress);
    controller = IYetiController(_controllerAddress);
    gasPoolAddress = _gasPoolAddress;
    collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
    sortedTroves = ISortedTroves(_sortedTrovesAddress);
    yusdToken = IYUSDToken(_yusdTokenAddress);
  }

  // --- Borrower Trove Operations ---

  /**
   * @notice Main function to open a new trove. Takes in collateral and adds it to a trove, resulting in
   *  a collateralized debt position. The resulting ICR (individual collateral ratio) of the trove is indicative
   *  of the safety of the trove.
   * @param _maxFeePercentage The maximum percentage of the Collateral VC in that can be taken as fee.
   * @param _YUSDAmount Amount of YUSD to open the trove with. The resulting YUSD Amount + 200 YUSD Gas compensation
   *  plus any YUSD fees that occur must be > 2000. This min debt amount is intended to reduce the amount of small troves
   *  that are opened, since liquidating small troves may clog the network and we want to prioritize liquidations of larger
   *  troves in turbulant gas conditions.
   * @param _upperHint The address of the trove above this one in the sorted troves list.
   * @param _lowerHint The address of the trove below this one in the sorted troves list.
   * @param _colls The addresses of collaterals to be used in the trove. Must be passed in, in order of the whitelisted collateral.
   * @param _amounts The amounts of each collateral to be used in the trove. If passing in a vault token, the amount must be the
   *  amount of the underlying asset, but the address passed in must be the vault token address. So, for example, if trying to
   *  open a trove with Benqi USDC (qiUSDC), then the address passed in must be Yeti Vault qiUSDC, but the amount must be of
   *  qiUSDC in your wallet. The resulting amount in your trove will be of the vault token, so to see how much actual qiUSDC you have
   *  you must use the conversion ratio on the vault contract.
   */
  function openTrove(
    uint256 _maxFeePercentage,
    uint256 _YUSDAmount,
    address _upperHint,
    address _lowerHint,
    address[] calldata _colls,
    uint256[] memory _amounts
  ) external override nonReentrant {
    ContractsCache memory contractsCache = ContractsCache(
      troveManager,
      activePool,
      yusdToken,
      controller
    );
    _requireInputCorrect(_amounts.length != 0);

    // check that all _colls collateral types are in the controller and in correct order.
    _requireValidCollateral(_colls, _amounts, contractsCache.controller, true);

    // Check that below max colls in trove.
    _requireValidTroveCollsLen(contractsCache.controller, _colls.length);

    // transfer collateral into ActivePool
    _transferCollateralsIntoActivePool(_colls, _amounts);

    OpenTrove_Params memory params = OpenTrove_Params(
      new uint256[](_colls.length),
      _maxFeePercentage,
      _YUSDAmount,
      0,
      _upperHint,
      _lowerHint
    );
    _openTroveInternal(params, _colls, _amounts, contractsCache);
  }

  /**
   * @notice Opens a trove while leveraging up on the collateral passed in.
   * @dev Takes in a leverage amount (11x) and a token, and calculates the amount
   * of that token that would be at the specific collateralization ratio. Mints YUSD
   * according to the price of the token and the amount. Calls internal leverUp
   * function to perform the swap through a route.
   * Then opens a trove with the new collateral from the swap, ensuring that
   * the amount is enough to cover the debt. Reverts if the swap was
   * not able to get the correct amount of collateral according to slippage passed in.
   * _leverage is like 11e18 for 11x.
   * @param _maxFeePercentage The maximum percentage of the Collateral VC in that can be taken as fee.
   * @param _YUSDAmount Amount of YUSD to open the trove with. This is separate from the amount of YUSD taken against the leveraged amounts
   *  for each collateral which is levered up on. The resulting YUSD Amount + 200 YUSD Gas compensation plus any YUSD
   *  fees plus amount from leverages must be > 2000. This min debt amount is intended to reduce the amount of small troves
   *  that are opened, since liquidating small troves may clog the network and we want to prioritize liquidations of larger
   *  troves in turbulant gas conditions.
   * @param _upperHint The address of the trove above this one in the sorted troves list.
   * @param _lowerHint The address of the trove below this one in the sorted troves list.
   * @param _colls The addresses of collaterals to be used in the trove. Must be passed in, in order of the whitelisted collateral.
   * @param _amounts The amounts of each collateral to be used in the trove. If passing in a vault token, the amount must be the
   *  amount of the underlying asset, but the address passed in must be the vault token address. So, for example, if trying to
   *  open a trove with Benqi USDC (qiUSDC), then the address passed in must be Yeti Vault qiUSDC, but the amount must be of
   *  qiUSDC in your wallet. The resulting amount in your trove will be of the vault token, so to see how much actual qiUSDC you have
   *  you must use the conversion ratio on the vault contract.
   * @param _leverages The leverage amounts on each collateral to be used in the lever up function. If 0 there is no leverage on that coll
   * @param _maxSlippages The max slippage amount when swapping YUSD for collateral
   */
  function openTroveLeverUp(
    uint256 _maxFeePercentage,
    uint256 _YUSDAmount,
    address _upperHint,
    address _lowerHint,
    address[] memory _colls,
    uint256[] memory _amounts,
    uint256[] memory _leverages,
    uint256[] calldata _maxSlippages
  ) external override nonReentrant {
    ContractsCache memory contractsCache = ContractsCache(
      troveManager,
      activePool,
      yusdToken,
      controller
    );
    _requireLeverUpEnabled(contractsCache.controller);
    uint256 collsLen = _colls.length;
    _requireInputCorrect(collsLen != 0);
    // check that all _colls collateral types are in the controller and in correct order.
    _requireValidCollateral(_colls, _amounts, contractsCache.controller, true);
    // Check that below max colls in trove.
    _requireValidTroveCollsLen(contractsCache.controller, _colls.length);
    // Must check additional passed in arrays
    _requireInputCorrect(
      collsLen == _leverages.length && collsLen == _maxSlippages.length
    );
    // Keep track of total YUSD from lever and pass into internal open trove.
    uint256 totalYUSDDebtFromLever;
    for (uint256 i; i < collsLen; ++i) {
      if (_maxSlippages[i] != 0) {
        (
          uint256 additionalTokenAmount,
          uint256 additionalYUSDDebt
        ) = _singleLeverUp(
            _colls[i],
            _amounts[i],
            _leverages[i],
            _maxSlippages[i],
            contractsCache
          );
        // Transfer into active pool, non levered amount, and add to additional token amount returned.
        // additional token amount was set to the original amount * leverage.
        // The amount of receipt tokens received back is the amount which we will use to open the trove.
        _amounts[i] = additionalTokenAmount.add(
          _singleTransferCollateralIntoActivePool(_colls[i], _amounts[i])
        );
        totalYUSDDebtFromLever = totalYUSDDebtFromLever.add(additionalYUSDDebt);
      } else {
        // Otherwise skip and do normal transfer that amount into active pool.
        require(_leverages[i] == 0, "2");
        _amounts[i] = _singleTransferCollateralIntoActivePool(
          _colls[i],
          _amounts[i]
        );
      }
    }
    _YUSDAmount = _YUSDAmount.add(totalYUSDDebtFromLever);

    OpenTrove_Params memory params = OpenTrove_Params(
      _leverages,
      _maxFeePercentage,
      _YUSDAmount,
      totalYUSDDebtFromLever,
      _upperHint,
      _lowerHint
    );
    _openTroveInternal(params, _colls, _amounts, contractsCache);
  }

  /**
   * @notice internal function for minting yusd at certain leverage and max slippage, and then performing
   * swap with controller's approved router.
   * @param _token collateral address
   * @param _amount amount of collateral to lever up on
   * @param _leverage amount to leverage. 11e18 = 11x
   * @param _maxSlippage max slippage amount for swap YUSD to collateral
   * @return _finalTokenAmount final amount of the collateral token
   * @return _additionalYUSDDebt Total amount of YUSD Minted to be added to total.
   */
  function _singleLeverUp(
    address _token,
    uint256 _amount,
    uint256 _leverage,
    uint256 _maxSlippage,
    ContractsCache memory contractsCache
  ) internal returns (uint256 _finalTokenAmount, uint256 _additionalYUSDDebt) {
    require(
      _leverage > DECIMAL_PRECISION && _maxSlippage <= DECIMAL_PRECISION,
      "2"
    );
    address router = _getDefaultRouterAddress(
      contractsCache.controller,
      _token
    );
    // leverage is 5e18 for 5x leverage. Minus 1 for what the user already has in collateral value.
    uint256 _additionalTokenAmount = _amount
      .mul(_leverage.sub(DECIMAL_PRECISION))
      .div(DECIMAL_PRECISION);
    // Calculate USD value to see how much YUSD to mint.
    _additionalYUSDDebt = _getValueUSD(
      contractsCache.controller,
      _token,
      _additionalTokenAmount
    );

    // 1/(1-1/ICR) = leverage. (1 - 1/ICR) = 1/leverage
    // 1 - 1/leverage = 1/ICR. ICR = 1/(1 - 1/leverage) = (1/((leverage-1)/leverage)) = leverage / (leverage - 1)
    // ICR = leverage / (leverage - 1)

    // ICR = VC value of collateral / debt
    // debt = VC value of collateral / ICR.
    // debt = VC value of collateral * (leverage - 1) / leverage

    uint256 slippageAdjustedValue = _additionalTokenAmount
      .mul(DECIMAL_PRECISION.sub(_maxSlippage))
      .div(DECIMAL_PRECISION);

    // Mint to the router.
    _yusdTokenMint(contractsCache.yusdToken, router, _additionalYUSDDebt);

    // route will swap the tokens and transfer it to the active pool automatically. Router will send to active pool
    IERC20 erc20Token = IERC20(_token);
    uint256 balanceBefore = _IERC20TokenBalanceOf(
      erc20Token,
      activePoolAddress
    );
    _finalTokenAmount = IYetiLever(router).route(
      activePoolAddress,
      address(contractsCache.yusdToken),
      _token,
      _additionalYUSDDebt,
      slippageAdjustedValue
    );
    require(
      _IERC20TokenBalanceOf(erc20Token, activePoolAddress) ==
        balanceBefore.add(_finalTokenAmount),
      "4"
    );
  }

  /**
   * @notice Opens Trove Internal
   * @dev amounts should be a uint array giving the amount of each collateral
   * to be transferred in in order of the current controller
   * Should be called *after* collateral has been already sent to the active pool
   * Should confirm _colls, is valid collateral prior to calling this
   */
  function _openTroveInternal(
    OpenTrove_Params memory params,
    address[] memory _colls,
    uint256[] memory _amounts,
    ContractsCache memory contractsCache
  ) internal {
    LocalVariables_openTrove memory vars;
    (
      vars.isRecoveryMode,
      vars.entireSystemCollVC,
      vars.entireSystemCollRVC,
      vars.entireSystemDebt
    ) = _checkRecoveryModeAndSystem();

    _requireValidMaxFeePercentage(
      params._maxFeePercentage,
      vars.isRecoveryMode
    );
    _requireTroveStatus(contractsCache.troveManager, false);

    // Start with base amount before adding any fees.
    vars.netDebt = params._YUSDAmount;

    // For every collateral type in, calculate the VC, RVC, and get the variable fee
    (vars.VC, vars.RVC) = _getValuesVCAndRVC(
      contractsCache.controller,
      _colls,
      _amounts
    );

    if (!vars.isRecoveryMode) {
      // when not in recovery mode, add in the 0.5% fee
      vars.YUSDFee = _triggerBorrowingFee(
        contractsCache,
        params._YUSDAmount,
        vars.VC, // here it is just VC in, which is always larger than YUSD amount
        params._maxFeePercentage
      );
      params._maxFeePercentage = params._maxFeePercentage.sub(
        vars.YUSDFee.mul(DECIMAL_PRECISION).div(vars.VC)
      );
    }

    // Add in variable fee. Always present, even in recovery mode.
    {
      uint256 variableFee;
      (variableFee, vars.boostFactor) = _getTotalVariableDepositFeeAndUpdate(
        contractsCache.controller,
        _colls,
        _amounts,
        params._leverages,
        vars.entireSystemCollVC,
        vars.VC,
        0
      );
      _requireUserAcceptsFee(variableFee, vars.VC, params._maxFeePercentage);
      _mintYUSDFeeAndSplit(contractsCache, variableFee);
      vars.YUSDFee = vars.YUSDFee.add(variableFee);
      emit VariableFeePaid(msg.sender, variableFee);
    }

    // Adds total fees to netDebt
    vars.netDebt = vars.netDebt.add(vars.YUSDFee); // The raw debt change includes the fee

    _requireAtLeastMinNetDebt(vars.netDebt);
    // ICR is based on the composite debt,
    // i.e. the requested YUSD amount + YUSD borrowing fee + YUSD deposit fee + YUSD gas comp.
    // _getCompositeDebt returns  vars.netDebt + YUSD gas comp = 200
    vars.compositeDebt = _getCompositeDebt(vars.netDebt);

    vars.ICR = _computeCR(vars.VC, vars.compositeDebt);

    if (vars.isRecoveryMode) {
      _requireICRisAboveCCR(vars.ICR);
    } else {
      _requireICRisAboveMCR(vars.ICR);
      _requireNewTCRisAboveCCR(
        _getNewTCRFromTroveChange(
          vars.entireSystemCollRVC,
          vars.entireSystemDebt,
          vars.RVC,
          vars.compositeDebt,
          true,
          true
        )
      ); // bools: coll increase, debt increase);
    }

    // Set the trove struct's properties (1 = active)
    contractsCache.troveManager.setTroveStatus(msg.sender, 1);

    _increaseTroveDebt(contractsCache.troveManager, vars.compositeDebt);

    _updateTroveCollAndStakeAndTotalStakes(
      contractsCache.troveManager,
      _colls,
      _amounts
    );

    contractsCache.troveManager.updateTroveRewardSnapshots(msg.sender);

    // Pass in fee as percent of total VC in for boost.
    sortedTroves.insert(
      msg.sender,
      _computeCR(vars.RVC, vars.compositeDebt), // insert with new AICR.
      params._upperHint,
      params._lowerHint,
      vars.boostFactor
    );

    // Emit with trove index calculated once inserted
    emit TroveCreated(
      msg.sender,
      contractsCache.troveManager.addTroveOwnerToArray(msg.sender)
    );

    // Receive collateral for tracking by active pool
    _activePoolReceiveCollateral(contractsCache.activePool, _colls, _amounts);

    // Send the user the YUSD debt
    _withdrawYUSD(
      contractsCache.activePool,
      contractsCache.yusdToken,
      msg.sender,
      params._YUSDAmount.sub(params._totalYUSDDebtFromLever),
      vars.netDebt
    );

    // Move the YUSD gas compensation to the Gas Pool
    _withdrawYUSD(
      contractsCache.activePool,
      contractsCache.yusdToken,
      gasPoolAddress,
      YUSD_GAS_COMPENSATION,
      YUSD_GAS_COMPENSATION
    );

    emit TroveUpdated(
      msg.sender,
      vars.compositeDebt,
      _colls,
      _amounts,
      BorrowerOperation.openTrove
    );
    emit YUSDBorrowingFeePaid(msg.sender, vars.YUSDFee);
  }

  /**
   * @notice add collateral to trove. If leverage is provided then it will lever up on those collaterals using single lever up function.
   *  Can also be used to just add collateral to the trove.
   * @dev Calls _adjustTrove with correct params. Can only increase collateral and leverage, and add more debt.
   * @param _collsIn The addresses of collaterals to be added to this trove. Must be passed in, in order of the whitelisted collateral.
   * @param _amountsIn The amounts of each collateral to be used in the trove. If passing in a vault token, the amount must be the
   *  amount of the underlying asset, but the address passed in must be the vault token address. So, for example, if trying to
   *  open a trove with Benqi USDC (qiUSDC), then the address passed in must be Yeti Vault qiUSDC, but the amount must be of
   *  qiUSDC in your wallet. The resulting amount in your trove will be of the vault token, so to see how much actual qiUSDC you have
   *  you must use the conversion ratio on the vault contract.
   * @param _leverages The leverage amounts on each collateral to be used in the lever up function. If 0 there is no leverage on that coll
   * @param _maxSlippages The max slippage amount when swapping YUSD for collateral
   * @param _YUSDAmount Amount of YUSD to add to the trove debt. This is separate from the amount of YUSD taken against the leveraged amounts
   *  for each collateral which is levered up on. isDebtIncrease is automatically true.
   * @param _upperHint The address of the trove above this one in the sorted troves list.
   * @param _lowerHint The address of the trove below this one in the sorted troves list.
   * @param _maxFeePercentage The maximum percentage of the Collateral VC in that can be taken as fee.
   */
  function addCollLeverUp(
    address[] memory _collsIn,
    uint256[] memory _amountsIn,
    uint256[] memory _leverages,
    uint256[] memory _maxSlippages,
    uint256 _YUSDAmount,
    address _upperHint,
    address _lowerHint,
    uint256 _maxFeePercentage
  ) external override nonReentrant {
    ContractsCache memory contractsCache = ContractsCache(
      troveManager,
      activePool,
      yusdToken,
      controller
    );
    _requireLeverUpEnabled(contractsCache.controller);
    uint256 collsLen = _collsIn.length;

    // check that all _collsIn collateral types are in the controller and in correct order.
    _requireValidCollateral(
      _collsIn,
      _amountsIn,
      contractsCache.controller,
      true
    );

    // Must check that other passed in arrays are correct length
    _requireInputCorrect(
      collsLen == _leverages.length && collsLen == _maxSlippages.length
    );

    // Keep track of total YUSD from levering up to pass into adjustTrove
    uint256 totalYUSDDebtFromLever;
    for (uint256 i; i < collsLen; ++i) {
      if (_maxSlippages[i] != 0) {
        (
          uint256 additionalTokenAmount,
          uint256 additionalYUSDDebt
        ) = _singleLeverUp(
            _collsIn[i],
            _amountsIn[i],
            _leverages[i],
            _maxSlippages[i],
            contractsCache
          );
        // Transfer into active pool, non levered amount, and add to additional token amount returned.
        // additional token amount was set to the original amount * leverage.
        _amountsIn[i] = additionalTokenAmount.add(
          _singleTransferCollateralIntoActivePool(_collsIn[i], _amountsIn[i])
        );
        totalYUSDDebtFromLever = totalYUSDDebtFromLever.add(additionalYUSDDebt);
      } else {
        require(_leverages[i] == 0, "2");
        // Otherwise skip and do normal transfer that amount into active pool.
        _amountsIn[i] = _singleTransferCollateralIntoActivePool(
          _collsIn[i],
          _amountsIn[i]
        );
      }
    }
    AdjustTrove_Params memory params;
    params._upperHint = _upperHint;
    params._lowerHint = _lowerHint;
    params._maxFeePercentage = _maxFeePercentage;
    params._leverages = _leverages;
    _YUSDAmount = _YUSDAmount.add(totalYUSDDebtFromLever);
    params._totalYUSDDebtFromLever = totalYUSDDebtFromLever;

    params._YUSDChange = _YUSDAmount;
    params._isDebtIncrease = true;

    params._collsIn = _collsIn;
    params._amountsIn = _amountsIn;
    _adjustTrove(params, contractsCache);
  }

  /**
   * @notice Adjusts trove with multiple colls in / out. Can either add or remove collateral. No leverage available with this function.
   *   Can increase or remove debt as well. Cannot do both adding and removing the same collateral at the same time.
   * @dev Calls _adjustTrove with correct params
   * @param _collsIn The addresses of collaterals to be added to this trove. Must be passed in, in order of the whitelisted collateral.
   * @param _amountsIn The amounts of each collateral to be used in the trove. If passing in a vault token, the amount must be the
   *  amount of the underlying asset, but the address passed in must be the vault token address. So, for example, if trying to
   *  open a trove with Benqi USDC (qiUSDC), then the address passed in must be Yeti Vault qiUSDC, but the amount must be of
   *  qiUSDC in your wallet. The resulting amount in your trove will be of the vault token, so to see how much actual qiUSDC you have
   *  you must use the conversion ratio on the vault contract.
   * @param _collsOut The addresses of collaterals to be removed from this trove. Must be passed in, in order of the whitelisted collateral.
   * @param _amountsOut The amounts of each collateral to be removed from this trove. Withdrawing a vault token would require you to have
   *  the amount of the vault token, unlike when depositing. So, for example, if trying to open a trove with Benqi USDC (qiUSDC), then the
   *  address passed in must be Yeti Vault qiUSDC, and the amount is also Yeti Vault qi
   * @param _YUSDChange Amount of YUSD to either withdraw or pay back. The resulting YUSD Amount + 200 YUSD Gas compensation plus any YUSD
   *  fees plus amount from leverages must be > 2000. This min debt amount is intended to reduce the amount of small troves
   *  that are opened, since liquidating small troves may clog the network and we want to prioritize liquidations of larger
   *  troves in turbulant gas conditions.
   * @param _isDebtIncrease True if more debt is withdrawn, false if it is paid back.
   * @param _upperHint The address of the trove above this one in the sorted troves list.
   * @param _lowerHint The address of the trove below this one in the sorted troves list.
   * @param _maxFeePercentage The maximum percentage of the Collateral VC in that can be taken as fee. There is an edge case here if the
   *   VC in is less than the new debt taken out, then it will be assessed on the debt instead.
   */
  function adjustTrove(
    address[] calldata _collsIn,
    uint256[] memory _amountsIn,
    address[] calldata _collsOut,
    uint256[] calldata _amountsOut,
    uint256 _YUSDChange,
    bool _isDebtIncrease,
    address _upperHint,
    address _lowerHint,
    uint256 _maxFeePercentage
  ) external override nonReentrant {
    ContractsCache memory contractsCache = ContractsCache(
      troveManager,
      activePool,
      yusdToken,
      controller
    );
    // check that all _collsIn collateral types are in the controller
    // Replaces calls to requireValidCollateral and condenses them into one controller call.
    {
      uint256 collsInLen = _collsIn.length;
      uint256 collsOutLen = _collsOut.length;
      _requireInputCorrect(
        collsOutLen == _amountsOut.length && collsInLen == _amountsIn.length
      );
      for (uint256 i; i < collsInLen; ++i) {
        _requireInputCorrect(_amountsIn[i] != 0);
      }
      for (uint256 i; i < collsOutLen; ++i) {
        _requireInputCorrect(_amountsOut[i] != 0);
      }
    }

    // Checks that the collateral list is in order of the whitelisted collateral efficiently in controller.
    contractsCache.controller.checkCollateralListDouble(_collsIn, _collsOut);

    // pull in deposit collateral
    _transferCollateralsIntoActivePool(_collsIn, _amountsIn);

    AdjustTrove_Params memory params;
    params._leverages = new uint256[](_collsIn.length);
    params._collsIn = _collsIn;
    params._amountsIn = _amountsIn;
    params._collsOut = _collsOut;
    params._amountsOut = _amountsOut;
    params._YUSDChange = _YUSDChange;
    params._isDebtIncrease = _isDebtIncrease;
    params._upperHint = _upperHint;
    params._lowerHint = _lowerHint;
    params._maxFeePercentage = _maxFeePercentage;

    _adjustTrove(params, contractsCache);
  }

  /**
   * @notice Alongside a debt change, this function can perform either a collateral top-up or a collateral withdrawal
   * @dev the ith element of _amountsIn and _amountsOut corresponds to the ith element of the addresses _collsIn and _collsOut passed in
   * Should be called after the collsIn has been sent to ActivePool. Adjust trove params are defined in above functions.
   */
  function _adjustTrove(
    AdjustTrove_Params memory params,
    ContractsCache memory contractsCache
  ) internal {
    LocalVariables_adjustTrove memory vars;

    // Checks if we are in recovery mode, and since that requires calculations of entire system coll and debt, return that here too.
    (
      vars.isRecoveryMode,
      vars.entireSystemCollVC,
      vars.entireSystemCollRVC,
      vars.entireSystemDebt
    ) = _checkRecoveryModeAndSystem();

    // Require that the max fee percentage is correct (< 100, and if not recovery mode > 0.5)
    _requireValidMaxFeePercentage(
      params._maxFeePercentage,
      vars.isRecoveryMode
    );

    // Checks that at least one array is non-empty, and also that at least one value is 1.
    _requireNonZeroAdjustment(
      params._amountsIn,
      params._amountsOut,
      params._YUSDChange
    );

    // Require trove is active
    _requireTroveStatus(contractsCache.troveManager, true);

    // Apply pending rewards so that trove info is up to date
    _applyPendingRewards(contractsCache.troveManager);

    (vars.VCin, vars.RVCin) = _getValuesVCAndRVC(
      contractsCache.controller,
      params._collsIn,
      params._amountsIn
    );
    (vars.VCout, vars.RVCout) = _getValuesVCAndRVC(
      contractsCache.controller,
      params._collsOut,
      params._amountsOut
    );

    // If it is a debt increase then we need to take the max of VCin and debt increase and use that number to assess
    // the fee based on the new max fee percentage factor.
    if (params._isDebtIncrease) {
      vars.maxFeePercentageFactor = (vars.VCin >= params._YUSDChange)
        ? vars.VCin
        : params._YUSDChange;
    } else {
      vars.maxFeePercentageFactor = vars.VCin;
    }

    vars.netDebtChange = params._YUSDChange;

    // If the adjustment incorporates a debt increase and system is in Normal Mode, then trigger a borrowing fee
    if (params._isDebtIncrease && !vars.isRecoveryMode) {
      vars.YUSDFee = _triggerBorrowingFee(
        contractsCache,
        params._YUSDChange,
        vars.maxFeePercentageFactor, // max of VC in and YUSD change here to see what the max borrowing fee is triggered on.
        params._maxFeePercentage
      );
      // passed in max fee minus actual fee percent applied so far
      params._maxFeePercentage = params._maxFeePercentage.sub(
        vars.YUSDFee.mul(DECIMAL_PRECISION).div(vars.maxFeePercentageFactor)
      );
      vars.netDebtChange = vars.netDebtChange.add(vars.YUSDFee); // The raw debt change includes the fee
    }

    // get current portfolio in trove
    (vars.currAssets, vars.currAmounts, vars.debt) = _getCurrentTroveState(
      contractsCache.troveManager
    );

    // current VC based on current portfolio and latest prices
    (vars.currVC, vars.currRVC) = _getValuesVCAndRVC(
      contractsCache.controller,
      vars.currAssets,
      vars.currAmounts
    );

    // get new portfolio in trove after changes. Will error if invalid changes, if coll decrease is more
    // than the amount possible.
    (vars.newAssets, vars.newAmounts) = _subColls(
      _sumColls(
        newColls(vars.currAssets, vars.currAmounts),
        newColls(params._collsIn, params._amountsIn)
      ),
      params._collsOut,
      params._amountsOut
    );

    // If there is an increase in the amount of assets in a trove
    if (vars.currAssets.length < vars.newAssets.length) {
      // Check that the result is less than the maximum amount of assets in a trove
      _requireValidTroveCollsLen(
        contractsCache.controller,
        vars.currAssets.length
      );
    }

    // new RVC based on new portfolio and latest prices.
    vars.newVC = vars.currVC.add(vars.VCin).sub(vars.VCout);
    vars.newRVC = vars.currRVC.add(vars.RVCin).sub(vars.RVCout);

    vars.isRVCIncrease = vars.newRVC > vars.currRVC;

    if (vars.isRVCIncrease) {
      vars.collChangeRVC = (vars.newRVC).sub(vars.currRVC);
    } else {
      vars.collChangeRVC = (vars.currRVC).sub(vars.newRVC);
    }

    // If passing in collateral, then get the total variable deposit fee and boost factor. If fee is
    // nonzero, then require the user accepts this fee as well.
    if (params._collsIn.length != 0) {
      (
        vars.variableYUSDFee,
        vars.boostFactor
      ) = _getTotalVariableDepositFeeAndUpdate(
        contractsCache.controller,
        params._collsIn,
        params._amountsIn,
        params._leverages,
        vars.entireSystemCollVC,
        vars.VCin,
        vars.VCout
      );
      if (vars.variableYUSDFee != 0) {
        _requireUserAcceptsFee(
          vars.variableYUSDFee,
          vars.maxFeePercentageFactor,
          params._maxFeePercentage
        );
        _mintYUSDFeeAndSplit(contractsCache, vars.variableYUSDFee);
        emit VariableFeePaid(msg.sender, vars.variableYUSDFee);
      }
    }

    // Get the trove's old ICR before the adjustment, and what its new ICR will be after the adjustment
    vars.oldICR = _computeCR(vars.currVC, vars.debt);

    vars.debt = vars.debt.add(vars.variableYUSDFee);
    vars.newICR = _computeCR(
      vars.newVC, // if debt increase, then add net debt change and subtract otherwise.
      params._isDebtIncrease
        ? vars.debt.add(vars.netDebtChange)
        : vars.debt.sub(vars.netDebtChange)
    );

    // Check the adjustment satisfies all conditions for the current system mode
    // In Recovery Mode, only allow:
    // - Pure collateral top-up
    // - Pure debt repayment
    // - Collateral top-up with debt repayment
    // - A debt increase combined with a collateral top-up which makes the ICR >= 150% and improves the ICR (and by extension improves the TCR).
    //
    // In Normal Mode, ensure:
    // - The new ICR is above MCR
    // - The adjustment won't pull the TCR below CCR
    if (vars.isRecoveryMode) {
      // Require no coll withdrawal. Require that there is no coll withdrawal. The condition that _amountOut, if
      // nonzero length, has a nonzero amount in each is already checked previously, so we only need to check length here.
      require(params._amountsOut.length == 0, "3");
      if (params._isDebtIncrease) {
        _requireICRisAboveCCR(vars.newICR);
        require(vars.newICR >= vars.oldICR, "3");
      }
    } else {
      // if Normal Mode
      _requireICRisAboveMCR(vars.newICR);
      _requireNewTCRisAboveCCR(
        _getNewTCRFromTroveChange(
          vars.entireSystemCollRVC,
          vars.entireSystemDebt,
          vars.collChangeRVC,
          vars.netDebtChange,
          vars.isRVCIncrease,
          params._isDebtIncrease
        )
      );
    }

    // If eligible, then active pool receives the collateral for its internal logging.
    if (params._collsIn.length != 0) {
      _activePoolReceiveCollateral(
        contractsCache.activePool,
        params._collsIn,
        params._amountsIn
      );
    }

    // If debt increase, then add pure debt + fees
    if (params._isDebtIncrease) {
      // if debt increase, increase by both amounts
      vars.newDebt = _increaseTroveDebt(
        contractsCache.troveManager,
        vars.netDebtChange.add(vars.variableYUSDFee)
      );
    } else {
      if (vars.netDebtChange > vars.variableYUSDFee) {
        // if debt decrease, and greater than variable fee, decrease
        vars.newDebt = contractsCache.troveManager.decreaseTroveDebt(
          msg.sender,
          vars.netDebtChange - vars.variableYUSDFee
        ); // already checked no safemath needed
      } else {
        // otherwise increase by opposite subtraction
        vars.newDebt = _increaseTroveDebt(
          contractsCache.troveManager,
          vars.variableYUSDFee - vars.netDebtChange
        );
      }
    }

    // Based on new assets, update trove coll and stakes.
    _updateTroveCollAndStakeAndTotalStakes(
      contractsCache.troveManager,
      vars.newAssets,
      vars.newAmounts
    );

    // Re-insert trove in to the sorted list
    sortedTroves.reInsertWithNewBoost(
      msg.sender,
      _computeCR(vars.newRVC, vars.newDebt), // Insert with new AICR
      params._upperHint,
      params._lowerHint,
      vars.boostFactor,
      vars.VCin,
      vars.currVC
    );

    // in case of unlever up
    if (params._isUnlever) {
      // 1. Withdraw the collateral from active pool and perform swap using single unlever up and corresponding router.
      _unleverColls(
        contractsCache,
        params._collsOut,
        params._amountsOut,
        params._maxSlippages
      );
    }

    // When the adjustment is a debt repayment, check it's a valid amount and that the caller has enough YUSD
    if (
      (!params._isDebtIncrease && params._YUSDChange != 0) || params._isUnlever
    ) {
      _requireAtLeastMinNetDebt(_getNetDebt(vars.debt).sub(vars.netDebtChange));
      _requireValidYUSDRepayment(vars.debt, vars.netDebtChange);
      _requireSufficientYUSDBalance(
        contractsCache.yusdToken,
        vars.netDebtChange
      );
    }

    if (params._isUnlever) {
      // 2. update the trove with the new collateral and debt, repaying the total amount of YUSD specified.
      // if not enough coll sold for YUSD, must cover from user balance
      _repayYUSD(
        contractsCache.activePool,
        contractsCache.yusdToken,
        msg.sender,
        params._YUSDChange
      );
    } else {
      // Use the unmodified _YUSDChange here, as we don't send the fee to the user
      _moveYUSD(
        contractsCache.activePool,
        contractsCache.yusdToken,
        params._YUSDChange.sub(params._totalYUSDDebtFromLever), // 0 in non lever case
        params._isDebtIncrease,
        vars.netDebtChange
      );

      // Additionally move the variable deposit fee to the active pool manually, as it is always an increase in debt
      _withdrawYUSD(
        contractsCache.activePool,
        contractsCache.yusdToken,
        msg.sender,
        0,
        vars.variableYUSDFee
      );

      // transfer withdrawn collateral to msg.sender from ActivePool
      _sendCollateralsUnwrap(
        contractsCache.activePool,
        params._collsOut,
        params._amountsOut
      );
    }

    emit TroveUpdated(
      msg.sender,
      vars.newDebt,
      vars.newAssets,
      vars.newAmounts,
      BorrowerOperation.adjustTrove
    );

    emit YUSDBorrowingFeePaid(msg.sender, vars.YUSDFee);
  }

  /**
   * @notice internal function for un-levering up. Takes the collateral amount specified passed in, and swaps it using the whitelisted
   * router back into YUSD, so that the debt can be paid back for a certain amount.
   * @param _token The address of the collateral to swap to YUSD
   * @param _amount The amount of collateral to be swapped
   * @param _maxSlippage The maximum slippage allowed in the swap
   * @return _finalYUSDAmount The amount of YUSD to be paid back to the borrower.
   */
  function _singleUnleverUp(
    ContractsCache memory contractsCache,
    address _token,
    uint256 _amount,
    uint256 _maxSlippage
  ) internal returns (uint256 _finalYUSDAmount) {
    _requireInputCorrect(_maxSlippage <= DECIMAL_PRECISION);
    // Send collaterals to the whitelisted router from the active pool so it can perform the swap
    address router = _getDefaultRouterAddress(
      contractsCache.controller,
      _token
    );
    contractsCache.activePool.sendSingleCollateral(router, _token, _amount);

    // then calculate value amount of expected YUSD output based on amount of token to sell
    uint256 valueOfCollateral = _getValueUSD(
      contractsCache.controller,
      _token,
      _amount
    );
    uint256 slippageAdjustedValue = valueOfCollateral
      .mul(DECIMAL_PRECISION.sub(_maxSlippage))
      .div(DECIMAL_PRECISION);

    // Perform swap in the router using router.unRoute, which sends the YUSD back to the msg.sender, guaranteeing at least slippageAdjustedValue out.
    _finalYUSDAmount = IYetiLever(router).unRoute(
      msg.sender,
      _token,
      address(contractsCache.yusdToken),
      _amount,
      slippageAdjustedValue
    );
  }

  /**
   * @notice Takes the colls and amounts, transfer non levered from the active pool to the user, and unlevered to this contract
   * temporarily. Then takes the unlevered ones and calls relevant router to swap them to the user.
   * @dev Not called by close trove due to difference in total amount unlevered, ability to swap back some amount as well as unlevering
   * when closing trove.
   * @param _colls addresses of collaterals to unlever
   * @param _amounts amounts of collaterals to unlever
   * @param _maxSlippages maximum slippage allowed for each swap. If 0, then just send collateral.
   */
  function _unleverColls(
    ContractsCache memory contractsCache,
    address[] memory _colls,
    uint256[] memory _amounts,
    uint256[] memory _maxSlippages
  ) internal {
    uint256 balanceBefore = _IERC20TokenBalanceOf(
      contractsCache.yusdToken,
      msg.sender
    );
    uint256 totalYUSDUnlevered;
    for (uint256 i; i < _colls.length; ++i) {
      // If max slippages is 0, then it is a normal withdraw. Otherwise it needs to be unlevered.
      if (_maxSlippages[i] != 0) {
        totalYUSDUnlevered = totalYUSDUnlevered.add(
          _singleUnleverUp(
            contractsCache,
            _colls[i],
            _amounts[i],
            _maxSlippages[i]
          )
        );
      } else {
        _sendSingleCollateralUnwrap(
          contractsCache.activePool,
          _colls[i],
          _amounts[i]
        );
      }
    }
    // Do manual check of if balance increased by correct amount of YUSD
    require(
      _IERC20TokenBalanceOf(contractsCache.yusdToken, msg.sender) ==
        balanceBefore.add(totalYUSDUnlevered),
      "6"
    );
  }

  /**
   * @notice Withdraw collateral from a trove
   * @dev Calls _adjustTrove with correct params.
   * Specifies amount of collateral to withdraw and how much debt to repay,
   * Can withdraw coll and *only* pay back debt using this function. Will take
   * the collateral given and send YUSD back to user. Then they will pay back debt
   * first transfers amount of collateral from active pool then sells.
   * calls _singleUnleverUp() to perform the swaps using the wrappers. should have no fees.
   * @param _collsOut The addresses of collaterals to be removed from this trove. Must be passed in, in order of the whitelisted collateral.
   * @param _amountsOut The amounts of each collateral to be removed from this trove.
   *   The ith element of this array is the amount of the ith collateral in _collsOut
   * @param _maxSlippages Max slippage for each collateral type. If 0, then just withdraw without unlever
   * @param _YUSDAmount Amount of YUSD to pay back. Pulls from user's balance after doing the unlever swap, so it can be from the swap itself
   *  or it can be from their existing balance of YUSD. The resulting YUSD Amount + 200 YUSD Gas compensation plus any YUSD
   *  fees plus amount from leverages must be > 2000. This min debt amount is intended to reduce the amount of small troves
   *  that are opened, since liquidating small troves may clog the network and we want to prioritize liquidations of larger
   *  troves in turbulant gas conditions.
   * @param _upperHint The address of the trove above this one in the sorted troves list.
   * @param _lowerHint The address of the trove below this one in the sorted troves list.
   */
  function withdrawCollUnleverUp(
    address[] calldata _collsOut,
    uint256[] calldata _amountsOut,
    uint256[] calldata _maxSlippages,
    uint256 _YUSDAmount,
    address _upperHint,
    address _lowerHint
  ) external override nonReentrant {
    ContractsCache memory contractsCache = ContractsCache(
      troveManager,
      activePool,
      yusdToken,
      controller
    );
    // check that all _collsOut collateral types are in the controller, as well as that it doesn't overlap with itself.
    _requireValidCollateral(
      _collsOut,
      _amountsOut,
      contractsCache.controller,
      false
    );
    _requireInputCorrect(_amountsOut.length == _maxSlippages.length);

    AdjustTrove_Params memory params;
    params._collsOut = _collsOut;
    params._amountsOut = _amountsOut;
    params._maxSlippages = _maxSlippages;
    params._YUSDChange = _YUSDAmount;
    params._upperHint = _upperHint;
    params._lowerHint = _lowerHint;
    // Will not be used but set to 100% to pass check for valid percent.
    params._maxFeePercentage = DECIMAL_PRECISION;
    params._isUnlever = true;

    _adjustTrove(params, contractsCache);
  }

  /**
   * @notice Close trove and unlever a certain amount of collateral. For all amounts in amountsOut, transfer out that amount
   *   of collateral and swap them for YUSD. Use that YUSD and YUSD from borrower's account to pay back remaining debt.
   * @dev Calls _adjustTrove with correct params. nonReentrant
   * @param _collsOut Collateral types to withdraw
   * @param _amountsOut Amounts to withdraw. If 0, then just withdraw without unlever
   * @param _maxSlippages Max slippage for each collateral type
   */
  function closeTroveUnlever(
    address[] calldata _collsOut,
    uint256[] calldata _amountsOut,
    uint256[] calldata _maxSlippages
  ) external override nonReentrant {
    _closeTrove(_collsOut, _amountsOut, _maxSlippages, true);
  }

  /**
   * @notice Close trove and send back collateral to user. Pays back debt from their address.
   * @dev Calls _adjustTrove with correct params. nonReentrant
   */
  function closeTrove() external override nonReentrant {
    _closeTrove(new address[](0), new uint256[](0), new uint256[](0), false);
  }

  /**
   * @notice Closes trove by applying pending rewards, making sure that the YUSD Balance is sufficient, and transferring the
   * collateral to the owner, and repaying the debt.
   * @dev if it is a unlever, then it will transfer the collaterals / sell before. Otherwise it will just do it last.
   */
  function _closeTrove(
    address[] memory _collsOut,
    uint256[] memory _amountsOut,
    uint256[] memory _maxSlippages,
    bool _isUnlever
  ) internal {
    ContractsCache memory contractsCache = ContractsCache(
      troveManager,
      activePool,
      yusdToken,
      controller
    );
    LocalVariables_closeTrove memory vars;

    // Require trove is active
    _requireTroveStatus(contractsCache.troveManager, true);
    // Check recovery mode + get entire system coll RVC and debt. Can't close trove in recovery mode.
    (
      vars.isRecoveryMode,
      ,
      vars.entireSystemCollRVC,
      vars.entireSystemDebt
    ) = _checkRecoveryModeAndSystem();
    require(!vars.isRecoveryMode, "7");

    _applyPendingRewards(contractsCache.troveManager);

    // Get current trove colls to send back to user or unlever.
    (vars.colls, vars.amounts, vars.debt) = _getCurrentTroveState(
      contractsCache.troveManager
    );
    (, vars.troveRVC) = _getValuesVCAndRVC(
      contractsCache.controller,
      vars.colls,
      vars.amounts
    );
    {
      // if unlever, will do extra.
      if (_isUnlever) {
        // Withdraw the collateral from active pool and perform swap using single unlever up and corresponding router.
        // tracks the amount of YUSD that is received from swaps. Will send the _YUSDAmount back to repay debt while keeping remainder.
        // The router itself handles unwrapping
        uint256 j;
        uint256 balanceBefore = _IERC20TokenBalanceOf(
          contractsCache.yusdToken,
          msg.sender
        );
        uint256 totalYUSDUnlevered;
        for (uint256 i; i < vars.colls.length; ++i) {
          uint256 thisAmount = vars.amounts[i];
          if (j < _collsOut.length && vars.colls[i] == _collsOut[j]) {
            totalYUSDUnlevered = totalYUSDUnlevered.add(
              _singleUnleverUp(
                contractsCache,
                _collsOut[j],
                _amountsOut[j],
                _maxSlippages[j]
              )
            );
            // In the case of unlever, only unlever the amount passed in, and send back the difference
            thisAmount = thisAmount.sub(_amountsOut[j]);
            ++j;
          }
          // Send back remaining collateral
          if (thisAmount > 0) {
            _sendSingleCollateralUnwrap(
              contractsCache.activePool,
              vars.colls[i],
              thisAmount
            );
          }
        }
        // Do manual check of if balance increased by correct amount of YUSD
        require(
          _IERC20TokenBalanceOf(contractsCache.yusdToken, msg.sender) ==
            balanceBefore.add(totalYUSDUnlevered),
          "6"
        );
      }
    }

    // do check after unlever (if applies)
    _requireSufficientYUSDBalance(
      contractsCache.yusdToken,
      vars.debt.sub(YUSD_GAS_COMPENSATION)
    );
    _requireNewTCRisAboveCCR(
      _getNewTCRFromTroveChange(
        vars.entireSystemCollRVC,
        vars.entireSystemDebt,
        vars.troveRVC,
        vars.debt,
        false,
        false
      )
    );

    contractsCache.troveManager.removeStakeAndCloseTrove(msg.sender);

    // Burn the repaid YUSD from the user's balance and the gas compensation from the Gas Pool
    _repayYUSD(
      contractsCache.activePool,
      contractsCache.yusdToken,
      msg.sender,
      vars.debt.sub(YUSD_GAS_COMPENSATION)
    );
    _repayYUSD(
      contractsCache.activePool,
      contractsCache.yusdToken,
      gasPoolAddress,
      YUSD_GAS_COMPENSATION
    );

    // Send the collateral back to the user
    // Also sends the rewards
    if (!_isUnlever) {
      _sendCollateralsUnwrap(
        contractsCache.activePool,
        vars.colls,
        vars.amounts
      );
    }

    // Essentially delete trove event.
    emit TroveUpdated(
      msg.sender,
      0,
      new address[](0),
      new uint256[](0),
      BorrowerOperation.closeTrove
    );
  }

  // --- Helper functions ---

  /**
   * @notice Transfer in collateral and send to ActivePool
   * @dev Active pool is where the collateral is held
   */
  function _transferCollateralsIntoActivePool(
    address[] memory _colls,
    uint256[] memory _amounts
  ) internal {
    uint256 amountsLen = _amounts.length;
    for (uint256 i; i < amountsLen; ++i) {
      // this _amounts array update persists during the code that runs after
      _amounts[i] = _singleTransferCollateralIntoActivePool(
        _colls[i],
        _amounts[i]
      );
    }
  }

  /**
   * @notice does one transfer of collateral into active pool. Checks that it transferred to the active pool correctly
   * In the case that it is wrapped token, it will wrap it on transfer in.
   * @return  the amount of receipt tokens it receives back if it is a vault token or otherwise
   * returns the amount of the collateral token returned
   */
  function _singleTransferCollateralIntoActivePool(
    address _coll,
    uint256 _amount
  ) internal returns (uint256) {
    if (controller.isWrapped(_coll)) {
      // If vault asset then it wraps it and sends the wrapped version to the active pool
      // The amount is returned as the amount of receipt tokens that the user has.
      return
        IYetiVaultToken(_coll).depositFor(
          msg.sender,
          address(activePool),
          _amount
        );
    } else {
      IERC20(_coll).safeTransferFrom(msg.sender, activePoolAddress, _amount);
      return _amount;
    }
  }

  /**
   * @notice Triggers normal borrowing fee
   * @dev Calculated from base rate and on YUSD amount.
   * @param _YUSDAmount YUSD amount sent in
   * @param _maxFeePercentageFactor the factor to assess the max fee on
   * @param _maxFeePercentage the passed in max fee percentage.
   * @return YUSDFee The resulting one time borrow fee.
   */
  function _triggerBorrowingFee(
    ContractsCache memory contractsCache,
    uint256 _YUSDAmount,
    uint256 _maxFeePercentageFactor,
    uint256 _maxFeePercentage
  ) internal returns (uint256 YUSDFee) {
    YUSDFee = contractsCache
      .troveManager
      .decayBaseRateFromBorrowingAndCalculateFee(_YUSDAmount); // decay the baseRate state variable

    _requireUserAcceptsFee(YUSDFee, _maxFeePercentageFactor, _maxFeePercentage);

    // Send fee to YUSD Fee recipient (sYETI) contract
    _mintYUSDFeeAndSplit(contractsCache, YUSDFee);
  }

  /**
   * @notice Function for minting YUSD to the treasury and to the recipient sYETI based on params in yeti controller
   * @param _YUSDFee total fee to split
   */
  function _mintYUSDFeeAndSplit(
    ContractsCache memory contractsCache,
    uint256 _YUSDFee
  ) internal {
    // Get fee splits and treasury address.
    (
      uint256 feeSplit,
      address yetiTreasury,
      address YUSDFeeRecipient
    ) = contractsCache.controller.getFeeSplitInformation();
    uint256 treasurySplit = feeSplit.mul(_YUSDFee).div(DECIMAL_PRECISION);
    // Mint a percentage to the treasury
    _yusdTokenMint(contractsCache.yusdToken, yetiTreasury, treasurySplit);
    // And the rest to YUSD Fee recipient
    _yusdTokenMint(
      contractsCache.yusdToken,
      YUSDFeeRecipient,
      _YUSDFee - treasurySplit
    );
  }

  /**
   * @notice Moves the YUSD around based on whether it is an increase or decrease in debt. Mints to active pool or takes from active pool
   * @param _YUSDChange amount of YUSD to mint or burn
   * @param _isDebtIncrease if true then withdraw (mint) YUSD, otherwise burn it.
   */
  function _moveYUSD(
    IActivePool _activePool,
    IYUSDToken _yusdToken,
    uint256 _YUSDChange,
    bool _isDebtIncrease,
    uint256 _netDebtChange
  ) internal {
    if (_isDebtIncrease) {
      _withdrawYUSD(
        _activePool,
        _yusdToken,
        msg.sender,
        _YUSDChange,
        _netDebtChange
      );
    } else {
      _repayYUSD(_activePool, _yusdToken, msg.sender, _YUSDChange);
    }
  }

  /**
   * @notice Issue the specified amount of YUSD to _account and increases the total active debt
   * @dev _netDebtIncrease potentially includes a YUSDFee
   */
  function _withdrawYUSD(
    IActivePool _activePool,
    IYUSDToken _yusdToken,
    address _account,
    uint256 _YUSDAmount,
    uint256 _netDebtIncrease
  ) internal {
    _activePool.increaseYUSDDebt(_netDebtIncrease);
    _yusdTokenMint(_yusdToken, _account, _YUSDAmount);
  }

  /**
   * @notice Burn the specified amount of YUSD from _account and decreases the total active debt
   */
  function _repayYUSD(
    IActivePool _activePool,
    IYUSDToken _yusdToken,
    address _account,
    uint256 _YUSDAmount
  ) internal {
    _activePool.decreaseYUSDDebt(_YUSDAmount);
    _yusdToken.burn(_account, _YUSDAmount);
  }

  /**
   * @notice Returns _coll1.amounts minus _amounts2. Used
   * @dev Invariant that _coll1.tokens and _tokens2 are sorted by whitelist order of token indices from the YetiController.
   *    So, if WAVAX is whitelisted first, then WETH, then USDC, then [WAVAX, USDC] is a valid input order but [USDC, WAVAX] is not.
   *    This is done for gas efficiency. It will revert if there is a token existing in _tokens2 that is not in _coll1.tokens.
   *    Each iteration we increase the index for _coll1.tokens, and if the token is next in _tokens2, we perform the subtraction
   *    which will throw an error if it underflows. Since they are ordered, if that next index in _coll1.tokens is less than the next
   *    index in _tokens2, that means that next index in _tokens 2 is not in _coll1.tokens. If it reaches the end of _tokens2, then
   *    we add the remaining collaterals in _coll1 to the result and we are done. If it reaches the end of _coll1, then check that
   *    _coll2 is also empty. We are not sure how many tokens are nonzero so we also have to keep track of it to make their token
   *    array not keep 0 values. It will fill the first k entries post subtraction, so we can loop through the first k entries in
   *    coll3.tokens, returning the final result coll4. This gives O(n) time complexity for the first loop where n is the number
   *    of tokens in _coll1.tokens. The second loop is O(k) where k is the number of resulting nonzero values. k is bounded by n
   *    so the resulting time upper bound is O(2n), not depending on L = number of whitelisted collaterals. Since we are using
   *    _coll1.tokens as the baseline the result of _subColls will also be sorted, keeping the invariant.
   */
  function _subColls(
    newColls memory _coll1,
    address[] memory _tokens2,
    uint256[] memory _amounts2
  ) internal view returns (address[] memory, uint256[] memory) {
    // If subtracting nothing just return the _coll1 tokens and amounts.
    if (_tokens2.length == 0) {
      return (_coll1.tokens, _coll1.amounts);
    }
    uint256 coll1Len = _coll1.tokens.length;

    newColls memory coll3;
    coll3.tokens = new address[](coll1Len);
    coll3.amounts = new uint256[](coll1Len);

    uint256[] memory tokenIndices1 = _getIndices(_coll1.tokens);
    uint256[] memory tokenIndices2 = _getIndices(_tokens2);

    // Tracker for the tokens1 array
    uint256 i;
    // Tracker for the tokens2 array
    uint256 j;
    // number of nonzero entries post subtraction.
    uint256 k;

    // Tracker for token whitelist index for all coll2.
    uint256 tokenIndex2 = tokenIndices2[j];
    // Loop through all tokens1 in order.
    for (; i < coll1Len; ++i) {
      uint256 tokenIndex1 = tokenIndices1[i];
      // If skipped past tokenIndex 2, then that means it was not seen in token index 1 array and this is an invalid sub.
      _requireInputCorrect(tokenIndex2 >= tokenIndex1);
      // If they are equal do the subtraction and increment j / token index 2.
      if (tokenIndex1 == tokenIndex2) {
        coll3.amounts[k] = _coll1.amounts[i].sub(_amounts2[j]);
        // if nonzero, add to coll3 and increment k
        if (coll3.amounts[k] != 0) {
          coll3.tokens[k] = _coll1.tokens[i];
          ++k;
        }
        // If we have reached the end of tokens2, exit out to finish adding the remaining coll1 values.
        if (j == _tokens2.length - 1) {
          ++i;
          break;
        }
        ++j;
        tokenIndex2 = tokenIndices2[j];
      } else {
        // Otherwise just add just add the coll1 value without subtracting.
        coll3.amounts[k] = _coll1.amounts[i];
        coll3.tokens[k] = _coll1.tokens[i];
        ++k;
      }
    }
    while (i < coll1Len) {
      coll3.tokens[k] = _coll1.tokens[i];
      coll3.amounts[k] = _coll1.amounts[i];
      ++i;
      ++k;
    }
    // Require no additional token2 to be processed.
    _requireInputCorrect(j == _tokens2.length - 1);

    // Copy in all nonzero values from coll3 to coll4. The first k values in coll3 will be nonzero.
    newColls memory coll4;
    coll4.tokens = new address[](k);
    coll4.amounts = new uint256[](k);
    for (i = 0; i < k; ++i) {
      coll4.tokens[i] = coll3.tokens[i];
      coll4.amounts[i] = coll3.amounts[i];
    }
    return (coll4.tokens, coll4.amounts);
  }

  // --- 'Require' wrapper functions ---

  /**
   * @notice Require that the amount of collateral in the trove is not more than the max
   */
  function _requireValidTroveCollsLen(IYetiController controller, uint256 _n)
    internal
    view
  {
    require(_n <= controller.getMaxCollsInTrove());
  }

  /**
   * @notice Checks that amounts are nonzero, that the the length of colls and amounts are the same, that the coll is active,
   * and that there is no overlap collateral in the list. Calls controller version, which does these checks.
   */
  function _requireValidCollateral(
    address[] memory _colls,
    uint256[] memory _amounts,
    IYetiController controller,
    bool _deposit
  ) internal view {
    uint256 collsLen = _colls.length;
    _requireInputCorrect(collsLen == _amounts.length);
    for (uint256 i; i < collsLen; ++i) {
      _requireInputCorrect(_amounts[i] != 0);
    }
    controller.checkCollateralListSingle(_colls, _deposit);
  }

  /**
   * @notice Whether amountsIn is 0 or amountsOut is 0
   * @dev Condition of whether amountsIn is 0 amounts, or amountsOut is 0 amounts, is checked in previous call
   * to _requireValidCollateral
   */
  function _requireNonZeroAdjustment(
    uint256[] memory _amountsIn,
    uint256[] memory _amountsOut,
    uint256 _YUSDChange
  ) internal pure {
    require(
      _YUSDChange != 0 || _amountsIn.length != 0 || _amountsOut.length != 0,
      "1"
    );
  }

  /**
   * @notice require that lever up is enabled, stored in the Yeti Controller.
   */
  function _requireLeverUpEnabled(IYetiController _controller) internal view {
    require(_controller.leverUpEnabled(), "13");
  }

  /**
   * @notice Require trove is active or not, depending on what is passed in.
   */
  function _requireTroveStatus(ITroveManager _troveManager, bool _active)
    internal
    view
  {
    require(_troveManager.isTroveActive(msg.sender) == _active, "1");
  }

  /**
   * @notice Function require length equal, used to save contract size on revert strings
   */
  function _requireInputCorrect(bool lengthCorrect) internal pure {
    require(lengthCorrect, "19");
  }

  /**
   * @notice Require that ICR is above the MCR of 110%
   */
  function _requireICRisAboveMCR(uint256 _newICR) internal pure {
    require(_newICR >= MCR, "20");
  }

  /**
   * @notice Require that ICR is above CCR of 150%, used in Recovery mode
   */
  function _requireICRisAboveCCR(uint256 _newICR) internal pure {
    require(_newICR >= CCR, "21");
  }

  /**
   * @notice Require that new TCR is above CCR of 150%, to prevent drop into Recovery mode
   */
  function _requireNewTCRisAboveCCR(uint256 _newTCR) internal pure {
    require(_newTCR >= CCR, "23");
  }

  /**
   * @notice Require that the debt is above 2000
   */
  function _requireAtLeastMinNetDebt(uint256 _netDebt) internal pure {
    require(_netDebt >= MIN_NET_DEBT, "8");
  }

  /**
   * @notice Require that the YUSD repayment is valid at current debt.
   */
  function _requireValidYUSDRepayment(
    uint256 _currentDebt,
    uint256 _debtRepayment
  ) internal pure {
    require(_debtRepayment <= _currentDebt.sub(YUSD_GAS_COMPENSATION), "9");
  }

  /**
   * @notice Require the borrower has enough YUSD to pay back the debt they are supposed to pay back.
   */
  function _requireSufficientYUSDBalance(
    IYUSDToken _yusdToken,
    uint256 _debtRepayment
  ) internal view {
    require(
      _IERC20TokenBalanceOf(_yusdToken, msg.sender) >= _debtRepayment,
      "26"
    );
  }

  /**
   * @notice requires that the max fee percentage is <= than 100%, and that the fee percentage is >= borrowing floor except in rec mode
   */
  function _requireValidMaxFeePercentage(
    uint256 _maxFeePercentage,
    bool _isRecoveryMode
  ) internal pure {
    // Alwawys require max fee to be less than 100%, and if not in recovery mode then max fee must be greater than 0.5%
    if (
      _maxFeePercentage > DECIMAL_PRECISION ||
      (!_isRecoveryMode && _maxFeePercentage < BORROWING_FEE_FLOOR)
    ) {
      revert("27");
    }
  }

  // --- ICR and TCR getters ---

  /**
   * Calculates new TCR from the trove change based on coll increase and debt change.
   */
  function _getNewTCRFromTroveChange(
    uint256 _entireSystemColl,
    uint256 _entireSystemDebt,
    uint256 _collChange,
    uint256 _debtChange,
    bool _isCollIncrease,
    bool _isDebtIncrease
  ) internal pure returns (uint256) {
    _entireSystemColl = _isCollIncrease
      ? _entireSystemColl.add(_collChange)
      : _entireSystemColl.sub(_collChange);
    _entireSystemDebt = _isDebtIncrease
      ? _entireSystemDebt.add(_debtChange)
      : _entireSystemDebt.sub(_debtChange);

    return _computeCR(_entireSystemColl, _entireSystemDebt);
  }

  // --- External call functions included in internal functions to reduce contract size ---

  /**
   * @notice calls apply pending rewards from trove manager
   */
  function _applyPendingRewards(ITroveManager _troveManager) internal {
    _troveManager.applyPendingRewards(msg.sender);
  }

  /**
   * @notice calls yusd token mint function
   */
  function _yusdTokenMint(
    IYUSDToken _yusdToken,
    address _to,
    uint256 _amount
  ) internal {
    _yusdToken.mint(_to, _amount);
  }

  /**
   * @notice calls send collaterals unwrap function in active pool
   */
  function _sendCollateralsUnwrap(
    IActivePool _activePool,
    address[] memory _collsOut,
    uint256[] memory _amountsOut
  ) internal {
    _activePool.sendCollateralsUnwrap(msg.sender, _collsOut, _amountsOut);
  }

  /**
   * @notice calls send single collateral unwrap function in active pool
   */
  function _sendSingleCollateralUnwrap(
    IActivePool _activePool,
    address _collOut,
    uint256 _amountOut
  ) internal {
    _activePool.sendSingleCollateralUnwrap(msg.sender, _collOut, _amountOut);
  }

  /**
   * @notice calls increase trove debt from trove manager
   */
  function _increaseTroveDebt(ITroveManager _troveManager, uint256 _amount)
    internal
    returns (uint256)
  {
    return _troveManager.increaseTroveDebt(msg.sender, _amount);
  }

  /**
   * @notice calls update trove coll, and updates stake and total stakes for the borrower as well.
   */
  function _updateTroveCollAndStakeAndTotalStakes(
    ITroveManager _troveManager,
    address[] memory _colls,
    uint256[] memory _amounts
  ) internal {
    _troveManager.updateTroveCollAndStakeAndTotalStakes(
      msg.sender,
      _colls,
      _amounts
    );
  }

  /**
   * @notice calls receive collateral from the active pool
   */
  function _activePoolReceiveCollateral(
    IActivePool _activePool,
    address[] memory _colls,
    uint256[] memory _amounts
  ) internal {
    _activePool.receiveCollateral(_colls, _amounts);
  }

  /**
   * @notice gets the current trove state (colls, amounts, debt)
   */
  function _getCurrentTroveState(ITroveManager _troveManager)
    internal
    view
    returns (
      address[] memory,
      uint256[] memory,
      uint256
    )
  {
    return _troveManager.getCurrentTroveState(msg.sender);
  }

  /**
   * @notice Gets the default router address from the yeti controller.
   */
  function _getDefaultRouterAddress(IYetiController _controller, address _token)
    internal
    view
    returns (address)
  {
    return _controller.getDefaultRouterAddress(_token);
  }

  /**
   * @notice Gets the value in USD of the collateral (no collateral weight)
   */
  function _getValueUSD(
    IYetiController _controller,
    address _token,
    uint256 _amount
  ) internal view returns (uint256) {
    return _controller.getValueUSD(_token, _amount);
  }

  /**
   * @notice Gets the value in both VC and RVC from Controller at once to prevent additional loops.
   */
  function _getValuesVCAndRVC(
    IYetiController _controller,
    address[] memory _colls,
    uint256[] memory _amounts
  ) internal view returns (uint256, uint256) {
    return _controller.getValuesVCAndRVC(_colls, _amounts);
  }

  /**
   * @notice Gets the total variable deposit fee, and updates the last fee seen. See
   *   YetiController and ThreePieceWiseFeeCurve for implementation details.
   */
  function _getTotalVariableDepositFeeAndUpdate(
    IYetiController controller,
    address[] memory _colls,
    uint256[] memory _amounts,
    uint256[] memory _leverages,
    uint256 _entireSystemColl,
    uint256 _VCin,
    uint256 _VCout
  ) internal returns (uint256, uint256) {
    return
      controller.getTotalVariableDepositFeeAndUpdate(
        _colls,
        _amounts,
        _leverages,
        _entireSystemColl,
        _VCin,
        _VCout
      );
  }

  /**
   * @notice Gets YUSD or some other token balance of an account.
   */
  function _IERC20TokenBalanceOf(IERC20 _token, address _borrower)
    internal
    view
    returns (uint256)
  {
    return _token.balanceOf(_borrower);
  }

  /**
   * @notice calls multi getter for indices of collaterals passed in.
   */
  function _getIndices(address[] memory colls)
    internal
    view
    returns (uint256[] memory)
  {
    return controller.getIndices(colls);
  }
}
