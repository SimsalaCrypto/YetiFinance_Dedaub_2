// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

import "./SafeMath.sol";

library PreonMath {
  using SafeMath for uint256;

  uint256 internal constant DECIMAL_PRECISION = 1e18;
  uint256 internal constant HALF_DECIMAL_PRECISION = 5e17;

  function _min(uint256 _a, uint256 _b) internal pure returns (uint256) {
    return (_a < _b) ? _a : _b;
  }

  function _max(uint256 _a, uint256 _b) internal pure returns (uint256) {
    return (_a >= _b) ? _a : _b;
  }

  /**
   * @notice Multiply two decimal numbers
     * @dev Use normal rounding rules:
        -round product up if 19'th mantissa digit >= 5
        -round product down if 19'th mantissa digit < 5
     */
  function decMul(uint256 x, uint256 y)
    internal
    pure
    returns (uint256 decProd)
  {
    uint256 prod_xy = x.mul(y);

    decProd = prod_xy.add(HALF_DECIMAL_PRECISION).div(DECIMAL_PRECISION);
  }

  /*
   * _decPow: Exponentiation function for 18-digit decimal base, and integer exponent n.
   *
   * Uses the efficient "exponentiation by squaring" algorithm. O(log(n)) complexity.
   *
   * Called by two functions that represent time in units of minutes:
   * 1) TroveManager._calcDecayedBaseRate
   * 2) CommunityIssuance._getCumulativeIssuanceFraction
   *
   * The exponent is capped to avoid reverting due to overflow. The cap 525600000 equals
   * "minutes in 1000 years": 60 * 24 * 365 * 1000
   *
   * If a period of > 1000 years is ever used as an exponent in either of the above functions, the result will be
   * negligibly different from just passing the cap, since:
   *
   * In function 1), the decayed base rate will be 0 for 1000 years or > 1000 years
   * In function 2), the difference in tokens issued at 1000 years and any time > 1000 years, will be negligible
   */
  function _decPow(uint256 _base, uint256 _minutes)
    internal
    pure
    returns (uint256)
  {
    if (_minutes > 5256e5) {
      _minutes = 5256e5;
    } // cap to avoid overflow

    if (_minutes == 0) {
      return DECIMAL_PRECISION;
    }

    uint256 y = DECIMAL_PRECISION;
    uint256 x = _base;
    uint256 n = _minutes;

    // Exponentiation-by-squaring
    while (n > 1) {
      if (n % 2 == 0) {
        x = decMul(x, x);
        n = n.div(2);
      } else {
        // if (n % 2 != 0)
        y = decMul(x, y);
        x = decMul(x, x);
        n = (n.sub(1)).div(2);
      }
    }

    return decMul(x, y);
  }

  function _getAbsoluteDifference(uint256 _a, uint256 _b)
    internal
    pure
    returns (uint256)
  {
    return (_a >= _b) ? _a.sub(_b) : _b.sub(_a);
  }
}
