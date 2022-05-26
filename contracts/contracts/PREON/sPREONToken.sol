//SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./BoringCrypto/BoringMath.sol";
import "./BoringCrypto/BoringERC20.sol";
import "./BoringCrypto/Domain.sol";
import "./BoringCrypto/ERC20.sol";
import "./BoringCrypto/IERC20.sol";
import "./BoringCrypto/BoringOwnable.sol";
import "./IsPREONRouter.sol";

interface IPREONToken is IERC20 {
  function sendToSPREON(address _sender, uint256 _amount) external;

  function transfer(address recipient, uint256 amount) external returns (bool);
}

// Staking in sSpell inspired by Chef Nomi's SushiBar - MIT license (originally WTFPL)
// modified by BoringCrypto for DictatorDAO

// Use effective preonbalance, which updates on rebase. Rebase occurs every 8
// Each rebase increases the effective preonbalance by a certain amount of the total value
// of the contract, which is equal to the pusd balance + the last price which the buyback
// was executed at, multiplied by the PREON balance. Then, a portion of the value, say 1/200
// of the total value of the contract is added to the effective preonbalance. Also updated on
// mint and withdraw, because that is actual value that is added to the contract.

contract sPREONToken is IERC20, Domain, BoringOwnable {
  using BoringMath for uint256;
  using BoringMath128 for uint128;
  using BoringERC20 for IERC20;

  string public constant symbol = "sPREON";
  string public constant name = "Staked PREON Tokens";
  uint8 public constant decimals = 18;
  uint256 public override totalSupply;
  uint256 private constant LOCK_TIME = 69 hours;
  uint256 public effectivePreonTokenBalance;
  uint256 public lastBuybackTime;
  uint256 public lastBuybackPrice;
  uint256 public lastRebaseTime;
  uint256 public transferRatio; // 100% = 1e18. Amount to transfer over each rebase.
  IPREONToken public preonToken;
  IERC20 public pusdToken;
  bool private addressesSet;

  // Internal mapping to keep track of valid routers. Find the one with least slippage off chain
  // and do that one.
  mapping(address => bool) public validRouters;

  struct User {
    uint128 balance;
    uint128 lockedUntil;
  }

  /// @notice owner > balance mapping.
  mapping(address => User) public users;
  /// @notice owner > spender > allowance mapping.
  mapping(address => mapping(address => uint256)) public override allowance;
  /// @notice owner > nonce mapping. Used in `permit`.
  mapping(address => uint256) public nonces;

  event Transfer(address indexed _from, address indexed _to, uint256 _value);
  event Approval(
    address indexed _owner,
    address indexed _spender,
    uint256 _value
  );
  event BuyBackExecuted(uint256 PUSDToSell, uint256 amounts0, uint256 amounts1);
  event Rebase(uint256 additionalPreonTokenBalance);

  function balanceOf(address user) public view override returns (uint256) {
    return users[user].balance;
  }

  function setAddresses(IPREONToken _preon, IERC20 _pusd) external onlyOwner {
    require(!addressesSet, "addresses already set");
    preonToken = _preon;
    pusdToken = _pusd;
    addressesSet = true;
  }

  function _transfer(
    address from,
    address to,
    uint256 shares
  ) internal {
    User memory fromUser = users[from];
    require(block.timestamp >= fromUser.lockedUntil, "Locked");
    if (shares != 0) {
      require(fromUser.balance >= shares, "Low balance");
      if (from != to) {
        require(to != address(0), "Zero address"); // Moved down so other failed calls safe some gas
        User memory toUser = users[to];
        uint128 shares128 = shares.to128();
        users[from].balance = fromUser.balance - shares128; // Underflow is checked
        users[to].balance = toUser.balance + shares128; // Can't overflow because totalSupply would be greater than 2^128-1;
      }
    }
    emit Transfer(from, to, shares);
  }

  function _useAllowance(address from, uint256 shares) internal {
    if (msg.sender == from) {
      return;
    }
    uint256 spenderAllowance = allowance[from][msg.sender];
    // If allowance is infinite, don't decrease it to save on gas (breaks with EIP-20).
    if (spenderAllowance != type(uint256).max) {
      require(spenderAllowance >= shares, "Low allowance");
      uint256 newAllowance = spenderAllowance - shares;
      allowance[from][msg.sender] = newAllowance; // Underflow is checked
      emit Approval(from, msg.sender, newAllowance);
    }
  }

  /// @notice Transfers `shares` tokens from `msg.sender` to `to`.
  /// @param to The address to move the tokens.
  /// @param shares of the tokens to move.
  /// @return (bool) Returns True if succeeded.
  function transfer(address to, uint256 shares) public returns (bool) {
    _transfer(msg.sender, to, shares);
    return true;
  }

  /// @notice Transfers `shares` tokens from `from` to `to`. Caller needs approval for `from`.
  /// @param from Address to draw tokens from.
  /// @param to The address to move the tokens.
  /// @param shares The token shares to move.
  /// @return (bool) Returns True if succeeded.
  function transferFrom(
    address from,
    address to,
    uint256 shares
  ) public returns (bool) {
    _useAllowance(from, shares);
    _transfer(from, to, shares);
    return true;
  }

  /// @notice Approves `amount` from sender to be spend by `spender`.
  /// @param spender Address of the party that can draw from msg.sender's account.
  /// @param amount The maximum collective amount that `spender` can draw.
  /// @return (bool) Returns True if approved.
  function approve(address spender, uint256 amount)
    public
    override
    returns (bool)
  {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  /// @notice Approves `amount` from sender to be spend by `spender`.
  /// @param spender Address of the party that can draw from msg.sender's account.
  /// @param amount The maximum collective amount that `spender` can draw.
  /// @return (bool) Returns True if approved.
  function increaseAllowance(address spender, uint256 amount)
    public
    override
    returns (bool)
  {
    allowance[msg.sender][spender] = allowance[msg.sender][spender].add(amount);
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  // solhint-disable-next-line func-name-mixedcase
  function DOMAIN_SEPARATOR() external view returns (bytes32) {
    return _domainSeparator();
  }

  // keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
  bytes32 private constant PERMIT_SIGNATURE_HASH =
    0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;

  /// @notice Approves `value` from `owner_` to be spend by `spender`.
  /// @param owner_ Address of the owner.
  /// @param spender The address of the spender that gets approved to draw from `owner_`.
  /// @param value The maximum collective amount that `spender` can draw.
  /// @param deadline This permit must be redeemed before this deadline (UTC timestamp in seconds).
  function permit(
    address owner_,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external override {
    require(owner_ != address(0), "Zero owner");
    require(block.timestamp < deadline, "Expired");
    require(
      ecrecover(
        _getDigest(
          keccak256(
            abi.encode(
              PERMIT_SIGNATURE_HASH,
              owner_,
              spender,
              value,
              nonces[owner_]++,
              deadline
            )
          )
        ),
        v,
        r,
        s
      ) == owner_,
      "Invalid Sig"
    );
    allowance[owner_][spender] = value;
    emit Approval(owner_, spender, value);
  }

  /// math is ok, because amount, totalSupply and shares is always 0 <= amount <= 100.000.000 * 10^18
  /// theoretically you can grow the amount/share ratio, but it's not practical and useless
  function mint(uint256 amount) public returns (bool) {
    User memory user = users[msg.sender];

    uint256 shares = totalSupply == 0
      ? amount
      : (amount * totalSupply) / effectivePreonTokenBalance;
    user.balance += shares.to128();
    user.lockedUntil = (block.timestamp + LOCK_TIME).to128();
    users[msg.sender] = user;
    totalSupply += shares;

    preonToken.sendToSPREON(msg.sender, amount);
    effectivePreonTokenBalance = effectivePreonTokenBalance.add(amount);

    emit Transfer(address(0), msg.sender, shares);
    return true;
  }

  function _burn(
    address from,
    address to,
    uint256 shares
  ) internal {
    require(to != address(0), "Zero address");
    User memory user = users[from];
    require(block.timestamp >= user.lockedUntil, "Locked");
    uint256 amount = (shares * effectivePreonTokenBalance) / totalSupply;
    users[from].balance = user.balance.sub(shares.to128()); // Must check underflow
    totalSupply -= shares;

    preonToken.transfer(to, amount);
    effectivePreonTokenBalance = effectivePreonTokenBalance.sub(amount);

    emit Transfer(from, address(0), shares);
  }

  function burn(address to, uint256 shares) public returns (bool) {
    _burn(msg.sender, to, shares);
    return true;
  }

  function burnFrom(
    address from,
    address to,
    uint256 shares
  ) public returns (bool) {
    _useAllowance(from, shares);
    _burn(from, to, shares);
    return true;
  }

  /**
   * Buyback function called by owner of function. Keeps track of the
   */
  function buyBack(
    address _routerAddress,
    uint256 _PUSDToSell,
    uint256 _PREONOutMin
  ) external onlyOwner {
    require(_PUSDToSell != 0, "Zero amount");
    require(
      pusdToken.balanceOf(address(this)) >= _PUSDToSell,
      "Not enough PUSD in contract"
    );
    _buyBack(_routerAddress, _PUSDToSell, _PREONOutMin);
  }

  /**
   * Public function for doing buybacks, eligible every 169 hours. This is so that there are some guaranteed rewards to be distributed if the team multisig is lost.
   * Has a max amount of PUSD to sell at 5% of the PUSD in the contract, which should be enough to cover the amount. Uses the default router which has a time lock
   * in order to activate.
   * No PUSDToSell param since this just does 5% of the PUSD in the contract.
   */
  function publicBuyBack(address _routerAddress) external {
    uint256 PUSDBalance = pusdToken.balanceOf(address(this));
    require(PUSDBalance != 0, "No PUSD in contract");
    require(
      lastBuybackTime + 169 hours < block.timestamp,
      "Can only publicly buy back every 169 hours"
    );
    // Get 5% of the PUSD in the contract
    // Always enough PUSD in the contract to cover the 5% of the PUSD in the contract
    uint256 PUSDToSell = div(PUSDBalance.mul(5), 100);
    _buyBack(_routerAddress, PUSDToSell, 0);
  }

  // Internal function calls the router function for buyback and emits event with amount of PREON bought and PUSD spent.
  function _buyBack(
    address _routerAddress,
    uint256 _PUSDToSell,
    uint256 _PREONOutMin
  ) internal {
    // Checks internal mapping to see if router is valid
    require(validRouters[_routerAddress] == true, "Invalid router passed in");
    require(pusdToken.approve(_routerAddress, 0));
    require(pusdToken.increaseAllowance(_routerAddress, _PUSDToSell));
    lastBuybackTime = block.timestamp;
    uint256[] memory amounts = IsPREONRouter(_routerAddress).swap(
      _PUSDToSell,
      _PREONOutMin,
      address(this)
    );
    // amounts[0] is the amount of PUSD that was sold, and amounts[1] is the amount of PREON that was gained in return. So the price is amounts[0] / amounts[1]
    lastBuybackPrice = div(amounts[0].mul(1e18), amounts[1]);
    emit BuyBackExecuted(_PUSDToSell, amounts[0], amounts[1]);
  }

  // Rebase function for adding new value to the sPREON - PREON ratio.
  function rebase() external {
    require(
      block.timestamp >= lastRebaseTime + 8 hours,
      "Can only rebase every 8 hours"
    );
    // Use last buyback price to transfer some of the actual PREON Tokens that this contract owns
    // to the effective preon token balance. Transfer a portion of the value over to the effective balance

    // raw balance of the contract
    uint256 preonTokenBalance = preonToken.balanceOf(address(this));
    // amount of PREON free / available to give out
    uint256 adjustedPreonTokenBalance = preonTokenBalance.sub(
      effectivePreonTokenBalance
    );
    // in PREON, amount that should be eligible to give out.
    uint256 valueOfContract = _getValueOfContract(adjustedPreonTokenBalance);
    // in PREON, amount to rebase
    uint256 amountPreonToRebase = div(valueOfContract.mul(transferRatio), 1e18);
    // Ensure that the amount of PREON tokens effectively added is >= the amount we have repurchased.
    // Amount available = adjustdPreonTokenBalance, amount to distribute is amountPreonToRebase
    if (amountPreonToRebase > adjustedPreonTokenBalance) {
      amountPreonToRebase = adjustedPreonTokenBalance;
    }
    // rebase amount joins the effective supply.
    effectivePreonTokenBalance = effectivePreonTokenBalance.add(
      amountPreonToRebase
    );
    // update rebase time
    lastRebaseTime = block.timestamp;
    emit Rebase(amountPreonToRebase);
  }

  // Sums PUSD balance + old price.
  // Should take add the PUSD balance / last buyback price to get value of the PUSD in PREON
  // added to the PREON balance of the contract. Essentially the amount it is eligible to give out.
  function _getValueOfContract(uint256 _adjustedPreonTokenBalance)
    internal
    view
    returns (uint256)
  {
    uint256 pusdTokenBalance = pusdToken.balanceOf(address(this));
    return
      div(pusdTokenBalance.mul(1e18), lastBuybackPrice).add(
        _adjustedPreonTokenBalance
      );
  }

  // Sets new transfer ratio for rebasing
  function setTransferRatio(uint256 newTransferRatio) external onlyOwner {
    require(newTransferRatio != 0, "Zero transfer ratio");
    require(newTransferRatio <= 1e18, "Transfer ratio too high");
    transferRatio = newTransferRatio;
  }

  // TODO - add time delay for setting new valid router.
  function addValidRouter(address _routerAddress) external onlyOwner {
    require(_routerAddress != address(0), "Invalid router address");
    validRouters[_routerAddress] = true;
  }

  // TODO - add time delay for invalidating router.
  function removeValidRouter(address _routerAddress) external onlyOwner {
    validRouters[_routerAddress] = false;
  }

  // Safe divide
  function div(uint256 a, uint256 b) internal pure returns (uint256 c) {
    require(b != 0, "BoringMath: Div By 0");
    return a / b;
  }
}
