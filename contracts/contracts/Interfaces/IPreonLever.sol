// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

/**
 * @notice IPreonLever is an interface intended for use in the Preon Finance Lever Up feature. It routes from
 * PUSD to some various token out which has to be compatible with the underlying router in the route
 * function, and unRoutes backwards to get PUSD out. Sends to the active pool address by intention and
 * route is called in functions openTroveLeverUp and addCollLeverUp in BorrowerOperations.sol. unRoute
 * is called in functions closeTroveUnleverUp and withdrawCollUnleverUp in BorrowerOperations.sol.
 */

interface IPreonLever {
  // Goes from some token (PUSD likely) and gives a certain amount of token out.
  // Auto transfers to active pool from call in BorrowerOperations.sol, aka _toUser is always activePool
  // Goes from _startingTokenAddress to _endingTokenAddress, given it has tokens of _amount, and gets _minSwapAmount out _endingTokenAddress
  // Sends it to _toUser
  function route(
    address _toUser,
    address _startingTokenAddress,
    address _endingTokenAddress,
    uint256 _amount,
    uint256 _minSwapAmount
  ) external returns (uint256 amountOut);

  // Takes the address of the token required in, and gives a certain amount of any token (PUSD likely) out
  // User first withdraws that collateral from the active pool, then performs this swap. Unwraps tokens
  // for the user in that case.
  // Goes from _startingTokenAddress to _endingTokenAddress, given it has tokens of _amount, of _amount, and gets _minSwapAmount out _endingTokenAddress.
  // Sends it to _toUser
  // Use case: Takes token from trove debt which has been transfered to the owner and then swaps it for PUSD, intended to repay debt.
  function unRoute(
    address _toUser,
    address _startingTokenAddress,
    address _endingTokenAddress,
    uint256 _amount,
    uint256 _minSwapAmount
  ) external returns (uint256 amountOut);
}
