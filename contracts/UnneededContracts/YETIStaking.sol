// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/BaseMath.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "hardhat/console.sol";
import "../Interfaces/IYETIToken.sol";
import "../Interfaces/ISYETI.sol";
import "../Dependencies/LiquityMath.sol";
import "../Interfaces/IYUSDToken.sol";

contract YETIStaking is IYETIStaking, Ownable, CheckContract, BaseMath {
    using SafeMath for uint256;

    // --- Data ---
    bytes32 public constant NAME = "YETIStaking";

    mapping(address => uint256) public stakes;
    uint256 public totalYETIStaked;

    uint256 public F_ETH; // Running sum of ETH fees per-YETI-staked
    uint256 public F_YUSD; // Running sum of YETI fees per-YETI-staked

    // User snapshots of F_ETH and F_YUSD, taken at the point at which their latest deposit was made
    mapping(address => Snapshot) public snapshots;

    struct Snapshot {
        uint256 F_ETH_Snapshot;
        uint256 F_YUSD_Snapshot;
    }

    IYETIToken public yetiToken;
    IYUSDToken public yusdToken;

    address public troveManagerAddress;
    address public borrowerOperationsAddress;
    address public activePoolAddress;

    // --- Events ---

    event YETITokenAddressSet(address _yetiTokenAddress);
    event YUSDTokenAddressSet(address _yusdTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event ActivePoolAddressSet(address _activePoolAddress);

    event StakeChanged(address indexed staker, uint256 newStake);
    event StakingGainsWithdrawn(address indexed staker, uint256 YETIGain);
    event F_ETHUpdated(uint256 _F_ETH);
    event F_YUSDUpdated(uint256 _F_YUSD);
    event TotalYETIStakedUpdated(uint256 _totalYETIStaked);
    event EtherSent(address _account, uint256 _amount);
    event StakerSnapshotsUpdated(
        address _staker,
        uint256 _F_ETH,
        uint256 _F_YUSD
    );

    // --- Functions ---

    function setAddresses(
        address _yetiTokenAddress,
        address _yusdTokenAddress,
        address _troveManagerAddress,
        address _borrowerOperationsAddress,
        address _activePoolAddress
    ) external override onlyOwner {
        checkContract(_yetiTokenAddress);
        checkContract(_yusdTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_activePoolAddress);

        yetiToken = IYETIToken(_yetiTokenAddress);
        yusdToken = IYUSDToken(_yusdTokenAddress);
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        activePoolAddress = _activePoolAddress;

        emit YETITokenAddressSet(_yetiTokenAddress);
        emit YETITokenAddressSet(_yusdTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit ActivePoolAddressSet(_activePoolAddress);

        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated ETH and YUSD gains to them.
    function stake(uint256 _YETIamount) external override {
        _requireNonZeroAmount(_YETIamount);

        uint256 currentStake = stakes[msg.sender];

        // uint ETHGain;
        // uint YUSDGain;
        uint256 YETIGain;
        // Grab any accumulated YETI gains from the current stake
        if (currentStake != 0) {
            // ETHGain = _getPendingETHGain(msg.sender);
            YETIGain = _getPendingYETIGain(msg.sender);
        }

        _updateUserSnapshots(msg.sender);
        // Add accumulated YETI rewards to stake
        uint256 newStake = currentStake.add(_YETIamount).add(YETIGain);

        // Increase user’s stake and total YETI staked
        stakes[msg.sender] = newStake;
        totalYETIStaked = totalYETIStaked.add(_YETIamount).add(YETIGain);
        emit TotalYETIStakedUpdated(totalYETIStaked);

        // Transfer YETI from caller to this contract
        yetiToken.sendToYETIStaking(msg.sender, _YETIamount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, YETIGain);

        // Unneeded as rewards are auto compounded and restaked
        // Send accumulated YUSD and ETH gains to the caller
        // if (currentStake != 0) {
        //     yusdToken.transfer(msg.sender, YUSDGain);
        //     _sendETHGainToUser(ETHGain);
        // }
    }

    // Unstake the YETI and send the it back to the caller, along with their accumulated YUSD & ETH gains.
    // If requested amount > stake, send their entire stake.
    function unstake(uint256 _YETIamount) external override {
        uint256 currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated ETH and YUSD gains from the current stake
        // uint ETHGain = _getPendingETHGain(msg.sender);
        uint256 YETIGain = _getPendingYETIGain(msg.sender);

        _updateUserSnapshots(msg.sender);

        if (_YETIamount != 0) {
            uint256 YETIToWithdraw = LiquityMath._min(
                _YETIamount,
                currentStake
            );

            uint256 newStake = currentStake.sub(YETIToWithdraw);
            // Decrease user's stake and total YETI staked
            stakes[msg.sender] = newStake;
            totalYETIStaked = totalYETIStaked.sub(YETIToWithdraw);
            emit TotalYETIStakedUpdated(totalYETIStaked);

            // Transfer unstaked YETI to user
            yetiToken.transfer(msg.sender, YETIToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, YETIGain);

        // Send accumulated YETI gains to the caller
        yetiToken.transfer(msg.sender, YETIGain);
        // _sendETHGainToUser(ETHGain);
    }

    // --- Reward-per-unit-staked increase functions. Called by Liquity core contracts ---

    function increaseF_ETH(uint256 _ETHFee) external override {
        _requireCallerIsTroveManager();
        uint256 ETHFeePerYETIStaked;

        if (totalYETIStaked != 0) {
            ETHFeePerYETIStaked = _ETHFee.mul(DECIMAL_PRECISION).div(
                totalYETIStaked
            );
        }

        F_ETH = F_ETH.add(ETHFeePerYETIStaked);
        emit F_ETHUpdated(F_ETH);
    }

    function increaseF_YUSD(uint256 _YUSDFee) external override {
        _requireCallerIsBOOrTM();
        uint256 YUSDFeePerYETIStaked;

        if (totalYETIStaked != 0) {
            YUSDFeePerYETIStaked = _YUSDFee.mul(DECIMAL_PRECISION).div(
                totalYETIStaked
            );
        }

        F_YUSD = F_YUSD.add(YUSDFeePerYETIStaked);
        emit F_YUSDUpdated(F_YUSD);
    }

    // --- Pending reward functions ---

    function getPendingETHGain(address _user)
        external
        view
        override
        returns (uint256)
    {
        return _getPendingETHGain(_user);
    }

    function _getPendingETHGain(address _user) internal view returns (uint256) {
        uint256 F_ETH_Snapshot = snapshots[_user].F_ETH_Snapshot;
        uint256 ETHGain = stakes[_user].mul(F_ETH.sub(F_ETH_Snapshot)).div(
            DECIMAL_PRECISION
        );
        return ETHGain;
    }

    function getPendingYUSDGain(address _user)
        external
        view
        override
        returns (uint256)
    {
        return _getPendingYUSDGain(_user);
    }

    function _getPendingYUSDGain(address _user)
        internal
        view
        returns (uint256)
    {
        uint256 F_YUSD_Snapshot = snapshots[_user].F_YUSD_Snapshot;
        uint256 YUSDGain = stakes[_user].mul(F_YUSD.sub(F_YUSD_Snapshot)).div(
            DECIMAL_PRECISION
        );
        return YUSDGain;
    }

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
        // snapshots[_user].F_ETH_Snapshot = F_ETH;
        snapshots[_user].F_YETI_Snapshot = F_YETI;
        emit StakerSnapshotsUpdated(_user, F_YETI);
    }

    // function _sendETHGainToUser(uint ETHGain) internal {
    //     emit EtherSent(msg.sender, ETHGain);
    //     (bool success, ) = msg.sender.call{value: ETHGain}("");
    //     require(success, "YETIStaking: Failed to send accumulated ETHGain");
    // }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(
            msg.sender == troveManagerAddress,
            "YETIStaking: caller is not TroveM"
        );
    }

    function _requireCallerIsBOOrTM() internal view {
        require(
            ((msg.sender == troveManagerAddress) ||
                (msg.sender == borrowerOperationsAddress)),
            "YETIStaking: caller is not BorrowerOps"
        );
    }

    function _requireCallerIsActivePool() internal view {
        require(
            msg.sender == activePoolAddress,
            "YETIStaking: caller is not ActivePool"
        );
    }

    function _requireUserHasStake(uint256 currentStake) internal pure {
        require(
            currentStake != 0,
            "YETIStaking: User must have a non-zero stake"
        );
    }

    function _requireNonZeroAmount(uint256 _amount) internal pure {
        require(_amount != 0, "YETIStaking: Amount must be non-zero");
    }

    receive() external payable {
        _requireCallerIsActivePool();
    }
}
