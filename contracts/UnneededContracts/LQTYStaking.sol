 SPDX-License-Identifier: MIT

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

contract SPREON is ISPREON, Ownable, CheckContract, BaseMath {
    using SafeMath for uint;

    // --- Data ---
    bytes32 constant public NAME = "PREONStaking";

    mapping( address => uint) public stakes;
    uint public totalPREONStaked;

    uint public F_PUSD; // Running sum of PREON fees per-PREON-staked

    // User snapshots of F_PUSD, taken at the point at which their latest deposit was made
    mapping (address => Snapshot) public snapshots;

    struct Snapshot {
        uint F_PUSD_Snapshot;
    }

    IPREONToken public preonToken;
    IPUSDToken public pusdToken;

    address public troveManagerAddress;
    address public troveManagerRedemptionsAddress;
    address public borrowerOperationsAddress;
    address public activePoolAddress;

    // --- Events ---

    event PREONTokenAddressSet(address _preonTokenAddress);
    event PUSDTokenAddressSet(address _pusdTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event TroveManagerRedemptionsAddressSet(address _troveManagerRedemptionsAddress);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event ActivePoolAddressSet(address _activePoolAddress);

    event StakeChanged(address indexed staker, uint newStake);
    event StakingGainsWithdrawn(address indexed staker, uint PUSDGain);
    event F_PUSDUpdated(uint _F_PUSD);
    event TotalPREONStakedUpdated(uint _totalPREONStaked);
    event EtherSent(address _account, uint _amount);
    event StakerSnapshotsUpdated(address _staker, uint _F_PUSD);

    // --- Functions ---

    function setAddresses
    (
        address _preonTokenAddress,
        address _pusdTokenAddress,
        address _troveManagerAddress,
        address _troveManagerRedemptionsAddress,
        address _borrowerOperationsAddress,
        address _activePoolAddress
    )
        external
        onlyOwner
        override
    {
        checkContract(_preonTokenAddress);
        checkContract(_pusdTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_troveManagerRedemptionsAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_activePoolAddress);

        preonToken = IPREONToken(_preonTokenAddress);
        pusdToken = IPUSDToken(_pusdTokenAddress);
        troveManagerAddress = _troveManagerAddress;
        troveManagerRedemptionsAddress = _troveManagerRedemptionsAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        activePoolAddress = _activePoolAddress;

        emit PREONTokenAddressSet(_preonTokenAddress);
        emit PREONTokenAddressSet(_pusdTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit TroveManagerRedemptionsAddressSet(_troveManagerRedemptionsAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit ActivePoolAddressSet(_activePoolAddress);

        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated PUSD gains to them.
    function stake(uint _PREONamount) external override {
        _requireNonZeroAmount(_PREONamount);

        uint currentStake = stakes[msg.sender];

//        uint ETHGain;
        uint PUSDGain;
        // Grab any accumulated ETH and PUSD gains from the current stake
        if (currentStake != 0) {
//            ETHGain = _getPendingETHGain(msg.sender);
            PUSDGain = _getPendingPUSDGain(msg.sender);
        }

       _updateUserSnapshots(msg.sender);

        uint newStake = currentStake.add(_PREONamount);

        // Increase user’s stake and total PREON staked
        stakes[msg.sender] = newStake;
        totalPREONStaked = totalPREONStaked.add(_PREONamount);
        emit TotalPREONStakedUpdated(totalPREONStaked);

        // Transfer PREON from caller to this contract
        preonToken.sendToSPREON(msg.sender, _PREONamount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, PUSDGain);

         // Send accumulated PUSD gains to the caller
        if (currentStake != 0) {
            pusdToken.transfer(msg.sender, PUSDGain);
//            _sendETHGainToUser(ETHGain);
        }
    }

    // Unstake the PREON and send the it back to the caller, along with their accumulated PUSD gains.
    // If requested amount > stake, send their entire stake.
    function unstake(uint _PREONamount) external override {
        uint currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated PUSD gains from the current stake
//        uint ETHGain = _getPendingETHGain(msg.sender);
        uint PUSDGain = _getPendingPUSDGain(msg.sender);

        _updateUserSnapshots(msg.sender);

        if (_PREONamount != 0) {
            uint PREONToWithdraw = LiquityMath._min(_PREONamount, currentStake);

            uint newStake = currentStake.sub(PREONToWithdraw);

            // Decrease user's stake and total PREON staked
            stakes[msg.sender] = newStake;
            totalPREONStaked = totalPREONStaked.sub(PREONToWithdraw);
            emit TotalPREONStakedUpdated(totalPREONStaked);

            // Transfer unstaked PREON to user
            preonToken.transfer(msg.sender, PREONToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, PUSDGain);

        // Send accumulated PUSD gains to the caller
        pusdToken.transfer(msg.sender, PUSDGain);
//        _sendETHGainToUser(ETHGain);
    }

    // --- Reward-per-unit-staked increase functions. Called by Liquity core contracts ---

//    function increaseF_ETH(uint _ETHFee) external override {
//        _requireCallerIsTroveManager();
//        uint ETHFeePerPREONStaked;
//
//        if (totalPREONStaked != 0) {ETHFeePerPREONStaked = _ETHFee.mul(DECIMAL_PRECISION).div(totalPREONStaked);}
//
//        F_ETH = F_ETH.add(ETHFeePerPREONStaked);
//        emit F_ETHUpdated(F_ETH);
//    }

    function increaseF_PUSD(uint _PUSDFee) external override {
        _requireCallerIsBOOrTM();
        uint PUSDFeePerPREONStaked;

        if (totalPREONStaked != 0) {PUSDFeePerPREONStaked = _PUSDFee.mul(DECIMAL_PRECISION).div(totalPREONStaked);}

        F_PUSD = F_PUSD.add(PUSDFeePerPREONStaked);
        emit F_PUSDUpdated(F_PUSD);
    }

    // --- Pending reward functions ---

//    function getPendingETHGain(address _user) external view override returns (uint) {
//        return _getPendingETHGain(_user);
//    }
//
//    function _getPendingETHGain(address _user) internal view returns (uint) {
//        uint F_ETH_Snapshot = snapshots[_user].F_ETH_Snapshot;
//        uint ETHGain = stakes[_user].mul(F_ETH.sub(F_ETH_Snapshot)).div(DECIMAL_PRECISION);
//        return ETHGain;
//    }

    function getPendingPUSDGain(address _user) external view override returns (uint) {
        return _getPendingPUSDGain(_user);
    }

    function _getPendingPUSDGain(address _user) internal view returns (uint) {
        uint F_PUSD_Snapshot = snapshots[_user].F_PUSD_Snapshot;
        uint PUSDGain = stakes[_user].mul(F_PUSD.sub(F_PUSD_Snapshot)).div(DECIMAL_PRECISION);
        return PUSDGain;
    }

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
//        snapshots[_user].F_ETH_Snapshot = F_ETH;
        snapshots[_user].F_PUSD_Snapshot = F_PUSD;
        emit StakerSnapshotsUpdated(_user, F_PUSD);
    }

//    function _sendETHGainToUser(uint ETHGain) internal {
//        emit EtherSent(msg.sender, ETHGain);
//        (bool success, ) = msg.sender.call{value: ETHGain}("");
//        require(success, "SPREON: Failed to send accumulated ETHGain");
//    }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == troveManagerAddress, "SPREON: caller is not TroveM");
    }

    function _requireCallerIsBOOrTM() internal view {
        require(((msg.sender == troveManagerAddress)
        || (msg.sender == borrowerOperationsAddress))
        || (msg.sender == troveManagerRedemptionsAddress),
            "SPREON: caller is not BorrowerOps");
    }

     function _requireCallerIsActivePool() internal view {
        require(msg.sender == activePoolAddress, "SPREON: caller is not ActivePool");
    }

    function _requireUserHasStake(uint currentStake) internal pure {
        require(currentStake != 0, 'SPREON: User must have a non-zero stake');
    }

    function _requireNonZeroAmount(uint _amount) internal pure {
        require(_amount != 0, 'SPREON: Amount must be non-zero');
    }

    receive() external payable {
        _requireCallerIsActivePool();
    }
}
