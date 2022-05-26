pragma solidity 0.6.12;

import "../IsPREONRouter.sol";
import "../BoringCrypto/BoringOwnable.sol";
import "../BoringCrypto/IERC20.sol";

// Dummy contract for swapping just in one swap from PUSD to PREON
// in one univ2 pool with the path being just that. Testing purposes only.

contract dummyUniV2Router is IsPREONRouter, BoringOwnable {
  IRouter JOERouter;
  address JOERouterAddress;
  address[] path;
  IERC20 pusdToken;
  IERC20 preonToken;

  function setup(
    address _JOERouter,
    address _pusdToken,
    address _preonToken
  ) external onlyOwner {
    JOERouterAddress = _JOERouter;
    JOERouter = IRouter(_JOERouter);
    path = new address[](2);
    pusdToken = IERC20(_pusdToken);
    preonToken = IERC20(_preonToken);
    path[0] = _pusdToken;
    path[1] = _preonToken;
    // Renounce ownership
    transferOwnership(address(0), true, true);
  }

  function swap(
    uint256 _PUSDAmount,
    uint256 _minPREONOut,
    address _to
  ) external override returns (uint256[] memory amounts) {
    address cachedJOERouterAddress = JOERouterAddress;
    IERC20 cachedPUSDToken = pusdToken;
    require(cachedPUSDToken.approve(cachedJOERouterAddress, 0));
    require(
      cachedPUSDToken.increaseAllowance(cachedJOERouterAddress, _PUSDAmount)
    );
    amounts = JOERouter.swapExactTokensForTokens(
      _PUSDAmount,
      _minPREONOut,
      path,
      _to,
      block.timestamp
    );
  }
}

// Router for Uniswap V2, performs PUSD -> PREON swaps
interface IRouter {
  function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
  ) external returns (uint256[] memory amounts);
}
