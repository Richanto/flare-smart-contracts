// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IFtsoRewardManager.sol";
import "../interface/IIFtsoManager.sol";
import "../../token/implementation/WFlr.sol";
import { FlareKeeper } from "../../utils/implementation/FlareKeeper.sol";
import "../../accounting/implementation/CloseManager.sol";

interface IIFtsoRewardManager is IFtsoRewardManager {

    function closeExpiredRewardEpochs() external;

    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochsRemaining,
        uint256 currentRewardEpoch
    ) external returns (bool);

    function setFTSOManager(IIFtsoManager _ftsoManager) external;
    function setWFLR(WFlr _wFlr) external;
    function setFlareKeeper(address _flareKeeper) external;
}

