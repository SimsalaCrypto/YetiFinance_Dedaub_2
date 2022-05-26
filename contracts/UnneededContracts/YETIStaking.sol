// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/BaseMath.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "hardhat/console.sol";
import "../Interfaces/IPREONToken.sol";
import "../Interfaces/ISPREON.sol";
import "../Dependencies/LiquityMath.sol";
import "../Interfaces/IPUSDToken.sol";

contract PREONStaking is IPREONStaking, Ownable, CheckContract, BaseMath {
    using SafeMath for uint256;

    // --- Data ---
    bytes32 public constant NAME = "PREONStaking";

    mapping(address => uint256) public stakes;
    uint256 public totalPREONStaked;

    uint256 public F_ETH; // Running sum of ETH fees per-PREON-staked
    uint256 public F_PUSD; // Running sum of PREON fees per-PREON-staked

    // User snapshots of F_ETH and F_PUSD, taken at the point at which their latest deposit was made
    mapping(address => Snapshot) public snapshots;

    struct Snapshot {
        uint256 F_ETH_Snapshot;
        uint256 F_PUSD_Snapshot;
    }

    IPREONToken public preonToken;
    IPUSDToken public pusdToken;

    address public troveManagerAddress;
    address public borrowerOperationsAddress;
    address public activePoolAddress;

    // --- Events ---

    event PREONTokenAddressSet(address _preonTokenAddress);
    event PUSDTokenAddressSet(address _pusdTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event ActivePoolAddressSet(address _activePoolAddress);

    event StakeChanged(address indexed staker, uint256 newStake);
    event StakingGainsWithdrawn(address indexed staker, uint256 PREONGain);
    event F_ETHUpdated(uint256 _F_ETH);
    event F_PUSDUpdated(uint256 _F_PUSD);
    event TotalPREONStakedUpdated(uint256 _totalPREONStaked);
    event EtherSent(address _account, uint256 _amount);
    event StakerSnapshotsUpdated(
        address _staker,
        uint256 _F_ETH,
        uint256 _F_PUSD
    );

    // --- Functions ---

    function setAddresses(
        address _preonTokenAddress,
        address _pusdTokenAddress,
        address _troveManagerAddress,
        address _borrowerOperationsAddress,
        address _activePoolAddress
    ) external override onlyOwner {
        checkContract(_preonTokenAddress);
        checkContract(_pusdTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_activePoolAddress);

        preonToken = IPREONToken(_preonTokenAddress);
        pusdToken = IPUSDToken(_pusdTokenAddress);
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        activePoolAddress = _activePoolAddress;

        emit PREONTokenAddressSet(_preonTokenAddress);
        emit PREONTokenAddressSet(_pusdTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit ActivePoolAddressSet(_activePoolAddress);

        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated ETH and PUSD gains to them.
    function stake(uint256 _PREONamount) external override {
        _requireNonZeroAmount(_PREONamount);

        uint256 currentStake = stakes[msg.sender];

        // uint ETHGain;
        // uint PUSDGain;
        uint256 PREONGain;
        // Grab any accumulated PREON gains from the current stake
        if (currentStake != 0) {
            // ETHGain = _getPendingETHGain(msg.sender);
            PREONGain = _getPendingPREONGain(msg.sender);
        }

        _updateUserSnapshots(msg.sender);
        // Add accumulated PREON rewards to stake
        uint256 newStake = currentStake.add(_PREONamount).add(PREONGain);

        // Increase user’s stake and total PREON staked
        stakes[msg.sender] = newStake;
        totalPREONStaked = totalPREONStaked.add(_PREONamount).add(PREONGain);
        emit TotalPREONStakedUpdated(totalPREONStaked);

        // Transfer PREON from caller to this contract
        preonToken.sendToPREONStaking(msg.sender, _PREONamount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, PREONGain);

        // Unneeded as rewards are auto compounded and restaked
        // Send accumulated PUSD and ETH gains to the caller
        // if (currentStake != 0) {
        //     pusdToken.transfer(msg.sender, PUSDGain);
        //     _sendETHGainToUser(ETHGain);
        // }
    }

    // Unstake the PREON and send the it back to the caller, along with their accumulated PUSD & ETH gains.
    // If requested amount > stake, send their entire stake.
    function unstake(uint256 _PREONamount) external override {
        uint256 currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated ETH and PUSD gains from the current stake
        // uint ETHGain = _getPendingETHGain(msg.sender);
        uint256 PREONGain = _getPendingPREONGain(msg.sender);

        _updateUserSnapshots(msg.sender);

        if (_PREONamount != 0) {
            uint256 PREONToWithdraw = LiquityMath._min(
                _PREONamount,
                currentStake
            );

            uint256 newStake = currentStake.sub(PREONToWithdraw);
            // Decrease user's stake and total PREON staked
            stakes[msg.sender] = newStake;
            totalPREONStaked = totalPREONStaked.sub(PREONToWithdraw);
            emit TotalPREONStakedUpdated(totalPREONStaked);

            // Transfer unstaked PREON to user
            preonToken.transfer(msg.sender, PREONToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, PREONGain);

        // Send accumulated PREON gains to the caller
        preonToken.transfer(msg.sender, PREONGain);
        // _sendETHGainToUser(ETHGain);
    }

    // --- Reward-per-unit-staked increase functions. Called by Liquity core contracts ---

    function increaseF_ETH(uint256 _ETHFee) external override {
        _requireCallerIsTroveManager();
        uint256 ETHFeePerPREONStaked;

        if (totalPREONStaked != 0) {
            ETHFeePerPREONStaked = _ETHFee.mul(DECIMAL_PRECISION).div(
                totalPREONStaked
            );
        }

        F_ETH = F_ETH.add(ETHFeePerPREONStaked);
        emit F_ETHUpdated(F_ETH);
    }

    function increaseF_PUSD(uint256 _PUSDFee) external override {
        _requireCallerIsBOOrTM();
        uint256 PUSDFeePerPREONStaked;

        if (totalPREONStaked != 0) {
            PUSDFeePerPREONStaked = _PUSDFee.mul(DECIMAL_PRECISION).div(
                totalPREONStaked
            );
        }

        F_PUSD = F_PUSD.add(PUSDFeePerPREONStaked);
        emit F_PUSDUpdated(F_PUSD);
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

    function getPendingPUSDGain(address _user)
        external
        view
        override
        returns (uint256)
    {
        return _getPendingPUSDGain(_user);
    }

    function _getPendingPUSDGain(address _user)
        internal
        view
        returns (uint256)
    {
        uint256 F_PUSD_Snapshot = snapshots[_user].F_PUSD_Snapshot;
        uint256 PUSDGain = stakes[_user].mul(F_PUSD.sub(F_PUSD_Snapshot)).div(
            DECIMAL_PRECISION
        );
        return PUSDGain;
    }

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
        // snapshots[_user].F_ETH_Snapshot = F_ETH;
        snapshots[_user].F_PREON_Snapshot = F_PREON;
        emit StakerSnapshotsUpdated(_user, F_PREON);
    }

    // function _sendETHGainToUser(uint ETHGain) internal {
    //     emit EtherSent(msg.sender, ETHGain);
    //     (bool success, ) = msg.sender.call{value: ETHGain}("");
    //     require(success, "PREONStaking: Failed to send accumulated ETHGain");
    // }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(
            msg.sender == troveManagerAddress,
            "PREONStaking: caller is not TroveM"
        );
    }

    function _requireCallerIsBOOrTM() internal view {
        require(
            ((msg.sender == troveManagerAddress) ||
                (msg.sender == borrowerOperationsAddress)),
            "PREONStaking: caller is not BorrowerOps"
        );
    }

    function _requireCallerIsActivePool() internal view {
        require(
            msg.sender == activePoolAddress,
            "PREONStaking: caller is not ActivePool"
        );
    }

    function _requireUserHasStake(uint256 currentStake) internal pure {
        require(
            currentStake != 0,
            "PREONStaking: User must have a non-zero stake"
        );
    }

    function _requireNonZeroAmount(uint256 _amount) internal pure {
        require(_amount != 0, "PREONStaking: Amount must be non-zero");
    }

    receive() external payable {
        _requireCallerIsActivePool();
    }
}
