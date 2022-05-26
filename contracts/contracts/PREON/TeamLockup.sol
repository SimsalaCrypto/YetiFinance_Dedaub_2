// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "../Interfaces/IERC20.sol";
import "../Dependencies/SafeMath.sol";

contract TeamLockup {
  using SafeMath for uint256;

  address multisig;
  IERC20 PREON;

  uint256 immutable vestingStart;
  uint256 immutable vestingLength; // number of PREON that are claimable every second after vesting starts
  uint256 immutable totalVest;
  uint256 totalClaimed;

  modifier onlyMultisig() {
    require(
      msg.sender == multisig,
      "Only the multisig can call this function."
    );
    _;
  }

  constructor(
    address _multisig,
    IERC20 _PREON,
    uint256 _start,
    uint256 _length,
    uint256 _total
  ) public {
    multisig = _multisig;
    PREON = _PREON;

    vestingStart = _start;
    vestingLength = _length;
    totalVest = _total;
  }

  function claimPreon(uint256 _amount) external onlyMultisig {
    require(block.timestamp > vestingStart, "Vesting hasn't started yet");
    require(totalClaimed < totalVest, "All PREON has been vested");

    uint256 timePastVesting = block.timestamp.sub(vestingStart);

    uint256 available = _min(
      totalVest,
      (totalVest.mul(timePastVesting)).div(vestingLength)
    );
    if (available >= totalClaimed.add(_amount)) {
      // there are _amount PREON tokens that are claimable
      totalClaimed = totalClaimed.add(_amount);
      require(PREON.transfer(multisig, _amount));
    }
  }

  function updateMultisig(address _newMultisig) external onlyMultisig {
    multisig = _newMultisig;
  }

  function _min(uint256 a, uint256 b) internal pure returns (uint256) {
    if (a < b) {
      return a;
    }
    return b;
  }
}
