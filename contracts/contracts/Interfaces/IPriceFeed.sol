// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface IPriceFeed {
  event LastGoodPriceUpdated(uint256 _lastGoodPrice);

  function fetchPrice_v() external view returns (uint256);

  function fetchPrice() external returns (uint256);
}
