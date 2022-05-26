// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../PREON/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
  function obtainPREON(uint256 _amount) external {
    preonToken.transfer(msg.sender, _amount);
  }

  function getCumulativeIssuanceFraction() external view returns (uint256) {
    return _getCumulativeIssuanceFraction();
  }

  function unprotectedIssuePREON() external returns (uint256) {
    // No checks on caller address

    uint256 latestTotalPREONIssued = PREONSupplyCap
      .mul(_getCumulativeIssuanceFraction())
      .div(DECIMAL_PRECISION);
    uint256 issuance = latestTotalPREONIssued.sub(totalPREONIssued);

    totalPREONIssued = latestTotalPREONIssued;
    return issuance;
  }
}
