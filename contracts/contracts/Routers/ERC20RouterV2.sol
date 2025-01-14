// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Interfaces/IPreonRouter.sol";
import "../Interfaces/IERC20.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../PUSDToken.sol";

// ERC20 router contract to be used for routing PUSD -> ERC20 and then wrapping.
// simple router using TJ router.
contract ERC20RouterV2 is Ownable, IPreonRouter {
  using SafeMath for uint256;

  address internal activePoolAddress;
  address internal traderJoeRouter;
  address internal pusdTokenAddress;
  string public name;
  event RouteSet(address, address, address[]);

  // Usage: path = routes[fromToken][toToken]
  mapping(address => mapping(address => address[])) public routes;

  // Usage: type = nodeType[path[i]]
  // 1 = traderJoe
  // 2 = pusdMetapool
  // 3 = aToken
  // 4 = qToken
  //
  mapping(address => uint256) public nodeTypes;

  mapping(address => int128) public pusdMetapoolIndex;

  constructor(
    string memory _name,
    address _activePoolAddress,
    address _traderJoeRouter,
    address _pusdTokenAddress,
    address _USDC,
    address _USDT,
    address _DAI
  ) public {
    name = _name;
    activePoolAddress = _activePoolAddress;
    traderJoeRouter = _traderJoeRouter;
    pusdTokenAddress = _pusdTokenAddress;
    pusdMetapoolIndex[_pusdTokenAddress] = 0;
    pusdMetapoolIndex[_USDC] = 1;
    pusdMetapoolIndex[_USDT] = 2;
    pusdMetapoolIndex[_DAI] = 3;
    pusdMetapoolIndex[_pusdTokenAddress] = 4;
  }

  function setApprovals(
    address _token,
    address _who,
    uint256 _amount
  ) external onlyOwner {
    IERC20(_token).approve(_who, _amount);
  }

  function setRoute(
    address _fromToken,
    address _toToken,
    address[] calldata _path
  ) external onlyOwner {
    routes[_fromToken][_toToken] = _path;
    emit RouteSet(_fromToken, _toToken, _path);
  }

  function swapJoePair(address _pair, address _tokenIn)
    internal
    returns (address)
  {
    uint256 amountIn = IERC20(_tokenIn).balanceOf(address(this));
    IERC20(_tokenIn).transfer(_pair, amountIn);
    address _tokenOut;
    uint256 amount0Out;
    uint256 amount1Out;
    if (IJoePair(_pair).token0() == _tokenIn) {
      _tokenOut = IJoePair(_pair).token1();
    } else {
      _tokenOut = IJoePair(_pair).token0();
    }
    (uint256 reserve0, uint256 reserve1, ) = IJoePair(_pair).getReserves();
    if (_tokenIn < _tokenOut) {
      // TokenIn=token0
      (amount0Out, amount1Out) = (
        uint256(0),
        getAmountOut(amountIn, reserve0, reserve1)
      );
    } else {
      // TokenIn=token1
      (amount0Out, amount1Out) = (
        getAmountOut(amountIn, reserve1, reserve0),
        uint256(0)
      );
    }
    IJoePair(_pair).swap(amount0Out, amount1Out, address(this), new bytes(0));
    return _tokenOut;
  }

  // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
  function getAmountOut(
    uint256 amountIn,
    uint256 reserveIn,
    uint256 reserveOut
  ) internal pure returns (uint256 amountOut) {
    require(amountIn > 0, "UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT");
    require(
      reserveIn > 0 && reserveOut > 0,
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY"
    );
    uint256 amountInWithFee = amountIn.mul(997);
    uint256 numerator = amountInWithFee.mul(reserveOut);
    uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
    amountOut = numerator / denominator;
  }

  // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
  function getAmountIn(
    uint256 amountOut,
    uint256 reserveIn,
    uint256 reserveOut
  ) internal pure returns (uint256 amountIn) {
    require(amountOut > 0, "UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT");
    require(
      reserveIn > 0 && reserveOut > 0,
      "UniswapV2Library: INSUFFICIENT_LIQUIDITY"
    );
    uint256 numerator = reserveIn.mul(amountOut).mul(1000);
    uint256 denominator = reserveOut.sub(amountOut).mul(997);
    amountIn = (numerator / denominator).add(1);
  }

  function swapPUSDMetapool(
    address _token,
    address _metapool,
    bool PUSDIn
  ) internal returns (address) {
    uint256 amountIn = IERC20(_token).balanceOf(address(this));

    if (PUSDIn) {
      // Swap PUSD for _token
      IMeta(_metapool).exchange_underlying(
        0,
        pusdMetapoolIndex[_token],
        amountIn,
        0
      );
      return _token;
    } else {
      // Swap _token for PUSD
      IMeta(_metapool).exchange_underlying(
        pusdMetapoolIndex[_token],
        0,
        amountIn,
        0
      );
      return pusdTokenAddress;
    }
  }

  // Takes the address of the token in, and gives a certain amount of token out.
  // Auto transfers to active pool.
  function route(
    address _fromUser,
    address _startingTokenAddress,
    address _endingTokenAddress,
    uint256 _amount,
    uint256 _minSwapAmount
  ) public override returns (uint256) {
    require(
      _startingTokenAddress == pusdTokenAddress,
      "Cannot route from a token other than PUSD"
    );
    address[] memory path = routes[_startingTokenAddress][_endingTokenAddress];
    require(path.length > 0, "No route found");
    IERC20(pusdTokenAddress).transferFrom(_fromUser, address(this), _amount);
    for (uint256 i; i < path.length; i++) {
      if (nodeTypes[path[i]] == 1) {
        // Is traderjoe
        _startingTokenAddress = swapJoePair(path[i], _startingTokenAddress);
      } else if (nodeTypes[path[i]] == 2) {
        // Is pusd metapool
        _startingTokenAddress = swapPUSDMetapool(
          _startingTokenAddress,
          path[i],
          true
        );
      }
    }
    uint256 outAmount = IERC20(_endingTokenAddress).balanceOf(address(this));
    IERC20(_endingTokenAddress).transfer(activePoolAddress, outAmount);
    require(
      outAmount >= _minSwapAmount,
      "Did not receive enough tokens to account for slippage"
    );
    return outAmount;
  }

  function unRoute(
    address _fromUser,
    address _startingTokenAddress,
    address _endingTokenAddress,
    uint256 _amount,
    uint256 _minSwapAmount
  ) external override returns (uint256) {
    require(
      _endingTokenAddress == pusdTokenAddress,
      "Cannot unroute from a token other than PUSD"
    );
    address[] memory path = new address[](2);
    path[0] = _startingTokenAddress;
    path[1] = pusdTokenAddress;
    IERC20(_startingTokenAddress).transferFrom(
      _fromUser,
      address(this),
      _amount
    );
    IERC20(_startingTokenAddress).approve(traderJoeRouter, _amount);
    uint256[] memory amounts = IRouter(traderJoeRouter)
      .swapExactTokensForTokens(_amount, 1, path, _fromUser, block.timestamp);
    require(
      amounts[1] >= _minSwapAmount,
      "Did not receive enough tokens to account for slippage"
    );

    return amounts[1];
  }

  function suicide() external onlyOwner {
    // Break contract in case of vulnerability in one of the dexes it uses
    selfdestruct(payable(address(msg.sender)));
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

interface IMeta {
  function exchange(
    int128 i,
    int128 j,
    uint256 _dx,
    uint256 _min_dy
  ) external returns (uint256);

  function exchange_underlying(
    int128 i,
    int128 j,
    uint256 _dx,
    uint256 _min_dy
  ) external returns (uint256);
}

interface IJoePair {
  function token0() external view returns (address);

  function token1() external view returns (address);

  function swap(
    uint256 _amount0In,
    uint256 _amount1Out,
    address _to,
    bytes memory _data
  ) external;

  function getReserves()
    external
    view
    returns (
      uint112 reserve0,
      uint112 reserve1,
      uint32 blockTimestampLast
    );
}
