// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IPriceSubmitter.sol";

interface IFtsoManager {

    event FtsoAdded(IIFtso ftso, bool add);
    event PanicMode(bool panicMode);
    event FtsoPanicMode(IIFtso ftso, bool panicMode);
    event RewardEpochFinalized(uint256 votepowerBlock, uint256 startBlock);
    event PriceEpochFinalized(address chosenFtso, uint256 rewardEpochId);
    event ClosingExpiredRewardEpochsFailed();

    function active() external view returns (bool);
    
    function priceSubmitter() external view returns (IPriceSubmitter);

    function getCurrentRewardEpoch() external view returns (uint256);

    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view returns (uint256);
    
    function getCurrentPriceEpochData() external view returns (
        uint256 _priceEpochId,
        uint256 _priceEpochStartTimestamp,
        uint256 _priceEpochEndTimestamp,
        uint256 _priceEpochRevealEndTimestamp,
        uint256 _currentTimestamp
    );

    function getFtsos() external view returns (IIFtso[] memory _ftsos);

    function getPriceEpochConfiguration() external view returns (
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSec,
        uint256 _revealEpochDurationSec
    );
}