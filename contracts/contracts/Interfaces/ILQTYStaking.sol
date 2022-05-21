// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface ISYETI {
  // --- Events --

  event YETITokenAddressSet(address _yetiTokenAddress);
  event YUSDTokenAddressSet(address _yusdTokenAddress);
  event TroveManagerAddressSet(address _troveManager);
  event TroveManagerRedemptionsAddressSet(address _troveManagerRedemptions);
  event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
  event ActivePoolAddressSet(address _activePoolAddress);

  event StakeChanged(address indexed staker, uint256 newStake);
  event StakingGainsWithdrawn(address indexed staker, uint256 YUSDGain);
  event F_YUSDUpdated(uint256 _F_YUSD);
  event TotalYETIStakedUpdated(uint256 _totalYETIStaked);
  event StakerSnapshotsUpdated(address _staker, uint256 _F_YUSD);

  // --- Functions ---

  function setAddresses(
    address _yetiTokenAddress,
    address _yusdTokenAddress,
    address _troveManagerAddress,
    address _troveManagerRedemptionsAddress,
    address _borrowerOperationsAddress,
    address _activePoolAddress
  ) external;

  function stake(uint256 _YETIamount) external;

  function unstake(uint256 _YETIamount) external;

  function increaseF_YUSD(uint256 _YETIFee) external;

  function getPendingYUSDGain(address _user) external view returns (uint256);
}
