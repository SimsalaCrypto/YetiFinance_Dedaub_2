// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../BorrowerOperations.sol";

/* Tester contract inherits from BorrowerOperations, and provides external functions 
for testing the parent's internal functions. */
contract BorrowerOperationsTester is BorrowerOperations {
  event Sum(address[] tokens, uint256[] amounts);

  function getNewICRFromTroveChange(
    uint256 _newVC,
    uint256 _debt,
    uint256 _debtChange,
    bool _isDebtIncrease
  ) external pure returns (uint256) {
    return
      _getNewICRFromTroveChange(_newVC, _debt, _debtChange, _isDebtIncrease);
  }

  function getNewTCRFromTroveChange(
    uint256 _collChange,
    bool isCollIncrease,
    uint256 _debtChange,
    bool isDebtIncrease
  ) external view returns (uint256) {
    return
      _getNewTCRFromTroveChange(
        getEntireSystemColl(),
        getEntireSystemDebt(),
        _collChange,
        isCollIncrease,
        _debtChange,
        isDebtIncrease
      );
  }

  function getVC(address[] memory _tokens, uint256[] memory _amounts)
    external
    view
    returns (uint256)
  {
    return _getVC(_tokens, _amounts);
  }

  function sumColls(
    address[] memory _tokens1,
    uint256[] memory _amounts1,
    address[] memory _tokens2,
    uint256[] memory _amounts2
  ) external view returns (address[] memory, uint256[] memory) {
    newColls memory result = _sumColls(
      newColls(_tokens1, _amounts1),
      newColls(_tokens2, _amounts2)
    );
    return (result.tokens, result.amounts);
  }

  function get_MIN_NET_DEBT() external pure returns (uint256) {
    return MIN_NET_DEBT;
  }

  // call _subColls
  function subColls(
    address[] memory _tokens1,
    uint256[] memory _amounts1,
    address[] memory _tokens2,
    uint256[] memory _amounts2
  ) external {
    newColls memory diff = _subColls(
      newColls(_tokens1, _amounts1),
      _tokens2,
      _amounts2
    );
    emit Sum(diff.tokens, diff.amounts);
  }

  // Payable fallback function
  receive() external payable {}
}
