// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface ICollateralReceiver {
  function receiveCollateral(
    address[] memory _tokens,
    uint256[] memory _amounts
  ) external;
}
