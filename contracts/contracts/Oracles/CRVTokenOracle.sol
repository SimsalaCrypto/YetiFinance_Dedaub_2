// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/SafeMath.sol";

import "../Interfaces/IBaseOracle.sol";

import "../Dependencies/Ownable.sol";

interface IWrapped {
  function getDepositTokensForShares(uint256) external view returns (uint256);

  function getSharesForDepositTokens(uint256) external view returns (uint256);
}

interface ICRV {
  function get_virtual_price() external view returns (uint256);
}

contract CRVOracle is Ownable {
  using SafeMath for uint256;

  IBaseOracle base;
  address[] underlying;
  IWrapped wrapped;
  ICRV crv;

  function setParam(
    IBaseOracle _base,
    address _receiptToken,
    address _crv,
    address[] calldata _underlying
  ) external onlyOwner {
    base = _base;
    underlying = _underlying;
    wrapped = IWrapped(_receiptToken);
    crv = ICRV(_crv);
  }

  function fetchPrice_v() public returns (uint256) {
    // MAX_INT
    uint256 cheapestToken = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    for (uint256 i = 0; i < underlying.length; i++) {
      uint256 underlyingPrice = base.getPrice(underlying[i]);
      if (underlyingPrice < cheapestToken) {
        cheapestToken = underlyingPrice;
      }
    }
    assert(
      cheapestToken !=
        115792089237316195423570985008687907853269984665640564039457584007913129639935
    );
    return
      (wrapped.getDepositTokensForShares(1e18) *
        crv.get_virtual_price() *
        cheapestToken) / 1e36;
  }

  function fetchPrice() external returns (uint256) {
    return fetchPrice_v();
  }
}
