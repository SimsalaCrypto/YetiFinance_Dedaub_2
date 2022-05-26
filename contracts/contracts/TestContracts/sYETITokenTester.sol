//SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../PREON/sPREONToken.sol";

contract sPREONTokenTester is sPREONToken {
  function getUserInfo(address user)
    public
    view
    returns (uint128 balance, uint128 lockedUntil)
  {
    return (users[user].balance, users[user].lockedUntil);
  }
}
