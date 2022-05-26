// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;

interface ISPREON {
  // --- Events --

  event PREONTokenAddressSet(address _preonTokenAddress);
  event PUSDTokenAddressSet(address _pusdTokenAddress);
  event TroveManagerAddressSet(address _troveManager);
  event TroveManagerRedemptionsAddressSet(address _troveManagerRedemptions);
  event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
  event ActivePoolAddressSet(address _activePoolAddress);

  event StakeChanged(address indexed staker, uint256 newStake);
  event StakingGainsWithdrawn(address indexed staker, uint256 PUSDGain);
  event F_PUSDUpdated(uint256 _F_PUSD);
  event TotalPREONStakedUpdated(uint256 _totalPREONStaked);
  event StakerSnapshotsUpdated(address _staker, uint256 _F_PUSD);

  // --- Functions ---

  function setAddresses(
    address _preonTokenAddress,
    address _pusdTokenAddress,
    address _troveManagerAddress,
    address _troveManagerRedemptionsAddress,
    address _borrowerOperationsAddress,
    address _activePoolAddress
  ) external;

  function stake(uint256 _PREONamount) external;

  function unstake(uint256 _PREONamount) external;

  function increaseF_PUSD(uint256 _PREONFee) external;

  function getPendingPUSDGain(address _user) external view returns (uint256);
}
