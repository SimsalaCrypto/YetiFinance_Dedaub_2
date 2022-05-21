// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../YETI/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
  function obtainYETI(uint256 _amount) external {
    yetiToken.transfer(msg.sender, _amount);
  }

  function getCumulativeIssuanceFraction() external view returns (uint256) {
    return _getCumulativeIssuanceFraction();
  }

  function unprotectedIssueYETI() external returns (uint256) {
    // No checks on caller address

    uint256 latestTotalYETIIssued = YETISupplyCap
      .mul(_getCumulativeIssuanceFraction())
      .div(DECIMAL_PRECISION);
    uint256 issuance = latestTotalYETIIssued.sub(totalYETIIssued);

    totalYETIIssued = latestTotalYETIIssued;
    return issuance;
  }
}
