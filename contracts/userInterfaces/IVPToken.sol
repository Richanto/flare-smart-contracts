// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IGovernanceVotePower} from "./IGovernanceVotePower.sol";

interface IVPToken is IERC20 {
    /**
     * @notice Delegate by percentage `_bips` of voting power to `_to` from `msg.sender`.
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/
    function delegate(address _to, uint256 _bips) external;
    
    /**
     * @notice Explicitly delegate `_amount` of voting power to `_to` from `msg.sender`.
     * @param _to The address of the recipient
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cummulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(address _to, uint _amount) external;

    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    * @param _who Address of the delegatee
    * @param _blockNumber The block number at which to revoke delegation.
    */
    function revokeDelegationAt(address _who, uint _blockNumber) external;
    
    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     **/
    function undelegateAll() external;
    
    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(address[] memory _delegateAddresses) external returns (uint256);


    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() external view returns (uint8);
    

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `_blockNumber`
     **/
    function totalSupplyAt(uint _blockNumber) external view returns(uint256);

    /**
     * @dev Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number when the balance is queried.
     * @return The balance at `_blockNumber`.
     **/
    function balanceOfAt(address _owner, uint _blockNumber) external view returns (uint256);

    
    /**
     * @notice Get the current vote power.
     * @return The current vote power.
     */
    function votePower() external view returns(uint256);
    
    /**
    * @notice Get the vote power at block `_blockNumber`
    * @param _blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAt(uint _blockNumber) external view returns(uint256);

    /**
     * @notice Get the current vote power of `_owner`.
     * @param _owner The address to get voting power.
     * @return Current vote power of `_owner`.
     */
    function votePowerOf(address _owner) external view returns(uint256);
    
    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view returns(uint256);


    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value. Once the delegation mode is set, 
     *  it never changes, even if all delegations are removed.
     * @param _who The address to get delegation mode.
     * @return delegation mode: 0 = NOTSET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit)
     */
    function delegationModeOf(address _who) external view returns(uint256);
        
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return The delegated vote power.
    */
    function votePowerFromTo(address _from, address _to) external view returns(uint256);
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(address _from, address _to, uint _blockNumber) external view returns(uint256);
    
    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(address _owner) external view returns(uint256);
    
    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The undelegated vote power of `_owner` (= owner's own balance minus all delegations from owner)
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view returns(uint256);
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of `_who`. Returned in two separate positional arrays.
    * @param _who The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(address _who) external view returns (
        address[] memory _delegateAddresses,
        uint256[] memory _bips,
        uint256 _count, 
        uint256 _delegationMode);
        
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `_who`. Returned in two separate positional arrays.
    * @param _who The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(address _who, uint256 _blockNumber) external view returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips, 
        uint256 _count, 
        uint256 _delegationMode);

    /**
     * When set, allows token owners to participate in governance voting
     * and delegate governance vote power. 
     */
    function governanceVotePower() external view returns (IGovernanceVotePower);
}
