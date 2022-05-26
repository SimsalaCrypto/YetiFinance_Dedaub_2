// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.13;

interface IvePREON {
  function updateWhitelistedCallers(
    address _contractAddress,
    bool _isWhitelisted
  ) external;

  function getVePreonOnRewarder(address _user, address _rewarder)
    external
    view
    returns (uint256);

  function getUserPreonOnRewarder(address _user, address _rewarder)
    external
    view
    returns (uint256);

  function getAccumulationRate() external view returns (uint256);
}
