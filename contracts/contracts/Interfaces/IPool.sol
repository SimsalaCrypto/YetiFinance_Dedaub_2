// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./ICollateralReceiver.sol";

// Common interface for the Pools.
interface IPool is ICollateralReceiver {
  // --- Events ---

  event ETHBalanceUpdated(uint256 _newBalance);
  event YUSDBalanceUpdated(uint256 _newBalance);
  event EtherSent(address _to, uint256 _amount);
  event CollateralSent(address _collateral, address _to, uint256 _amount);

  // --- Functions ---

  function getVC() external view returns (uint256 totalVC);

  function getVCAndRVC()
    external
    view
    returns (uint256 totalVC, uint256 totalRVC);

  function getCollateral(address collateralAddress)
    external
    view
    returns (uint256);

  function getAllCollateral()
    external
    view
    returns (address[] memory, uint256[] memory);

  function getYUSDDebt() external view returns (uint256);

  function increaseYUSDDebt(uint256 _amount) external;

  function decreaseYUSDDebt(uint256 _amount) external;
}
