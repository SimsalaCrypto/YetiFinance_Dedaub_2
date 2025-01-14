// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./IERC20.sol";
import "./IERC2612.sol";

interface IPREONToken is IERC20, IERC2612 {
  function sendToSPREON(address _sender, uint256 _amount) external;

  function getDeploymentStartTime() external view returns (uint256);
}
