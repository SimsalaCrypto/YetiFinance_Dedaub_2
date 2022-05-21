// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.13;

interface IveYETI {
  function updateWhitelistedCallers(
    address _contractAddress,
    bool _isWhitelisted
  ) external;

  function getVeYetiOnRewarder(address _user, address _rewarder)
    external
    view
    returns (uint256);

  function getUserYetiOnRewarder(address _user, address _rewarder)
    external
    view
    returns (uint256);

  function getAccumulationRate() external view returns (uint256);
}
