// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIFtsoManager.sol";
import "../interface/IIFtsoManagerV1.sol";
import "../interface/IIFtso.sol";
import "../lib/FtsoManagerSettings.sol";
import "../../genesis/implementation/FlareDaemon.sol";
import "../../genesis/interface/IIPriceSubmitter.sol";
import "../../governance/implementation/Governed.sol";
import "../../inflation/interface/IISupply.sol";
import "../../tokenPools/interface/IIFtsoRewardManager.sol";
import "../../token/implementation/CleanupBlockNumberManager.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../utils/implementation/RevertErrorTracking.sol";
import "../../utils/interface/IIFtsoRegistry.sol";
import "../../utils/interface/IIVoterWhitelister.sol";



/**
 * FtsoManager is in charge of:
 * - defining reward epochs (few days)
 * - per reward epoch choose a single block that represents vote power of this epoch.
 * - keep track of all FTSO contracts
 * - per price epoch (few minutes)
 *    - randomly choose one FTSO for rewarding.
 *    - trigger finalize price reveal epoch
 *    - determines addresses and reward weights and triggers rewardDistribution
 */    
//solhint-disable-next-line max-states-count
contract FtsoManager is IIFtsoManager, GovernedAndFlareDaemonized, AddressUpdatable, RevertErrorTracking {
    using FtsoManagerSettings for FtsoManagerSettings.State;

    uint256 public constant MAX_TRUSTED_ADDRESSES_LENGTH = 5;

    string internal constant ERR_FIRST_EPOCH_START_TS_IN_FUTURE = "First epoch start ts in future";
    string internal constant ERR_REWARD_EPOCH_DURATION_ZERO = "Reward epoch 0";
    string internal constant ERR_REWARD_EPOCH_START_TOO_SOON = "Reward epoch start too soon";
    string internal constant ERR_REWARD_EPOCH_NOT_INITIALIZED = "Reward epoch not initialized yet";
    string internal constant ERR_REWARD_EPOCH_START_CONDITION_INVALID = "Reward epoch start condition invalid";
    string internal constant ERR_REWARD_EPOCH_DURATION_CONDITION_INVALID = "Reward epoch duration condition invalid";
    string internal constant ERR_PRICE_EPOCH_DURATION_ZERO = "Price epoch 0";
    string internal constant ERR_VOTE_POWER_INTERVAL_FRACTION_ZERO = "Vote power interval fraction 0";
    string internal constant ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO = "Reveal price epoch 0";
    string internal constant ERR_REVEAL_PRICE_EPOCH_TOO_LONG = "Reveal price epoch too long";
    string internal constant ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized";
    string internal constant ERR_GOV_PARAMS_INVALID = "Gov. params invalid";
    string internal constant ERR_ASSET_FTSO_NOT_MANAGED = "Asset FTSO not managed";
    string internal constant ERR_NOT_FOUND = "Not found";
    string internal constant ERR_ALREADY_ADDED = "Already added";
    string internal constant ERR_ALREADY_ACTIVATED = "Already activated";
    string internal constant ERR_FTSO_ASSET_FTSO_ZERO = "Asset ftsos list empty";
    string internal constant ERR_FTSO_EQUALS_ASSET_FTSO = "ftso equals asset ftso";
    string internal constant ERR_CLOSING_EXPIRED_REWARD_EPOCH_FAIL = "err close expired";
    string internal constant ERR_SET_CLEANUP_BLOCK_FAIL = "err set cleanup block";
    string internal constant ERR_PRICE_EPOCH_FINALIZE_FAIL = "err finalize price epoch";
    string internal constant ERR_DISTRIBUTE_REWARD_FAIL = "err distribute rewards";
    string internal constant ERR_ACCRUE_UNEARNED_REWARD_FAIL = "err accrue unearned rewards";
    string internal constant ERR_FALLBACK_FINALIZE_FAIL = "err fallback finalize price epoch";
    string internal constant ERR_INIT_EPOCH_REVEAL_FAIL = "err init epoch for reveal";
    string internal constant ERR_FALLBACK_INIT_EPOCH_REVEAL_FAIL = "err fallback init epoch for reveal";

    bool public override active;
    mapping(uint256 => RewardEpochData) internal rewardEpochsMapping;
    address public lastRewardedFtsoAddress;
    uint256 internal rewardEpochsLength;
    uint256 public override currentRewardEpochEnds;

    FtsoManagerSettings.State internal settings;

    // price epoch data
    uint256 internal immutable firstPriceEpochStartTs;
    uint256 internal immutable priceEpochDurationSeconds;
    uint256 internal immutable revealEpochDurationSeconds;
    uint256 internal lastUnprocessedPriceEpoch;
    uint256 internal lastUnprocessedPriceEpochRevealEnds;
    // indicates if lastUnprocessedPriceEpoch is initialized for reveal
    // it has to be finalized before new reward epoch can start
    bool internal lastUnprocessedPriceEpochInitialized;

    // reward Epoch data
    uint256 internal immutable firstRewardEpochStartTs;
    uint256 internal rewardEpochDurationSeconds;
    uint256 internal votePowerIntervalFraction;
    uint256 internal nextRewardEpochToExpire;

    mapping(IIFtso => bool) public managedFtsos;
    mapping(IIFtso => bool) public override notInitializedFtsos;

    IIPriceSubmitter public immutable priceSubmitter;
    IIFtsoRewardManager internal ftsoRewardManager;
    IIFtsoRegistry internal ftsoRegistry;
    IIVoterWhitelister internal voterWhitelister;
    IISupply internal supply;
    CleanupBlockNumberManager internal cleanupBlockNumberManager;

    // fallback mode
    bool internal fallbackMode; // all ftsos in fallback mode
    mapping(IIFtso => bool) internal ftsoInFallbackMode;

    // for redeploy
    IIFtsoManagerV1 public immutable oldFtsoManager;

    constructor(
        address _governance,
        FlareDaemon _flareDaemon,
        address _addressUpdater,
        IIPriceSubmitter _priceSubmitter,
        IIFtsoManagerV1 _oldFtsoManager,
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSeconds,
        uint256 _revealEpochDurationSeconds,
        uint256 _firstRewardEpochStartTs,
        uint256 _rewardEpochDurationSeconds,
        uint256 _votePowerIntervalFraction
    ) 
        GovernedAndFlareDaemonized(_governance, _flareDaemon) AddressUpdatable(_addressUpdater)
    {
        require(block.timestamp >= _firstPriceEpochStartTs, ERR_FIRST_EPOCH_START_TS_IN_FUTURE);
        require(_rewardEpochDurationSeconds > 0, ERR_REWARD_EPOCH_DURATION_ZERO);
        require(_priceEpochDurationSeconds > 0, ERR_PRICE_EPOCH_DURATION_ZERO);
        require(_revealEpochDurationSeconds > 0, ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO);
        require(_votePowerIntervalFraction > 0, ERR_VOTE_POWER_INTERVAL_FRACTION_ZERO);

        require(_revealEpochDurationSeconds < _priceEpochDurationSeconds, ERR_REVEAL_PRICE_EPOCH_TOO_LONG);
        require(_firstPriceEpochStartTs + _revealEpochDurationSeconds <= _firstRewardEpochStartTs, 
            ERR_REWARD_EPOCH_START_TOO_SOON);
        require((_firstRewardEpochStartTs - _revealEpochDurationSeconds - _firstPriceEpochStartTs) %
            _priceEpochDurationSeconds == 0, ERR_REWARD_EPOCH_START_CONDITION_INVALID);
        require(_rewardEpochDurationSeconds % _priceEpochDurationSeconds == 0,
            ERR_REWARD_EPOCH_DURATION_CONDITION_INVALID);

        // reward epoch
        firstRewardEpochStartTs = _firstRewardEpochStartTs;
        rewardEpochDurationSeconds = _rewardEpochDurationSeconds;
        votePowerIntervalFraction = _votePowerIntervalFraction;

        // price epoch
        firstPriceEpochStartTs = _firstPriceEpochStartTs;
        priceEpochDurationSeconds = _priceEpochDurationSeconds;
        revealEpochDurationSeconds = _revealEpochDurationSeconds;
        lastUnprocessedPriceEpochRevealEnds = _firstRewardEpochStartTs;
        lastUnprocessedPriceEpoch = (_firstRewardEpochStartTs - _firstPriceEpochStartTs) / _priceEpochDurationSeconds;

        priceSubmitter = _priceSubmitter;
        oldFtsoManager = _oldFtsoManager;
    }

    /**
     * @notice Set reward data to values from old ftso manager
     * @dev Can be called only before activation
     */
    function setInitialRewardData(
        uint256 _nextRewardEpochToExpire,
        uint256 _rewardEpochsLength,
        uint256 _currentRewardEpochEnds
    ) 
        external override
        onlyGovernance
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        nextRewardEpochToExpire = _nextRewardEpochToExpire;
        rewardEpochsLength = _rewardEpochsLength;
        currentRewardEpochEnds = _currentRewardEpochEnds;
    }
    
    /**
     * @notice Activates FTSO manager (daemonize() runs jobs)
     */
    function activate() external override onlyGovernance {
        active = true;
    }

    /**
     * @notice Runs task triggered by Daemon.
     * The tasks include the following by priority
     * - finalizePriceEpoch     
     * - Set governance parameters and initialize epochs
     * - finalizeRewardEpoch 
     */
    function daemonize() external override onlyFlareDaemon returns (bool) {
        // flare daemon trigger. once every block
        if (!active) return false;

        if (rewardEpochsLength == 0) {
            _initializeFirstRewardEpoch();
        } else {
            // all three conditions can be executed in the same block,
            // but are split into three `if else if` groups to reduce gas usage per one block
            if (lastUnprocessedPriceEpochInitialized && lastUnprocessedPriceEpochRevealEnds <= block.timestamp) {
                // finalizes initialized price epoch if reveal period is over
                // sets lastUnprocessedPriceEpochInitialized = false
                _finalizePriceEpoch();
            } else if (!lastUnprocessedPriceEpochInitialized && currentRewardEpochEnds <= block.timestamp) {
                // initialized price epoch must be finalized before new reward epoch can start
                // advance currentRewardEpochEnds
                _finalizeRewardEpoch();
                _closeExpiredRewardEpochs();
                _cleanupOnRewardEpochFinalization();
            } else if (lastUnprocessedPriceEpochRevealEnds <= block.timestamp) {
                // new price epoch can be initialized after previous was finalized 
                // and after new reward epoch was started (if needed)
                // initializes price epoch and sets governance parameters on ftsos and price submitter
                // advance lastUnprocessedPriceEpochRevealEnds, sets lastUnprocessedPriceEpochInitialized = true
                _initializeCurrentEpochFTSOStatesForReveal(); 
            }
        }
        return true;
    }

    /**
     * @notice Called if out of gas or any other unknown error occures in flare daemonize call
     */
    function switchToFallbackMode() external override onlyFlareDaemon returns (bool) {
        if (!fallbackMode) {
            fallbackMode = true;
            emit FallbackMode(true);
            return true;
        }
        return false;
    }

     /**
     * @notice Adds FTSO to the list of rewarded FTSOs
     * All ftsos in multi asset ftso must be managed by this ftso manager
     */
    function addFtso(IIFtso _ftso) external override onlyGovernance {
        _addFtso(_ftso, true);
    }

    /**
     * @notice Adds FTSO list to the list of rewarded FTSOs
     * All ftsos in multi asset ftso must be managed by this ftso manager
     */
    function addFtsosBulk(IIFtso[] memory _ftsos) external override onlyGovernance {
        for (uint256 i = 0; i < _ftsos.length; i++) {
            _addFtso(_ftsos[i], true);
        }
    }

    /**
     * @notice Removes FTSO from the list of the rewarded FTSOs - revert if ftso is used in multi asset ftso
     * @dev Deactivates _ftso
     */
    function removeFtso(IIFtso _ftso) external override onlyGovernance {
        uint256 ftsoIndex = ftsoRegistry.getFtsoIndex(_ftso.symbol());
        voterWhitelister.removeFtso(ftsoIndex);
        ftsoRegistry.removeFtso(_ftso);
        _cleanFtso(_ftso);
    }
    
    /**
     * @notice Replaces one ftso with another
     * All ftsos in multi asset ftso must be managed by this ftso manager
     * @dev Deactivates old ftso
     */
    function replaceFtso(
        IIFtso _ftsoToAdd,
        bool _copyCurrentPrice,
        bool _copyAssetOrAssetFtsos
    )
        external override
        onlyGovernance
    {
        _replaceFtso(_ftsoToAdd, _copyCurrentPrice, _copyAssetOrAssetFtsos);
    }

    /**
     * @notice Bulk replaces one ftso with another
     * All ftsos in multi asset ftso must be managed by this ftso manager
     * @dev Deactivates old ftsos
     */
    function replaceFtsosBulk(
        IIFtso[] memory _ftsosToAdd,
        bool _copyCurrentPrice,
        bool _copyAssetOrAssetFtsos
    )
        external override
        onlyGovernance
    {
        for (uint256 i = 0; i < _ftsosToAdd.length; i++) {
            _replaceFtso(_ftsosToAdd[i], _copyCurrentPrice, _copyAssetOrAssetFtsos);
        }
    }

    /**
     * @notice Deactivates ftsos that are no longer used on ftso registry
     */
    function deactivateFtsos(IIFtso[] memory _ftsos) external onlyGovernance {
        uint256 len = _ftsos.length;
        while(len > 0) {
            len--;
            IIFtso ftso = _ftsos[len];
            try ftsoRegistry.getFtsoBySymbol(ftso.symbol()) returns (IIFtso _ftso) {
                if (_ftso != ftso) {
                    // deactivate ftso if it was already replaced on ftso registry
                    ftso.deactivateFtso();
                    delete ftsoInFallbackMode[ftso];
                    delete notInitializedFtsos[ftso];
                    delete managedFtsos[ftso];
                } else {
                    // ftso still in use on ftso registy - it could be removed using removeFtso call
                    emit FtsoDeactivationFailed(ftso);
                }
            } catch {
                // deactivate ftso if ftso symbol is not used anymore on ftso registry
                ftso.deactivateFtso();
                delete ftsoInFallbackMode[ftso];
                delete notInitializedFtsos[ftso];
                delete managedFtsos[ftso];
            }
        }
    }
    
    /**
     * @notice Set asset for FTSO
     */
    function setFtsoAsset(IIFtso _ftso, IIVPToken _asset) external override onlyGovernance {
        _ftso.setAsset(_asset);
    }

    /**
     * @notice Set asset FTSOs for FTSO - all ftsos should already be managed by this ftso manager
     */
    function setFtsoAssetFtsos(IIFtso _ftso, IIFtso[] memory _assetFtsos) external override onlyGovernance {
        uint256 len = _assetFtsos.length;
        require(len > 0, ERR_FTSO_ASSET_FTSO_ZERO);
        for (uint256 i = 0; i < len; i++) {
            if (_ftso == _assetFtsos[i]) {
                revert(ERR_FTSO_EQUALS_ASSET_FTSO);
            }
        }

        if (managedFtsos[_ftso]) {
            _checkAssetFtsosAreManaged(_assetFtsos);
        }
        _ftso.setAssetFtsos(_assetFtsos);
    }

    /**
     * @notice Set fallback mode
     */
    function setFallbackMode(bool _fallbackMode) external override onlyGovernance {
        fallbackMode = _fallbackMode;
        emit FallbackMode(_fallbackMode);
    }

    /**
     * @notice Set fallback mode for ftso
     */
    function setFtsoFallbackMode(IIFtso _ftso, bool _fallbackMode) external override onlyGovernance {
        require(managedFtsos[_ftso], ERR_NOT_FOUND);
        ftsoInFallbackMode[_ftso] = _fallbackMode;
        emit FtsoFallbackMode(_ftso, _fallbackMode);
    }

    /**
     * @notice Sets governance parameters for FTSOs
     */
    function setGovernanceParameters(
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    )
        external override onlyGovernance 
    {
        require(
            _maxVotePowerNatThresholdFraction > 0 &&
            _maxVotePowerAssetThresholdFraction > 0 &&
            _highAssetUSDThreshold >= _lowAssetUSDThreshold &&
            _highAssetTurnoutThresholdBIPS <= 1e4 &&
            _lowNatTurnoutThresholdBIPS <= 1e4 &&
            _rewardExpiryOffsetSeconds > 0 &&
            _trustedAddresses.length <= MAX_TRUSTED_ADDRESSES_LENGTH,
            ERR_GOV_PARAMS_INVALID
        );
        
        settings._setState(
            _maxVotePowerNatThresholdFraction,
            _maxVotePowerAssetThresholdFraction,
            _lowAssetUSDThreshold,
            _highAssetUSDThreshold,
            _highAssetTurnoutThresholdBIPS,
            _lowNatTurnoutThresholdBIPS,
            _rewardExpiryOffsetSeconds,
            _trustedAddresses
        );
    }

    function setRewardEpochDurationSeconds(uint256 _rewardEpochDurationSeconds) external onlyGovernance {
        require(_rewardEpochDurationSeconds > 0, ERR_REWARD_EPOCH_DURATION_ZERO);
        require(_rewardEpochDurationSeconds % priceEpochDurationSeconds == 0,
            ERR_REWARD_EPOCH_DURATION_CONDITION_INVALID);
        rewardEpochDurationSeconds = _rewardEpochDurationSeconds;
    }

    function setVotePowerIntervalFraction(uint256 _votePowerIntervalFraction) external onlyGovernance {
        require(_votePowerIntervalFraction > 0, ERR_VOTE_POWER_INTERVAL_FRACTION_ZERO);
        votePowerIntervalFraction = _votePowerIntervalFraction;
    }

    function getVotePowerIntervalFraction() external view returns (uint256) {
        return votePowerIntervalFraction;
    }

    function getFtsoRewardManager() external view returns (IIFtsoRewardManager) {
        return ftsoRewardManager;
    }

    function getFtsoRegistry() external view returns (IIFtsoRegistry) {
        return ftsoRegistry;
    }

    function getVoterWhitelister() external view returns (IIVoterWhitelister) {
        return voterWhitelister;
    }

    function getSupply() external view returns (IISupply) {
        return supply;
    }

    function getCleanupBlockNumberManager() external view returns (CleanupBlockNumberManager) {
        return cleanupBlockNumberManager;
    }

    /**
     * @dev half-closed intervals - end time not included
     */
    function getCurrentPriceEpochData() external view override 
        returns (
            uint256 priceEpochId,
            uint256 priceEpochStartTimestamp,
            uint256 priceEpochEndTimestamp,
            uint256 priceEpochRevealEndTimestamp,
            uint256 currentTimestamp
        )
    {
        uint256 epochId = _getCurrentPriceEpochId();
        return (
            epochId,
            firstPriceEpochStartTs + epochId * priceEpochDurationSeconds,
            firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSeconds,
            firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSeconds + revealEpochDurationSeconds,
            block.timestamp
        );
    }
    
    /**
     * @notice Gets vote power block of the specified reward epoch
     * @param _rewardEpoch          Reward epoch sequence number
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view override 
        returns (
            uint256 _votepowerBlock
        )
    {
        return getRewardEpochData(_rewardEpoch).votepowerBlock;
    }

    /**
     * @notice Return reward epoch that will expire, when new reward epoch is initialized
     * @return Reward epoch id that will expire next
     */
    function getRewardEpochToExpireNext() external view override returns (uint256) {
        return nextRewardEpochToExpire;
    }

    /*
     * @notice Returns the list of FTSOs
     */
    function getFtsos() external view override returns (IIFtso[] memory _ftsos) {
        return _getFtsos();
    }

    function getPriceEpochConfiguration() external view override 
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        )
    {
        return (firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);
    }

    function getRewardEpochConfiguration() external view override
        returns (
            uint256 _firstRewardEpochStartTs,
            uint256 _rewardEpochDurationSeconds
        )
    {
        return (firstRewardEpochStartTs, rewardEpochDurationSeconds);
    }

    function getFallbackMode() external view override
        returns (
            bool _fallbackMode,
            IIFtso[] memory _ftsos,
            bool[] memory _ftsoInFallbackMode
        )
    {
        _fallbackMode = fallbackMode;
        _ftsos = _getFtsos();
        uint256 len = _ftsos.length;
        _ftsoInFallbackMode = new bool[](len);
        
        for (uint256 i = 0; i < len; i++) {
            _ftsoInFallbackMode[i] = ftsoInFallbackMode[_ftsos[i]];
        }
    }

    /**
     * @notice Gets governance parameters for FTSOs
     */
    function getGovernanceParameters() external view 
        returns (
            uint256 _maxVotePowerNatThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowNatTurnoutThresholdBIPS,
            uint256 _rewardExpiryOffsetSeconds,
            address[] memory _trustedAddresses,
            bool _initialized,
            bool _changed
        )
    {
        return (
            settings.maxVotePowerNatThresholdFraction,
            settings.maxVotePowerAssetThresholdFraction,
            settings.lowAssetUSDThreshold,
            settings.highAssetUSDThreshold,
            settings.highAssetTurnoutThresholdBIPS,
            settings.lowNatTurnoutThresholdBIPS,
            settings.rewardExpiryOffsetSeconds,
            settings.trustedAddresses,
            settings.initialized,
            settings.changed
        );
    }

    function getLastUnprocessedPriceEpochData() external view override
        returns (
            uint256 _lastUnprocessedPriceEpoch,
            uint256 _lastUnprocessedPriceEpochRevealEnds,
            bool _lastUnprocessedPriceEpochInitialized
        )
    {
        return (lastUnprocessedPriceEpoch, lastUnprocessedPriceEpochRevealEnds, lastUnprocessedPriceEpochInitialized);
    }
            
    /**
     * @notice Returns current reward epoch index (one currently running)
     */
    function getCurrentRewardEpoch() external view override returns (uint256) {
        require(rewardEpochsLength != 0, ERR_REWARD_EPOCH_NOT_INITIALIZED);
        return _getCurrentRewardEpochId();
    }
    
    /**
     * @notice Implement this function for updating daemonized contracts through AddressUpdater.
     */
    function getContractName() external pure override returns (string memory) {
        return "FtsoManager";
    }

    /**
     * @notice Returns reward epoch data
     * @param _rewardEpochId        Reward epoch id
     */
    function getRewardEpochData(uint256 _rewardEpochId) public view override returns (RewardEpochData memory) {
        require(_rewardEpochId < rewardEpochsLength, ERR_REWARD_EPOCH_NOT_INITIALIZED);
        return _getRewardEpoch(_rewardEpochId);
    }

    function _addFtso(IIFtso _ftso, bool _addNewFtso) internal {
        require(settings.initialized, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);

        _checkAssetFtsosAreManaged(_ftso.getAssetFtsos());

        if (_addNewFtso) {
            // Check if symbol already exists in registry
            bytes32 symbol = keccak256(abi.encode(_ftso.symbol()));
            string[] memory supportedSymbols = ftsoRegistry.getSupportedSymbols();
            uint256 len = supportedSymbols.length;
            while (len > 0) {
                --len;
                if (keccak256(abi.encode(supportedSymbols[len])) == symbol) {
                    revert(ERR_ALREADY_ADDED);
                }
            }
        }

        _ftso.activateFtso(firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);

        // Set the vote power block
        if (rewardEpochsLength != 0) {
            _ftso.setVotePowerBlock(_getRewardEpoch(_getCurrentRewardEpochId()).votepowerBlock);
        }

        // Configure 
        _ftso.configureEpochs(
            settings.maxVotePowerNatThresholdFraction,
            settings.maxVotePowerAssetThresholdFraction,
            settings.lowAssetUSDThreshold,
            settings.highAssetUSDThreshold,
            settings.highAssetTurnoutThresholdBIPS,
            settings.lowNatTurnoutThresholdBIPS,
            settings.trustedAddresses
        );
        
        // skip first round of price finalization if price epoch was already initialized for reveal
        notInitializedFtsos[_ftso] = lastUnprocessedPriceEpochInitialized;
        managedFtsos[_ftso] = true;
        uint256 ftsoIndex = ftsoRegistry.addFtso(_ftso);

        // When a new ftso is added we also add it to the voter whitelister contract
        if (_addNewFtso) {
            voterWhitelister.addFtso(ftsoIndex);
        }
        
        emit FtsoAdded(_ftso, true);
    }

    /**
     * @notice Replaces one ftso with another - symbols must match
     * All ftsos in multi asset ftso must be managed by this ftso manager
     * @dev Deactivates old ftso
     */
    function _replaceFtso(
        IIFtso _ftsoToAdd,
        bool _copyCurrentPrice,
        bool _copyAssetOrAssetFtsos
    )
        internal
    {
        IIFtso ftsoToRemove = ftsoRegistry.getFtsoBySymbol(_ftsoToAdd.symbol());

        if (_copyCurrentPrice) {
            (uint256 currentPrice, uint256 timestamp) = ftsoToRemove.getCurrentPrice();
            _ftsoToAdd.updateInitialPrice(currentPrice, timestamp);
        }

        if (_copyAssetOrAssetFtsos) {
            IIVPToken asset = ftsoToRemove.getAsset();
            if (address(asset) != address(0)) { // copy asset if exists
                _ftsoToAdd.setAsset(asset);
            } else { // copy assetFtsos list if not empty
                IIFtso[] memory assetFtsos = ftsoToRemove.getAssetFtsos();
                if (assetFtsos.length > 0) {
                    _ftsoToAdd.setAssetFtsos(assetFtsos);
                }
            }
        }
        // Add without duplicate check
        _addFtso(_ftsoToAdd, false);
        
        // replace old contract with the new one in multi asset ftsos
        IIFtso[] memory contracts = _getFtsos();

        uint256 ftsosLen = contracts.length;
        for (uint256 i = 0; i < ftsosLen; i++) {
            IIFtso ftso = contracts[i];
            if (ftso.ftsoManager() != address(this)) { // it cannot be updated and will be replaced
                continue;
            }
            IIFtso[] memory assetFtsos = ftso.getAssetFtsos();
            uint256 assetFtsosLen = assetFtsos.length;
            if (assetFtsosLen > 0) {
                bool changed = false;
                for (uint256 j = 0; j < assetFtsosLen; j++) {
                    if (assetFtsos[j] == ftsoToRemove) {
                        assetFtsos[j] = _ftsoToAdd;
                        changed = true;
                    }
                }
                if (changed) {
                    ftso.setAssetFtsos(assetFtsos);
                }
            }
        }

        // cleanup old contract
        _cleanFtso(ftsoToRemove);
    }

    function _cleanFtso(IIFtso _ftso) internal {
        // Since this is as mapping, we can also just delete it, as false is default value for non-existing keys
        delete ftsoInFallbackMode[_ftso];
        delete notInitializedFtsos[_ftso];
        delete managedFtsos[_ftso];

        // may fail if not managed by current ftso manager (can happen in redeploy)
        if (_ftso.ftsoManager() == address(this)) {
            _ftso.deactivateFtso();
            _checkMultiAssetFtsosAreManaged(_getFtsos());
        } else {
            // do nothing, old ftso not deactivated, but actually it is not a problem, just emit an event
            emit FtsoDeactivationFailed(_ftso);
        }
        emit FtsoAdded(_ftso, false);
    }

    /**
     * @notice Initializes first reward epoch. Also sets vote power block to FTSOs
     */
    function _initializeFirstRewardEpoch() internal {

        if (block.timestamp >= firstRewardEpochStartTs) {
            IIFtso[] memory ftsos = _getFtsos();
            uint256 numFtsos = ftsos.length;
            // Prime the reward epoch array with a new reward epoch
            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - 1,
                startBlock: block.number,
                startTimestamp: block.timestamp
            });

            rewardEpochsMapping[rewardEpochsLength] = epochData;
            rewardEpochsLength++;

            for (uint256 i = 0; i < numFtsos; ++i) {
                ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
            }
            
            currentRewardEpochEnds = firstRewardEpochStartTs + rewardEpochDurationSeconds;
        }
    }

    /**
     * @notice Finalizes reward epoch
     */
    function _finalizeRewardEpoch() internal {
        IIFtso[] memory ftsos = _getFtsos();
        uint256 numFtsos = ftsos.length;

        uint256 lastRandom = block.timestamp;
        for (uint256 i = 0; i < numFtsos; ++i) {
            lastRandom += ftsos[i].getCurrentRandom();
        }

        lastRandom = uint256(keccak256(abi.encode(lastRandom)));
        // @dev when considering block boundary for vote power block:
        // - if far from now, it doesn't reflect last vote power changes
        // - if too small, possible loan attacks.     
        // IMPORTANT: currentRewardEpoch is actually the one just getting finalized!
        uint256 votepowerBlockBoundary = 
            (block.number - _getRewardEpoch(_getCurrentRewardEpochId()).startBlock) / votePowerIntervalFraction;
        // note: votePowerIntervalFraction > 0
 
        if (votepowerBlockBoundary == 0) {
            votepowerBlockBoundary = 1;
        }
 
        //slither-disable-next-line weak-prng           // lastRandom calculated from ftso inputs
        uint256 votepowerBlocksAgo = lastRandom % votepowerBlockBoundary;
        // prevent block.number becoming votePowerBlock
        // if  lastRandom % votepowerBlockBoundary == 0  
        if (votepowerBlocksAgo == 0) {
            votepowerBlocksAgo = 1;
        }
        
        RewardEpochData memory epochData = RewardEpochData({
            votepowerBlock: block.number - votepowerBlocksAgo, 
            startBlock: block.number,
            startTimestamp: block.timestamp
        });
        rewardEpochsMapping[rewardEpochsLength] = epochData;
        rewardEpochsLength++;
        for (uint256 i = 0; i < numFtsos; i++) {
            ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
        }

        emit RewardEpochFinalized(epochData.votepowerBlock, epochData.startBlock);

        // Advance reward epoch end-time
        currentRewardEpochEnds += rewardEpochDurationSeconds;
    }

    /**
     * @notice Closes expired reward epochs
     */
    function _closeExpiredRewardEpochs() internal {
        uint256 currentRewardEpoch = _getCurrentRewardEpochId();
        uint256 expiryThreshold = block.timestamp - settings.rewardExpiryOffsetSeconds;
        // NOTE: start time of (i+1)th reward epoch is the end time of i-th  
        // This loop is clearly bounded by the value currentRewardEpoch, which is
        // always kept to the value of rewardEpochs.length - 1 in code and this value
        // does not change in the loop.
        while (
            nextRewardEpochToExpire < currentRewardEpoch && 
            _getRewardEpoch(nextRewardEpochToExpire + 1).startTimestamp <= expiryThreshold) 
        {   // Note: Since nextRewardEpochToExpire + 1 starts at that time
            // nextRewardEpochToExpire ends strictly before expiryThreshold, 
            try ftsoRewardManager.closeExpiredRewardEpoch(nextRewardEpochToExpire) {
                nextRewardEpochToExpire++;
            } catch Error(string memory message) {
                // closing of expired failed, which is not critical
                // just emit event for diagnostics
                emit ClosingExpiredRewardEpochFailed(nextRewardEpochToExpire);
                addRevertError(address(ftsoRewardManager), message);
                // Do not proceed with the loop.
                break;
            } catch {
                emit ClosingExpiredRewardEpochFailed(nextRewardEpochToExpire);
                addRevertError(address(ftsoRewardManager), ERR_CLOSING_EXPIRED_REWARD_EPOCH_FAIL);
                // Do not proceed with the loop.
                break;
            }
        }
    }

    /**
     * @notice Performs any cleanup needed immediately after a reward epoch is finalized
     */
    function _cleanupOnRewardEpochFinalization() internal {

        uint256 cleanupBlock = _getRewardEpoch(nextRewardEpochToExpire).votepowerBlock;
        
        try cleanupBlockNumberManager.setCleanUpBlockNumber(cleanupBlock) {
        } catch Error(string memory message) {
            // cleanup block number manager call failed, which is not critical
            // just emit event for diagnostics
            emit CleanupBlockNumberManagerFailedForBlock(cleanupBlock);
            addRevertError(address(cleanupBlockNumberManager), message);
        } catch {
            emit CleanupBlockNumberManagerFailedForBlock(cleanupBlock);
            addRevertError(address(cleanupBlockNumberManager), ERR_SET_CLEANUP_BLOCK_FAIL);
        }
    }

    function _finalizePriceEpochFailed(IIFtso ftso, string memory message) internal {
        emit FinalizingPriceEpochFailed(
            ftso, 
            lastUnprocessedPriceEpoch, 
            IFtso.PriceFinalizationType.WEIGHTED_MEDIAN
        );

        addRevertError(address(ftso), message);

        _fallbackFinalizePriceEpoch(ftso);
    }

    /**
     * @notice Finalizes price epoch
     */
    function _finalizePriceEpoch() internal {
        IIFtso[] memory ftsos = _getFtsos();
        uint256 numFtsos = ftsos.length;

        // Are there any FTSOs to process?
        if (numFtsos > 0 && !fallbackMode) {
            // choose winning ftso
            uint256 chosenFtsoId;
            if (lastRewardedFtsoAddress == address(0)) {
                // pump not yet primed
                //slither-disable-next-line weak-prng           // only used for first epoch
                chosenFtsoId = uint256(keccak256(abi.encode(
                        block.difficulty, block.timestamp
                    ))) % numFtsos;
            } else {
                // at least one finalize with real FTSO
                uint256 currentRandomSum = 0;
                for (uint256 i = 0; i < numFtsos; i++) {
                    currentRandomSum += ftsos[i].getCurrentRandom(); // may overflow but it is still ok
                }
                //slither-disable-next-line weak-prng           // ftso random calculated safely from inputs
                chosenFtsoId = uint256(keccak256(abi.encode(
                        currentRandomSum, block.timestamp
                    ))) % numFtsos;
            }
            address[] memory addresses;
            uint256[] memory weights;
            uint256 totalWeight;

            // On the off chance that the winning FTSO does not have any
            // recipient within the truncated price distribution to
            // receive rewards, find the next FTSO that does have reward
            // recipients and declare it the winner. Start with the next ftso.
            bool wasDistributed = false;
            address rewardedFtsoAddress = address(0);
            for (uint256 i = 0; i < numFtsos; i++) {
                //slither-disable-next-line weak-prng           // not a random, just choosing next
                uint256 id = (chosenFtsoId + i) % numFtsos;
                IIFtso ftso = ftsos[id];

                // skip finalizing ftso, as it is not initialized for reveal and tx would revert
                if (notInitializedFtsos[ftso]) {
                    delete notInitializedFtsos[ftso];
                    continue;
                }

                try ftso.finalizePriceEpoch(lastUnprocessedPriceEpoch, !wasDistributed) returns (
                    address[] memory _addresses,
                    uint256[] memory _weights,
                    uint256 _totalWeight
                ) {
                    if (!wasDistributed && _addresses.length > 0) { // change also in FTSO if condition changes
                        (addresses, weights, totalWeight) = (_addresses, _weights, _totalWeight);
                        wasDistributed = true;
                        rewardedFtsoAddress = address(ftso);
                    }
                } catch Error(string memory message) {
                    _finalizePriceEpochFailed(ftso, message);
                } catch {
                    _finalizePriceEpochFailed(ftso, ERR_PRICE_EPOCH_FINALIZE_FAIL);
                }
            }

            uint256 currentRewardEpoch = _getCurrentRewardEpochId();

            if (wasDistributed) {
                try ftsoRewardManager.distributeRewards(
                    addresses,
                    weights,
                    totalWeight,
                    lastUnprocessedPriceEpoch,
                    rewardedFtsoAddress,
                    priceEpochDurationSeconds,
                    currentRewardEpoch,
                    _getPriceEpochEndTime(lastUnprocessedPriceEpoch) - 1, // actual end time (included)
                    _getRewardEpoch(currentRewardEpoch).votepowerBlock) {
                } catch Error(string memory message) {
                    emit DistributingRewardsFailed(rewardedFtsoAddress, lastUnprocessedPriceEpoch);
                    addRevertError(address(ftsoRewardManager), message);
                } catch {
                    emit DistributingRewardsFailed(rewardedFtsoAddress, lastUnprocessedPriceEpoch);
                    addRevertError(address(ftsoRewardManager), ERR_DISTRIBUTE_REWARD_FAIL);
                }
            } else {
                // If here, it means that no FTSO was initialized, or no FTSO had a recipient
                // eligible to receive rewards. And if so, burn rewards for this price epoch.
                _accrueUnearnedRewards();
            }

            lastRewardedFtsoAddress = rewardedFtsoAddress;
            emit PriceEpochFinalized(rewardedFtsoAddress, currentRewardEpoch);
        } else {
            // only for fallback mode
            for (uint256 i = 0; i < numFtsos; i++) {
                IIFtso ftso = ftsos[i];
                // skip finalizing ftso, as it is not initialized for reveal and tx would revert
                if (notInitializedFtsos[ftso]) {
                    delete notInitializedFtsos[ftso];
                    continue;
                }
                _fallbackFinalizePriceEpoch(ftso);
            }

            // Because FTSO manager in fallback, burn rewards for this price epoch.
            _accrueUnearnedRewards();

            lastRewardedFtsoAddress = address(0);
            emit PriceEpochFinalized(address(0), _getCurrentRewardEpochId());
        }
        
        lastUnprocessedPriceEpochInitialized = false;
    }

    function _accrueUnearnedRewards() internal {
        try ftsoRewardManager.accrueUnearnedRewards(
            lastUnprocessedPriceEpoch,
            priceEpochDurationSeconds,
            _getPriceEpochEndTime(lastUnprocessedPriceEpoch) - 1) { // actual end time (included)
        } catch Error(string memory message) {
            emit AccruingUnearnedRewardsFailed(lastUnprocessedPriceEpoch);
            addRevertError(address(ftsoRewardManager), message);
        } catch {
            emit AccruingUnearnedRewardsFailed(lastUnprocessedPriceEpoch);
            addRevertError(address(ftsoRewardManager), ERR_ACCRUE_UNEARNED_REWARD_FAIL);
        }
    }

    function _fallbackFinalizePriceEpochFailed(IIFtso _ftso, string memory message) internal {
        emit FinalizingPriceEpochFailed(
            _ftso, 
            lastUnprocessedPriceEpoch, 
            IFtso.PriceFinalizationType.TRUSTED_ADDRESSES
        );
        addRevertError(address(_ftso), message);

        // if reverts we want to propagate up to daemon
        _ftso.forceFinalizePriceEpoch(lastUnprocessedPriceEpoch);
    }

    function _fallbackFinalizePriceEpoch(IIFtso _ftso) internal {
        try _ftso.fallbackFinalizePriceEpoch(lastUnprocessedPriceEpoch) {
        } catch Error(string memory message) {
            _fallbackFinalizePriceEpochFailed(_ftso, message);
        } catch {
            _fallbackFinalizePriceEpochFailed(_ftso, ERR_FALLBACK_FINALIZE_FAIL);
        }
    }

    /**
     * @notice Initializes epoch states in FTSOs for reveal. 
     * Prior to initialization it sets governance parameters, if 
     * governance has changed them. It also sets price submitter trusted addresses.
     */
    function _initializeCurrentEpochFTSOStatesForReveal() internal {
        if (settings.changed) {
            priceSubmitter.setTrustedAddresses(settings.trustedAddresses);
        }

        IIFtso[] memory ftsos = _getFtsos();
        uint256 numFtsos = ftsos.length;

        // circulating supply is used only when ftso is not in fallback mode
        uint256 circulatingSupplyNat;
        if (numFtsos > 0 && !fallbackMode) {
            uint256 votePowerBlock = _getRewardEpoch(_getCurrentRewardEpochId()).votepowerBlock;
            circulatingSupplyNat = supply.getCirculatingSupplyAtCached(votePowerBlock);
        }

        for (uint256 i = 0; i < numFtsos; i++) {
            IIFtso ftso = ftsos[i];
            if (settings.changed) {
                ftso.configureEpochs(
                    settings.maxVotePowerNatThresholdFraction,
                    settings.maxVotePowerAssetThresholdFraction,
                    settings.lowAssetUSDThreshold,
                    settings.highAssetUSDThreshold,
                    settings.highAssetTurnoutThresholdBIPS,
                    settings.lowNatTurnoutThresholdBIPS,
                    settings.trustedAddresses
                );
            }

            try ftso.initializeCurrentEpochStateForReveal(
                circulatingSupplyNat,
                fallbackMode || ftsoInFallbackMode[ftso]) {
            } catch Error(string memory message) {
                _initializeCurrentEpochStateForRevealFailed(ftso, message);
            } catch {
                _initializeCurrentEpochStateForRevealFailed(ftso, ERR_INIT_EPOCH_REVEAL_FAIL);
            }

        }
        settings.changed = false;

        // Advance price epoch id and end-time
        uint256 currentPriceEpochId = _getCurrentPriceEpochId();
        lastUnprocessedPriceEpoch = currentPriceEpochId;
        lastUnprocessedPriceEpochRevealEnds = _getPriceEpochRevealEndTime(currentPriceEpochId);

        lastUnprocessedPriceEpochInitialized = true;
    }

    function _initializeCurrentEpochStateForRevealFailed(IIFtso ftso, string memory message) internal {
        emit InitializingCurrentEpochStateForRevealFailed(ftso, _getCurrentPriceEpochId());
        addRevertError(address(ftso), message);

        // if it was already called with fallback = true, just mark as not initialized, else retry
        if (fallbackMode || ftsoInFallbackMode[ftso]) {
            notInitializedFtsos[ftso] = true;
        } else {
            try ftso.initializeCurrentEpochStateForReveal(0, true) {
            } catch Error(string memory message1) {
                notInitializedFtsos[ftso] = true;
                emit InitializingCurrentEpochStateForRevealFailed(ftso, _getCurrentPriceEpochId());
                addRevertError(address(ftso), message1);
            } catch {
                notInitializedFtsos[ftso] = true;
                emit InitializingCurrentEpochStateForRevealFailed(ftso, _getCurrentPriceEpochId());
                addRevertError(address(ftso), ERR_FALLBACK_INIT_EPOCH_REVEAL_FAIL);
            }
        }
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        ftsoRewardManager = IIFtsoRewardManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRewardManager"));
        ftsoRegistry = IIFtsoRegistry(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        voterWhitelister = IIVoterWhitelister(
            _getContractAddress(_contractNameHashes, _contractAddresses, "VoterWhitelister"));
        supply = IISupply(
            _getContractAddress(_contractNameHashes, _contractAddresses, "Supply"));
        cleanupBlockNumberManager = CleanupBlockNumberManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "CleanupBlockNumberManager"));
    }

    /**
     * @notice Returns current reward epoch id without additional checks
     */
    function _getCurrentRewardEpochId() internal view returns (uint256) {
        return rewardEpochsLength - 1;
    }

    /**
     * Get reward epoch from current ftso manager or from old one if no data in current
     */
    function _getRewardEpoch(uint256 _rewardEpochId) internal view returns (RewardEpochData memory _rewardEpoch) {
        _rewardEpoch = rewardEpochsMapping[_rewardEpochId];
        if (_rewardEpoch.startTimestamp == 0) {
            (uint256 vpBlock, uint256 sBlock, uint256 sTimestamp) = oldFtsoManager.rewardEpochs(_rewardEpochId);
            _rewardEpoch = RewardEpochData({
                votepowerBlock: vpBlock, 
                startBlock: sBlock,
                startTimestamp: sTimestamp
            });
        }
    }

    /**
     * @notice Check if asset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkAssetFtsosAreManaged(IIFtso[] memory _assetFtsos) internal view {
        uint256 len = _assetFtsos.length;
        for (uint256 i = 0; i < len; i++) {
            if (!managedFtsos[_assetFtsos[i]]) {
                revert(ERR_ASSET_FTSO_NOT_MANAGED);
            }
        }
    }

    /**
     * @notice Check if all multi asset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkMultiAssetFtsosAreManaged(IIFtso[] memory _ftsos) internal view {
        uint256 len = _ftsos.length;
        for (uint256 i = 0; i < len; i++) {
            _checkAssetFtsosAreManaged(_ftsos[i].getAssetFtsos());
        }
    }

    /**
     * @notice Returns price epoch reveal end time.
     * @param _priceEpochId The price epoch id.
     * @dev half-closed interval - end time not included
     */
    function _getPriceEpochRevealEndTime(uint256 _priceEpochId) internal view returns (uint256) {
        return firstPriceEpochStartTs + (_priceEpochId + 1) * priceEpochDurationSeconds + revealEpochDurationSeconds;
    }

    /**
     * @notice Returns price epoch end time.
     * @param _forPriceEpochId The price epoch id of the end time to fetch.
     * @dev half-closed interval - end time not included
     */
    function _getPriceEpochEndTime(uint256 _forPriceEpochId) internal view returns (uint256) {
        return firstPriceEpochStartTs + ((_forPriceEpochId + 1) * priceEpochDurationSeconds);
    }

    /**
     * @notice Returns current price epoch id. The calculation in this function
     * should fully match to definition of current epoch id in FTSO contracts.
     */
    function _getCurrentPriceEpochId() internal view returns (uint256) {
        return (block.timestamp - firstPriceEpochStartTs) / priceEpochDurationSeconds;
    }

    function _getFtsos() internal view returns (IIFtso[] memory) {
        return ftsoRegistry.getSupportedFtsos();
    }
}
