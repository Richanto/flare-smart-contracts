// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementations/Ftso.sol";
import "../IVotePower.sol";

contract MockFtso is Ftso {

    struct ResultVars {
        uint256 id;
        uint32 len;
        uint32 truncatedFirstQuartileIndex;
        uint32 firstQuartileIndex;
        uint32 medianIndex;
        uint32 lastQuartileIndex;
        uint32 truncatedLastQuartileIndex;
    }

    event FinalizeEpochResults(address[] eligibleAddresses, uint64[] flrWeights, uint256 flrWeightsSum);
    
    constructor(
        IVotePower _fFlr,
        IVotePower _fAsset,
        IRewardContract _rewardManager,
        uint256 _minVotePower, 
        uint256 _startTimestamp,
        uint256 _epochPeriod,
        uint256 _revealPeriod
    ) Ftso(
        _fFlr,
        _fAsset,
        1,
        _rewardManager,
        _minVotePower,
        true,
        true
    )
    {
        initPriceEpochData(_startTimestamp, _epochPeriod, _revealPeriod);
    }

    function finalizePriceEpochWithResult(uint256 _epochId) external onlyRewardManager
        returns (
            address[] memory eligibleAddresses,
            uint64[] memory flrWeights,
            uint256 flrWeightsSum
        )
    {
        (eligibleAddresses, flrWeights, flrWeightsSum) = finalizePriceEpoch(_epochId, true);
        emit FinalizeEpochResults(eligibleAddresses, flrWeights, flrWeightsSum);
    }

    function epochCount(uint256 _epochId) external view returns (uint256) {
        Epoch storage epoch = epochs[_epochId];
        return epoch.voteCount;
    }

    function getVoteInfo(uint256 _epochId)
        external view 
        returns (
            uint256 epochId,
            uint128[] memory prices,
            uint64[] memory weightsFlr,
            uint64[] memory weightsAsset
        )
    {
        Epoch storage epoch = epochs[_epochId];
        uint id = epoch.firstVoteId;
        uint32 len = epoch.voteCount;
        epochId = _epochId;
        prices = new uint128[](len);
        weightsFlr = new uint64[](len);
        weightsAsset = new uint64[](len);
        for (uint32 cnt = 0; cnt < len; cnt++) {
            Vote storage vote = votes[id];
            prices[cnt] = vote.price;
            weightsFlr[cnt] = vote.weightFlr;
            weightsAsset[cnt] = vote.weightAsset;
            id = nextVoteId[id];
        }
    }

    function getWeightRatio(uint256 _epochId) external view returns (uint256) {
        Epoch storage epoch = epochs[_epochId];
        uint256 weightRatio = 50;
        if (_epochId > 0) {
            weightRatio = getAssetVsFlrWeightRatio(
                epoch.votePowerAsset,
                epoch.accumulatedVotePowerAsset,
                epochs[_epochId - 1].medianPrice
            );
        }
        return weightRatio;
    }

    function getEpochResult(uint256 _epochId)
        external view 
        returns (
            uint256 epochId,
            uint128[] memory votePrices,
            uint64[] memory weightsFlr, 
            uint64[] memory weightsAsset,
            uint32[] memory medians, 
            uint128[] memory prices,
            uint256[] memory weights
        )
    {
        Epoch storage epoch = epochs[_epochId];        
        ResultVars memory r = ResultVars(0,0,0,0,0,0,0);

        epochId = _epochId;
        r.len = epoch.voteCount;
        votePrices = new uint128[](r.len);
        weightsFlr = new uint64[](r.len);
        weightsAsset = new uint64[](r.len);
        r.id = epoch.firstVoteId;
        
        for(uint32 cnt = 0; cnt < r.len; cnt++) {
            Vote storage vote = votes[r.id];
            votePrices[cnt] = vote.price;
            weightsFlr[cnt] = vote.weightFlr;
            weightsAsset[cnt] = vote.weightAsset;
            if(r.id == epoch.firstQuartileVoteId) {
                r.firstQuartileIndex = cnt;
            }
            if(r.id == epoch.truncatedFirstQuartileVoteId) {
                r.truncatedFirstQuartileIndex = cnt;
            }
            if(r.id == epoch.medianVoteId) {
                r.medianIndex = cnt;
            }
            if(r.id == epoch.lastQuartileVoteId) {
                r.lastQuartileIndex = cnt;
            }
            if(r.id == epoch.truncatedLastQuartileVoteId) {
                r.truncatedLastQuartileIndex = cnt;
            }
            r.id = nextVoteId[r.id];            

        }
        medians = new uint32[](5);
        prices = new uint128[](3);
        weights = new uint256[](6);

        medians[0] = r.truncatedFirstQuartileIndex;
        medians[1] = r.firstQuartileIndex;
        medians[2] = r.medianIndex;
        medians[3] = r.lastQuartileIndex;
        medians[4] = r.truncatedLastQuartileIndex;  

        prices[0] = uint128(epoch.lowRewardedPrice);
        prices[1] = uint128(epoch.medianPrice);
        prices[2] = uint128(epoch.highRewardedPrice);

        weights[0] = epoch.lowWeightSum;
        weights[1] = epoch.rewardedWeightSum;
        weights[2] = epoch.highWeightSum;
        weights[3] = epoch.flrLowWeightSum;
        weights[4] = epoch.flrRewardedWeightSum;
        weights[5] = epoch.flrHighWeightSum;
    }

    function uint2str(uint _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint k = len;
        while (_i != 0) {
            k = k-1;
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }

    function markers(uint32 i, uint32[] memory indices) internal pure returns (string memory _markerString) {
        return string(abi.encodePacked(
                i == indices[1] ? "\t<1": "",
                i == indices[0] ? "\t<1-": "",
                i == indices[2] ? "\t<2": "",
                i == indices[3] ? "\t<3": "",
                i == indices[4] ? "\t<3+": ""
        ));
    }

    function markers2(uint id, Epoch memory epoch) internal pure returns (string memory _markerString2) {
        return string(abi.encodePacked(
                id == epoch.firstQuartileVoteId ? "\t<1": "",
                id == epoch.truncatedFirstQuartileVoteId ? "\t<1-": "",                
                id == epoch.medianVoteId ? "\t<2": "",
                id == epoch.lastQuartileVoteId ? "\t<3": "",
                id == epoch.truncatedLastQuartileVoteId ? "\t<3+": ""
        ));
    }

}