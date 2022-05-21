// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./LiquityMath.sol";
import "../Interfaces/IActivePool.sol";
import "../Interfaces/IDefaultPool.sol";
import "../Interfaces/ILiquityBase.sol";
import "./YetiCustomBase.sol";

/*
 * Base contract for TroveManager, BorrowerOperations and StabilityPool. Contains global system constants and
 * common functions.
 */
contract LiquityBase is ILiquityBase, YetiCustomBase {
  // Minimum collateral ratio for individual troves
  uint256 public constant MCR = 11e17; // 110%

  // Critical system collateral ratio. If the system's total collateral ratio (TCR) falls below the CCR, Recovery Mode is triggered.
  uint256 public constant CCR = 15e17; // 150%

  // Amount of YUSD to be locked in gas pool on opening troves
  uint256 public constant YUSD_GAS_COMPENSATION = 200e18;

  // Minimum amount of net YUSD debt a must have
  uint256 public constant MIN_NET_DEBT = 1800e18;
  // uint constant public MIN_NET_DEBT = 0;

  uint256 public constant BORROWING_FEE_FLOOR = (DECIMAL_PRECISION / 1000) * 5; // 0.5%
  uint256 public constant REDEMPTION_FEE_FLOOR = (DECIMAL_PRECISION / 1000) * 5; // 0.5%

  IActivePool internal activePool;

  IDefaultPool internal defaultPool;

  // --- Gas compensation functions ---

  // Returns the composite debt (drawn debt + gas compensation) of a trove, for the purpose of ICR calculation
  function _getCompositeDebt(uint256 _debt) internal pure returns (uint256) {
    return _debt.add(YUSD_GAS_COMPENSATION);
  }

  // returns the net debt, which is total debt - gas compensation of a trove
  function _getNetDebt(uint256 _debt) internal pure returns (uint256) {
    return _debt.sub(YUSD_GAS_COMPENSATION);
  }

  // Return the system's Total Virtual Coin Balance
  // Virtual Coins are a way to keep track of the system collateralization given
  // the collateral ratios of each collateral type
  function getEntireSystemColl() public view returns (uint256) {
    return activePool.getVCSystem();
  }

  function getEntireSystemDebt() public view override returns (uint256) {
    uint256 activeDebt = activePool.getYUSDDebt();
    uint256 closedDebt = defaultPool.getYUSDDebt();

    return activeDebt.add(closedDebt);
  }

  function _getICRColls(newColls memory _colls, uint256 _debt)
    internal
    view
    returns (uint256 ICR)
  {
    uint256 totalVC = _getVCColls(_colls);
    ICR = LiquityMath._computeCR(totalVC, _debt);
  }

  function _getRICRColls(newColls memory _colls, uint256 _debt)
    internal
    view
    returns (uint256 RICR)
  {
    uint256 totalVC = _getRVCColls(_colls);
    RICR = LiquityMath._computeCR(totalVC, _debt);
  }

  function _getVC(address[] memory _tokens, uint256[] memory _amounts)
    internal
    view
    returns (uint256 totalVC)
  {
    totalVC = whitelist.getValuesVC(_tokens, _amounts);
  }

  function _getRVC(address[] memory _tokens, uint256[] memory _amounts)
    internal
    view
    returns (uint256 totalRVC)
  {
    totalRVC = whitelist.getValuesRVC(_tokens, _amounts);
  }

  function _getVCColls(newColls memory _colls)
    internal
    view
    returns (uint256 totalVC)
  {
    totalVC = whitelist.getValuesVC(_colls.tokens, _colls.amounts);
  }

  function _getRVCColls(newColls memory _colls)
    internal
    view
    returns (uint256 totalRVC)
  {
    totalRVC = whitelist.getValuesRVC(_colls.tokens, _colls.amounts);
  }

  function _getUSDColls(newColls memory _colls)
    internal
    view
    returns (uint256 totalUSDValue)
  {
    totalUSDValue = whitelist.getValuesUSD(_colls.tokens, _colls.amounts);
  }

  function _getTCR() internal view returns (uint256 TCR) {
    (, uint256 entireSystemCollForTCR) = activePool.getVCforTCRSystem();
    uint256 entireSystemDebt = getEntireSystemDebt();

    TCR = LiquityMath._computeCR(entireSystemCollForTCR, entireSystemDebt);
  }

  // Returns recovery mode bool as well as entire system coll
  // Do these together to avoid looping.
  function _checkRecoveryModeAndSystem()
    internal
    view
    returns (
      bool recMode,
      uint256 entireSystemColl,
      uint256 entireSystemDebt
    )
  {
    uint256 entireSystemCollForTCR;
    (entireSystemColl, entireSystemCollForTCR) = activePool.getVCforTCRSystem();
    entireSystemDebt = getEntireSystemDebt();
    // Check TCR < CCR
    recMode =
      LiquityMath._computeCR(entireSystemCollForTCR, entireSystemDebt) < CCR;
  }

  function _checkRecoveryMode() internal view returns (bool) {
    return _getTCR() < CCR;
  }

  // fee and amount are denominated in dollar
  function _requireUserAcceptsFee(
    uint256 _fee,
    uint256 _amount,
    uint256 _maxFeePercentage
  ) internal pure {
    uint256 feePercentage = _fee.mul(DECIMAL_PRECISION).div(_amount);
    require(feePercentage <= _maxFeePercentage, "Fee > max");
  }

  // checks coll has a nonzero balance of at least one token in coll.tokens
  function _collsIsNonZero(newColls memory _colls)
    internal
    pure
    returns (bool)
  {
    uint256 tokensLen = _colls.tokens.length;
    for (uint256 i; i < tokensLen; ++i) {
      if (_colls.amounts[i] != 0) {
        return true;
      }
    }
    return false;
  }
}
