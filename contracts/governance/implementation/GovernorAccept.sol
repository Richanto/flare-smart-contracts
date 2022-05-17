// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./Governor.sol";
import "./GovernorAcceptSettings.sol";
import "../../utils/implementation/SafePct.sol";

contract GovernorAccept is Governor, GovernorAcceptSettings {

    using SafePct for uint256;

    mapping(uint256 => ProposalSettings) public proposalsSettings;

    /**
     * @notice Initializes the contract with default parameters
     * @param _governance                   Address identifying the governance address
     * @param _priceSubmitter               Address identifying the price submitter contract
     * @param _addressUpdater               Address identifying the address updater contract
     * @param _proposalSettings             Array of proposal settings in the following order
     *          proposalThresholdBIPS       Percentage in BIPS of the total vote power required to submit a proposal
     *          votingDelaySeconds          Voting delay in seconds
     *          votingPeriodSeconds         Voting period in seconds
     *          executionDelaySeconds       Execution delay in seconds
     *          executionPeriodSeconds      Execution period in seconds
     *          quorumThresholdBIPS         Percentage in BIPS of the total vote power required for proposal quorum
     *          _votePowerLifeTimeDays      Number of days after which checkpoint can be deleted
     *          _vpBlockPeriodDays          Period (in days) in which the vote power block is randomly 
     * @param _acceptanceThresholdBIPS      Percentage in BIPS of the total vote power required to accept a proposal
     */
    constructor(
        uint256[] memory _proposalSettings,
        address _governance,
        address _priceSubmitter,
        address _addressUpdater,
        uint256 _acceptanceThresholdBIPS
    )
        Governor(
            _proposalSettings,
            _governance,
            _priceSubmitter,
            _addressUpdater
        )
        GovernorAcceptSettings(
            _acceptanceThresholdBIPS
        )
    {}

    /**
     * @notice Stores some of the proposal settings (quorum threshold, acceptance threshold)
     * @param _proposalId             Id of the proposal
     */
    function _storeProposalSettings(uint256 _proposalId) internal override {
        ProposalSettings storage proposalSettings = proposalsSettings[_proposalId];
        
        proposalSettings.quorumThreshold = quorumThreshold();
        proposalSettings.acceptanceThreshold = acceptanceThreshold();

        emit ProposalSettingsAccept(
            _proposalId,
            proposals[_proposalId].votePowerBlock,
            proposalSettings.quorumThreshold,
            proposalSettings.acceptanceThreshold
        );
    }

    /**
     * @notice Determines if the submitter of a proposal is a valid proposer
     * @param _proposer             Address of the submitter
     * @param _votePowerBlock       Number representing the vote power block for which the validity is checked
     * @return True if the submitter is valid, and false otherwise
     */
    function _isValidProposer(address _proposer, uint256 _votePowerBlock) internal view override returns (bool) {
        return _hasVotePowerToPropose(_proposer, _votePowerBlock);
    }

    /**
     * @notice Determines if a proposal has been successful
     * @param _proposalId           Id of the proposal
     * @param _proposalTotalVP      Total vote power of the proposal
     * @return True if proposal succeeded and false otherwise
     */
    function _proposalSucceeded(uint256 _proposalId, uint256 _proposalTotalVP) internal view override returns (bool) {
        ProposalVoting storage voting = proposalVotings[_proposalId];
        ProposalSettings storage proposalSettings = proposalsSettings[_proposalId];

        if (voting.abstainVotePower + voting.againstVotePower + voting.forVotePower <
            proposalSettings.quorumThreshold.mulDiv(_proposalTotalVP, BIPS)) {
            return false;
        }

        if (voting.forVotePower < proposalSettings.acceptanceThreshold.mulDiv(_proposalTotalVP, BIPS)) {
            return false;
        }

        return true;
    }

    /**
     * @notice Returns the name of the governor contract
     * @return String representing the name
     */
    function _name() internal pure override returns (string memory) {
        return "GovernorAccept";
    }

    /**
     * @notice Returns the version of the governor contract
     * @return String representing the version
     */
    function _version() internal pure override returns (string memory) {
        return "1";
    }

}
