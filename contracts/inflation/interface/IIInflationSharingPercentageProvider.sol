// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { IIInflationReceiver } from "../interface/IIInflationReceiver.sol";

struct SharingPercentage {
    IIInflationReceiver inflationReceiver;
    uint256 percentBips;
}

interface IIInflationSharingPercentageProvider {
    /**
     * @dev Assumption is that implementer edited that percents sum to 100 pct and
     *   that receiver addresses are valid.
     */
    function getSharingPercentages() external returns(SharingPercentage[] memory);
}