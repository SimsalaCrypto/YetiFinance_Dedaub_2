// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface IPriceFeed {
  // --- Events ---
  event LastGoodPriceUpdated(uint256 _lastGoodPrice);

  // --- Function ---
  // function fetchPrice() external returns (uint);

  function fetchPrice_v() external view returns (uint256);
}
