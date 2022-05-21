// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./TroveManager.sol";
import "./SortedTroves.sol";
import "./Dependencies/Whitelist.sol";

/*  Helper contract for grabbing Trove data for the front end. Not part of the core Liquity system. */
contract MultiTroveGetter {
  struct CombinedTroveData {
    address owner;
    uint256 debt;
    address[] colls;
    uint256[] amounts;
    address[] allColls;
    uint256[] stakeAmounts;
    uint256[] snapshotAmounts;
    uint256[] snapshotYUSDDebts;
  }

  TroveManager public troveManager; // XXX Troves missing from ITroveManager?
  ISortedTroves public sortedTroves;
  IWhitelist public whitelist;

  constructor(
    TroveManager _troveManager,
    ISortedTroves _sortedTroves,
    IWhitelist _whitelist
  ) public {
    troveManager = _troveManager;
    sortedTroves = _sortedTroves;
    whitelist = _whitelist;
  }

  function getMultipleSortedTroves(int256 _startIdx, uint256 _count)
    external
    view
    returns (CombinedTroveData[] memory _troves)
  {
    uint256 startIdx;
    bool descend;

    if (_startIdx >= 0) {
      startIdx = uint256(_startIdx);
      descend = true;
    } else {
      startIdx = uint256(-(_startIdx + 1));
      descend = false;
    }

    uint256 sortedTrovesSize = sortedTroves.getSize();

    if (startIdx >= sortedTrovesSize) {
      _troves = new CombinedTroveData[](0);
    } else {
      uint256 maxCount = sortedTrovesSize - startIdx;

      if (_count > maxCount) {
        _count = maxCount;
      }

      if (descend) {
        _troves = _getMultipleSortedTrovesFromHead(startIdx, _count);
      } else {
        _troves = _getMultipleSortedTrovesFromTail(startIdx, _count);
      }
    }
  }

  function _getMultipleSortedTrovesFromHead(uint256 _startIdx, uint256 _count)
    internal
    view
    returns (CombinedTroveData[] memory _troves)
  {
    address currentTroveowner = sortedTroves.getFirst();

    for (uint256 idx = 0; idx < _startIdx; ++idx) {
      currentTroveowner = sortedTroves.getNext(currentTroveowner);
    }

    _troves = new CombinedTroveData[](_count);

    for (uint256 idx = 0; idx < _count; ++idx) {
      _troves[idx] = _getCombinedTroveData(currentTroveowner);
      currentTroveowner = sortedTroves.getNext(currentTroveowner);
    }
  }

  function _getMultipleSortedTrovesFromTail(uint256 _startIdx, uint256 _count)
    internal
    view
    returns (CombinedTroveData[] memory _troves)
  {
    address currentTroveowner = sortedTroves.getLast();

    for (uint256 idx = 0; idx < _startIdx; ++idx) {
      currentTroveowner = sortedTroves.getPrev(currentTroveowner);
    }

    _troves = new CombinedTroveData[](_count);

    for (uint256 idx = 0; idx < _count; ++idx) {
      _troves[idx] = _getCombinedTroveData(currentTroveowner);
      currentTroveowner = sortedTroves.getPrev(currentTroveowner);
    }
  }

  function _getCombinedTroveData(address _troveOwner)
    internal
    view
    returns (CombinedTroveData memory data)
  {
    data.owner = _troveOwner;
    data.debt = troveManager.getTroveDebt(_troveOwner);
    (data.colls, data.amounts) = troveManager.getTroveColls(_troveOwner);

    data.allColls = whitelist.getValidCollateral();
    data.stakeAmounts = new uint256[](data.allColls.length);
    data.snapshotAmounts = new uint256[](data.allColls.length);
    uint256 collsLen = data.allColls.length;
    for (uint256 i; i < collsLen; ++i) {
      address token = data.allColls[i];

      data.stakeAmounts[i] = troveManager.getTroveStake(_troveOwner, token);
      data.snapshotAmounts[i] = troveManager.getRewardSnapshotColl(
        _troveOwner,
        token
      );
      data.snapshotYUSDDebts[i] = troveManager.getRewardSnapshotYUSD(
        _troveOwner,
        token
      );
    }
  }
}
