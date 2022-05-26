pragma solidity 0.6.12;

// Interface for performing a swap within the sPREON contract
// Takes in PUSD and swaps for PREON

interface IsPREONRouter {
  // Must require that the swap went through successfully with at least min preon out amounts out.
  function swap(
    uint256 _PUSDAmount,
    uint256 _minPREONOut,
    address _to
  ) external returns (uint256[] memory amounts);
}
