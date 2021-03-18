// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {CheckPointable} from "./CheckPointable.sol";
import {Delegatable} from "./Delegatable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../lib/SafePct.sol";

/**
 * @title Vote Power Token
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block.
 **/
contract VPToken is ERC20, CheckPointable, Delegatable {
    using SafeMath for uint256;
    using SafePct for uint256;

    constructor(
        string memory name_, 
        string memory symbol_) ERC20(name_, symbol_) {
    }

    string constant private ALREADY_EXPLICIT_MSG = "Already delegated explicitly";
    string constant private ALREADY_PERCENT_MSG = "Already delegated by percentage";

    /**
     * @notice Delegate `pct` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent)
     **/
    function delegate(address to, uint16 bips) external override {
        // If a delegate cannot be added by percentage, revert.
        require(_canDelegateByPct(_msgSender()), ALREADY_EXPLICIT_MSG);

        // Get the current balance of sender and delegate by percentage to recipient
        _delegateByPercentage(to, balanceOf(_msgSender()), bips);
    }

    /**
     * @notice Delegate `pct` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param votePower An explicit votePower amount to be delegated
     **/    
    function delegateExplicit(address to, uint256 votePower) external override {
        // If a delegate cannot be added by amount, revert.
        require(_canDelegateByAmount(_msgSender()), ALREADY_PERCENT_MSG);

        _delegateByAmount(to, balanceOf(_msgSender()), votePower);
    }

    /**
     * @notice Compute the current undelegated vote power of `owner`
     * @param owner The address to get undelegated voting power.
     * @return votePower The unallocated vote power of `owner`
     */
    function undelegatedVotePowerOf(address owner) public view override returns(uint256 votePower) {
        return _undelegatedVotePowerOf(owner, balanceOf(owner));
    }

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external override {
        _undelegateAll(balanceOf(_msgSender()));
    }

    // Update vote power and balance checkpoints before balances are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(
        address from, 
        address to, 
        uint256 amount) internal virtual override(ERC20) {
          
        super._beforeTokenTransfer(from, to, amount);

        if (from == address(0)) {
            // mint new vote power
            _mintVotePower(to, amount);
            // mint checkpoint balance data for transferee
            _mintForAtNow(to, amount);
        } else if (to == address(0)) {
            // burn vote power
            _burnVotePower(from, balanceOf(from), amount);
            // burn checkpoint data for transferer
            _burnForAtNow(from, amount);
        } else {
            // transmit vote power to receiver
            _transmitVotePower(from, to, balanceOf(from), amount);
            // transfer checkpoint balance data
            _transmitAtNow(from, to, amount);
        }
    }
}