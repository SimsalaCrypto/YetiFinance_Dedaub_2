// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../PREON/PREONToken.sol";

contract PREONTokenTester is PREONToken {
  constructor(
    address _sPREONAddress,
    address _treasuryAddress,
    address _teamAddress
  ) public PREONToken(_sPREONAddress, _treasuryAddress, _teamAddress) {}

  function unprotectedMint(address account, uint256 amount) external {
    // No check for the caller here

    _mint(account, amount);
  }

  function unprotectedSendToSPREON(address _sender, uint256 _amount) external {
    _transfer(_sender, sPREONAddress, _amount);
  }

  function callInternalApprove(
    address owner,
    address spender,
    uint256 amount
  ) external returns (bool) {
    _approve(owner, spender, amount);
  }

  function callInternalTransfer(
    address sender,
    address recipient,
    uint256 amount
  ) external returns (bool) {
    _transfer(sender, recipient, amount);
  }

  function getChainId() external pure returns (uint256 chainID) {
    //return _chainID(); // it’s private
    assembly {
      chainID := chainid()
    }
  }
}
