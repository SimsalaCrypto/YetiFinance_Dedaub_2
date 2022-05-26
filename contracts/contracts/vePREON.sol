// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "./Interfaces/IERC20.sol";
import "./Interfaces/IRewarder.sol";
import "./Interfaces/IEmitter.sol";
import "./Interfaces/IvePREON.sol";

contract vePREON is IvePREON {
  uint256 constant _1e18 = 1e18;
  uint256 constant _totalPreonSupply = 500e24;

  IERC20 public preonToken;
  address preonController;

  // Global Stats:
  uint256 public totalPreon;
  uint256 public accumulationRate; // vePREON accumulated per second per staked PREON

  // With an accumulation of 0.015 vePREON per PREON per hour, accumulationRate would be 25e13 vePREON per PREON per second.
  // 25e13 * (entire PREON supply = 500,000,000e18) * 86400 seconds per day * 4 * 365 = 1.5768e49
  // Max uint = 1.1579e77 so the vePREON max is not close to that. To get vePREON balance actually it is / 1e36.

  bool isSetup;

  /* UserInfo:
        -totalPreon is the total amount of PREON that the user has staked
        -preonStakes[x] is the amount of PREON staked on rewarder with address x
        -lastUpdate is when all the variables were last updated for the user.
         This is the last time the user called update()
        -lastTotalVePreon is the user's total vePREON balance at the last update
    */
  struct UserInfo {
    uint256 totalPreon;
    mapping(address => uint256) preonStakes;
    uint256 lastUpdate;
    uint256 lastTotalVePreon;
  }

  struct RewarderUpdate {
    address rewarder;
    uint256 amount;
    bool isIncrease;
  }

  mapping(address => bool) isWhitelistedContract;
  mapping(address => UserInfo) users; // info on each user's staked PREON

  // ===== NEW VARIABLES =====

  IEmitter public emitter;

  // rewarders that need to be updated when vePREON changes
  address[] public updatableRewarders;
  mapping(address => bool) isUpdatableRewarder;
  address contractController; // controls adding and removing updatable rewarders

  event UpdatedWhitelistedContracts(
    address _contractAddress,
    bool _isWhitelisted
  );
  event UserUpdate(address _user, bool _isStakeIncrease, uint256 _stakeAmount);
  event RewarderStatusUpdate(address _rewarder, bool _updatable);

  modifier onlyPreonController() {
    require(
      msg.sender == address(preonController),
      "vePREON: Caller is not PreonController"
    );
    _;
  }

  function setup(
    IERC20 _preon,
    address _preonController,
    uint256 _accumulationRate
  ) external {
    require(!isSetup, "vePREON: already setup");
    preonToken = _preon;
    preonController = _preonController;
    accumulationRate = _accumulationRate;
    isSetup = true;
  }

  // ============= OnlyController External Mutable Functions =============

  function updateWhitelistedCallers(
    address _contractAddress,
    bool _isWhitelisted
  ) external onlyPreonController {
    isWhitelistedContract[_contractAddress] = _isWhitelisted;
    emit UpdatedWhitelistedContracts(_contractAddress, _isWhitelisted);
  }

  // ============= External Mutable Functions  =============

  /** Can use update() to:
   * stake or unstake more PREON overall and/or
   * reallocate current PREON to be staked on different rewarders
   */
  function update(RewarderUpdate[] memory _preonAdjustments) external {
    _requireValidCaller();

    emitter.updateUserRewards(msg.sender);

    UserInfo storage userInfo = users[msg.sender];

    (bool _isStakeIncrease, uint256 _stakeAmount) = _getAmountChange(
      _preonAdjustments
    );

    // update user's lastTotalVePreon
    // accounts for penalty if _stake is false (net un-stake)
    _accumulate(msg.sender, _isStakeIncrease);

    // update Preon stakes on each rewarder
    _allocate(msg.sender, _preonAdjustments);

    // update global totalPreon, totalPreon for user, and pull in or send back PREON
    // based on if user is adding to or removing from their stake
    _handleStaking(userInfo, _isStakeIncrease, _stakeAmount);

    userInfo.lastUpdate = block.timestamp;

    // notify all the updatable rewarders about vePREON changes
    _notifyRewarders(msg.sender, updatableRewarders);

    emit UserUpdate(msg.sender, _isStakeIncrease, _stakeAmount);
  }

  // ============= Public/External View Functions  =============

  // returns how much vePREON a user currently has accumulated on a rewarder
  function getUserPreonOnRewarder(address _user, address _rewarder)
    external
    view
    override
    returns (uint256)
  {
    return users[_user].preonStakes[_rewarder];
  }

  // returns how much vePREON a user currently has accumulated on a rewarder
  function getVePreonOnRewarder(address _user, address _rewarder)
    external
    view
    override
    returns (uint256)
  {
    UserInfo storage userInfo = users[_user];
    if (userInfo.totalPreon == 0) {
      return 0;
    }
    uint256 currentVePreon = getTotalVePreon(_user);
    return
      (currentVePreon * userInfo.preonStakes[_rewarder]) / userInfo.totalPreon;
  }

  // get user's total accumulated vePREON balance (across all rewarders)
  function getTotalVePreon(address _user) public view returns (uint256) {
    UserInfo storage userInfo = users[_user];
    uint256 dt = block.timestamp - userInfo.lastUpdate;
    uint256 veGrowth = userInfo.totalPreon * accumulationRate * dt;
    return userInfo.lastTotalVePreon + veGrowth;
  }

  // ============= Internal Mutable Functions  =============

  /**
   * accumulate/update user's lastTotalVePreon balance
   */
  function _accumulate(address _user, bool _isStakeIncrease) internal {
    UserInfo storage userInfo = users[_user];

    if (_isStakeIncrease) {
      // calculate total vePREON gained since last update time
      // and update lastTotalvePREON accordingly
      uint256 dt = block.timestamp - userInfo.lastUpdate;
      uint256 veGrowth = userInfo.totalPreon * accumulationRate * dt;
      userInfo.lastTotalVePreon = userInfo.lastTotalVePreon + veGrowth;
    } else {
      // lose all accumulated vePREON if unstaking
      userInfo.lastTotalVePreon = 0;
    }
  }

  /**
   * allocate Preon to rewarders
   */
  function _allocate(address _user, RewarderUpdate[] memory _preonAdjustments)
    internal
  {
    UserInfo storage userInfo = users[_user];
    uint256 nAdjustments = _preonAdjustments.length;

    // update Preon allocations
    for (uint256 i; i < nAdjustments; i++) {
      address rewarder = _preonAdjustments[i].rewarder;
      bool isIncrease = _preonAdjustments[i].isIncrease;
      uint256 amount = _preonAdjustments[i].amount;

      if (isIncrease) {
        userInfo.preonStakes[rewarder] += amount;
      } else {
        require(
          userInfo.preonStakes[rewarder] >= amount,
          "vePREON: insufficient Preon staked on rewarder"
        );
        userInfo.preonStakes[rewarder] -= amount;
      }
    }
  }

  /**
   * send in or send out staked PREON from this contract
   * and update user's and global variables
   */
  function _handleStaking(
    UserInfo storage userInfo,
    bool _isIncreaseStake,
    uint256 _amount
  ) internal {
    if (_amount > 0) {
      if (_isIncreaseStake) {
        // pull in PREON tokens to stake
        require(preonToken.transferFrom(msg.sender, address(this), _amount));
        userInfo.totalPreon += _amount;
        totalPreon += _amount;
      } else {
        require(
          userInfo.totalPreon >= _amount,
          "vePREON: insufficient Preon for user to unstake"
        );
        userInfo.totalPreon -= _amount;
        totalPreon -= _amount;
        // unstake and send user back PREON tokens
        preonToken.transfer(msg.sender, _amount);
      }
    }
    // sanity check:
    require(
      totalPreon <= _totalPreonSupply,
      "more Preon staked in this contract than the total supply"
    );
  }

  // ============= Internal View Functions  =============

  /**
   * Checks that caller is either an EOA or a whitelisted contract
   */
  function _requireValidCaller() internal view {
    if (msg.sender != tx.origin) {
      // called by contract
      require(
        isWhitelistedContract[msg.sender],
        "vePREON: update() can only be called by EOAs or whitelisted contracts"
      );
    }
  }

  // ============= Internal Pure Functions  =============

  /**
   * gets the total net change across all adjustments
   * returns (true, absoluteDiff) if the net change if positive and
   * returns (false, absoluteDiff) if the net change is negative
   */
  function _getAmountChange(RewarderUpdate[] memory _adjustments)
    internal
    pure
    returns (bool, uint256)
  {
    uint256 preonIncrease = 0;
    uint256 preonDecrease = 0;
    uint256 n = _adjustments.length;
    for (uint256 i = 0; i < n; i++) {
      if (_adjustments[i].isIncrease) {
        preonIncrease += _adjustments[i].amount;
      } else {
        preonDecrease += _adjustments[i].amount;
      }
    }
    return _getDiff(preonIncrease, preonDecrease);
  }

  /**
   * gets the total absolute difference
   * returns (true, absoluteDiff) if if diff >= 0 positive and
   * returns (false, absoluteDiff) if otherwise
   */
  function _getDiff(uint256 _a, uint256 _b)
    internal
    pure
    returns (bool isPositive, uint256 diff)
  {
    if (_a >= _b) {
      return (true, _a - _b);
    }
    return (false, _b - _a);
  }

  function getAccumulationRate() external view override returns (uint256) {
    return accumulationRate;
  }

  // get user's total staked PREON balance
  function getTotalPreon(address _user) public view returns (uint256) {
    return users[_user].totalPreon;
  }

  // set emitter
  function setEmitter(IEmitter _emitter) external {
    require(address(emitter) == address(0), "emitter already set");
    require(msg.sender == contractController, "vePREON: invalid caller");

    emitter = _emitter;
  }

  // ========= NEW FUNCTIONS =========

  function updateContractController(address _newcontractController) external {
    if (contractController == address(0)) {
      contractController = 0x43FbdF7D784F0d1723866b401249CB6f9e85636c;
    } else {
      require(msg.sender == contractController);
      contractController = _newcontractController;
    }
  }

  function getUpdatableRewarders() external view returns (address[] memory) {
    return updatableRewarders;
  }

  // add a rewarder to the list of updatable rewarders
  function addUpdatableRewarder(address _rewarder) external {
    require(msg.sender == contractController, "vePREON: invalid caller");
    require(!isUpdatableRewarder[_rewarder], "vePREON: rewarder already added");
    require(updatableRewarders.length < 10, "vePREON: too many rewarders");

    isUpdatableRewarder[_rewarder] = true;
    updatableRewarders.push(_rewarder);

    emit RewarderStatusUpdate(_rewarder, true);
  }

  // if a rewarder address is set to be updatable, vePREON
  // will call update() on it when a user stakes or unstakes PREON on it
  function removeUpdatableRewarder(uint256 _index) external {
    require(msg.sender == contractController, "vePREON: invalid caller");

    address rewarderToRemove = updatableRewarders[_index];
    updatableRewarders[_index] = updatableRewarders[
      updatableRewarders.length - 1
    ];
    updatableRewarders.pop();
    isUpdatableRewarder[rewarderToRemove] = false;
    emit RewarderStatusUpdate(rewarderToRemove, false);
  }

  // notify all updatable rewarders of the new vePREON gains
  function notifyAllRewarders() external {
    _notifyRewarders(msg.sender, updatableRewarders);
  }

  // notify rewarders of the new vePREON gains
  function notifyRewarders(address[] memory rewarders) external {
    _notifyRewarders(msg.sender, rewarders);
  }

  // update rewarders with latest info on total vePREON for the user
  function _notifyRewarders(address _user, address[] memory rewarders)
    internal
  {
    UserInfo storage userInfo = users[_user];
    uint256 currentVePreon = getTotalVePreon(_user);
    for (uint256 i = 0; i < rewarders.length; i++) {
      address rewarder = rewarders[i];
      if (isUpdatableRewarder[rewarder]) {
        uint256 vePreonAmount = 0;
        if (userInfo.totalPreon > 0) {
          vePreonAmount =
            (currentVePreon * userInfo.preonStakes[rewarder]) /
            userInfo.totalPreon;
        }
        IRewarder(rewarder).updateFactor(_user, vePreonAmount);
      }
    }
  }
}
