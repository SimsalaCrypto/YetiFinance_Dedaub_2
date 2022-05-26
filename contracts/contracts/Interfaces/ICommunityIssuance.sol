// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface ICommunityIssuance {
  // --- Events ---

  event PREONTokenAddressSet(address _PREONTokenAddress);
  event StabilityPoolAddressSet(address _stabilityPoolAddress);
  event TotalPREONIssuedUpdated(uint256 _totalPREONIssued);

  // --- Functions ---

  function setAddresses(
    address _preonTokenAddress,
    address _stabilityPoolAddress
  ) external;

  function issuePREON() external returns (uint256);

  function sendPREON(address _account, uint256 _PREONamount) external;
}
