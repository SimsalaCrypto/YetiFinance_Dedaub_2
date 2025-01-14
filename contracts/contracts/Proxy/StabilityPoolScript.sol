// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Interfaces/IStabilityPool.sol";

contract StabilityPoolScript is CheckContract {
  bytes32 public constant NAME = "StabilityPoolScript";

  IStabilityPool immutable stabilityPool;

  constructor(IStabilityPool _stabilityPool) public {
    checkContract(address(_stabilityPool));
    stabilityPool = _stabilityPool;
  }

  function provideToSP(uint256 _amount, address _frontEndTag) external {
    stabilityPool.provideToSP(_amount, _frontEndTag);
  }

  function withdrawFromSP(uint256 _amount) external {
    stabilityPool.withdrawFromSP(_amount);
  }
}
