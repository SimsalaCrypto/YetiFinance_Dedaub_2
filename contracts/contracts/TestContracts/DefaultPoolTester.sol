// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../DefaultPool.sol";

contract DefaultPoolTester is DefaultPool {
  function unprotectedIncreaseYUSDDebt(uint256 _amount) external {
    YUSDDebt = YUSDDebt.add(_amount);
  }

  function unprotectedPayable() external payable {
    // @KingYet: Commented
    // ETH = ETH.add(msg.value);
  }

  function getEthAmount() external view returns (uint256) {
    return poolColl.amounts[0];
  }

  function getCollateralVCC(address _collateral)
    external
    view
    returns (uint256)
  {
    return whitelist.getValueVC(_collateral, getCollateral(_collateral));
  }
}
