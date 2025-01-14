// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./IPool.sol";

interface IActivePool is IPool {
  // --- Events ---
  event ActivePoolYUSDDebtUpdated(uint256 _YUSDDebt);
  event ActivePoolCollateralBalanceUpdated(
    address _collateral,
    uint256 _amount
  );

  // --- Functions ---

  function sendCollaterals(
    address _to,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;

  function sendCollateralsUnwrap(
    address _to,
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;

  function sendSingleCollateral(
    address _to,
    address _token,
    uint256 _amount
  ) external;

  function sendSingleCollateralUnwrap(
    address _to,
    address _token,
    uint256 _amount
  ) external;

  function getCollateralVC(address collateralAddress)
    external
    view
    returns (uint256);

  function addCollateralType(address _collateral) external;

  function getAmountsSubsetSystem(address[] memory _collaterals)
    external
    view
    returns (uint256[] memory);

  function getVCSystem() external view returns (uint256 totalVCSystem);

  function getVCAndRVCSystem()
    external
    view
    returns (uint256 totalVC, uint256 totalRVC);
}
