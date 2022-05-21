// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.7;

// Wrapped Asset
interface IWAsset {
  function wrap(
    uint256 _amount,
    address _from,
    address _to,
    address _rewardOwner
  ) external;

  function unwrap(uint256 amount) external;

  function unwrapFor(
    address _from,
    address _to,
    uint256 amount
  ) external;

  function updateReward(
    address from,
    address to,
    uint256 amount
  ) external;

  function claimReward(address _to) external;

  function getPendingRewards(address _for)
    external
    view
    returns (address[] memory tokens, uint256[] memory amounts);

  function getUserInfo(address _user)
    external
    returns (
      uint256,
      uint256,
      uint256
    );

  function endTreasuryReward(address _to, uint256 _amount) external;
}
