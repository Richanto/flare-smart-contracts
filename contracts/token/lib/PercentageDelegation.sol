// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointHistory} from "./CheckPointHistory.sol";
import {DelegationHistory} from "./DelegationHistory.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../../utils/implementation/SafePct.sol";

/**
 * @title PercentageDelegation library
 * @notice Only handles percentage delegation  
 * @notice A library to manage a group of _delegates for allocating voting power by a delegator.
 **/
library PercentageDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using DelegationHistory for DelegationHistory.CheckPointHistoryState;
    using SafeMath for uint256;
    using SafePct for uint256;

    uint256 public constant MAX_BIPS = 10000;
    string private constant MAX_BIPS_MSG = "Max delegation bips exceeded";
    
    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of _delegates (a PercentageDelegation) for a delegator.
     */
    struct DelegationState {
        // percentages by _delegates
        DelegationHistory.CheckPointHistoryState delegation;
    }

    /**
     * @notice Add or replace an existing _delegate with allocated vote power in basis points.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The address of the _delegate to add/replace
     * @param _bips Allocation of the delegation specified in basis points (1/100 of 1 percent)
     * @dev If you send a `_bips` of zero, `_delegate` will be deleted if one
     *  exists in the delegation; if zero and `_delegate` does not exist, it will not be added.
     */
    function addReplaceDelegate(
        DelegationState storage _self, 
        address _delegate, 
        uint256 _bips
    ) internal {
        // Check for max delegation basis points
        assert(_bips <= MAX_BIPS);

        // Change the delegate's percentage
        _self.delegation.writeValue(_delegate, _bips);
        
        // check the total
        require(_self.delegation.totalValueAtNow() <= MAX_BIPS, MAX_BIPS_MSG);
    }

    /**
     * @notice Get the total of the explicit vote power delegation bips of all delegates at given block.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block to query.
     * @return _totalBips The total vote power bips delegated.
     */
    function getDelegatedTotalAt(
        DelegationState storage _self,
        uint256 _blockNumber
    ) internal view returns (uint256 _totalBips) {
        return _self.delegation.totalValueAt(_blockNumber);
    }

    /**
     * @notice Get the total of the explicit vote power delegation bips of all _delegates.
     * @param _self A DelegationState instance to manage.
     * @return _totalBips The total vote power bips delegated.
     */
    function getDelegatedTotal(
        DelegationState storage _self
    ) internal view returns (uint256 _totalBips) {
        return _self.delegation.totalValueAtNow();
    }

    /**
     * @notice Given a _delegate address, return the bips of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The delegate address to find.
     * @param _blockNumber The block to query.
     * @return _bips The percent of vote power allocated to the delegate address.
     */
    function getDelegatedValueAt(
        DelegationState storage _self, 
        address _delegate,
        uint256 _blockNumber
    ) internal view returns (uint256 _bips) {
        return _self.delegation.valueOfAt(_delegate, _blockNumber);
    }

    /**
     * @notice Given a delegate address, return the bips of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The delegate address to find.
     * @return _bips The percent of vote power allocated to the delegate address.
     */
    function getDelegatedValue(
        DelegationState storage _self, 
        address _delegate
    ) internal view returns (uint256 _bips) {
        return _self.delegation.valueOfAtNow(_delegate);
    }

    /**
     * @notice Returns lists of delegate addresses and corresponding values at given block.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block to query.
     * @return _delegates Positional array of delegation addresses.
     * @return _values Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function getDelegationsAt(
        DelegationState storage _self,
        uint256 _blockNumber
    ) internal view returns (
        address[] memory _delegates,
        uint256[] memory _values
    ) {
        return _self.delegation.delegationsAt(_blockNumber);
    }
    
    /**
     * @notice Returns lists of delegate addresses and corresponding values.
     * @param _self A DelegationState instance to manage.
     * @return _delegates Positional array of delegation addresses.
     * @return _values Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function getDelegations(
        DelegationState storage _self
    ) internal view returns (
        address[] memory _delegates,
        uint256[] memory _values
    ) {
        return _self.delegation.delegationsAtNow();
    }
    
    /**
     * @notice Clears all delegates.
     * @param _self A DelegationState instance to manage.
     * @dev Delegation mode remains PERCENTAGE, even though the delgation is now empty.
     */
    function clear(DelegationState storage _self) internal {
        _self.delegation.clear();
    }
}