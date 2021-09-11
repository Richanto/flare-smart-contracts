import { FlareDaemonInstance, 
  MockContractInstance, 
  PriceSubmitterInstance} from "../../../typechain-truffle";

import {constants, time} from '@openzeppelin/test-helpers';
const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
import { advanceBlock, waitFinalize, waitFinalize3 } from '../../utils/test-helpers';
import { spewDaemonErrors } from "../../utils/FlareDaemonTestUtils";
import { FLARE_DAEMON_ADDRESS, PRICE_SUBMITTER_ADDRESS } from "../../utils/constants";

const BN = web3.utils.toBN;

const FlareDaemon = artifacts.require("FlareDaemon");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const FtsoManager = artifacts.require("FtsoManager");
const RewardManagerMock = artifacts.require("MockContract");
const MockContract = artifacts.require("MockContract");


/**
 * This test assumes a local chain is running with Native allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareDaemon, which should
 * already be loaded in the genesis block.
 */
 contract(`FtsoManager.sol; ${getTestFile(__filename)}; FtsoManager system tests`, async accounts => {
    // Static address of the daemon and price submitter on a local network
    let flareDaemon: FlareDaemonInstance;
    let priceSubmitter: PriceSubmitterInstance;

    // fresh contracts for each test
    let rewardManagerMock: MockContractInstance;
    let inflationMock: MockContractInstance;
    let ftsoRegistryMock: MockContractInstance;
    let startTs: any;


    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareDaemon = await FlareDaemon.at(FLARE_DAEMON_ADDRESS);
        priceSubmitter = await PriceSubmitter.at(PRICE_SUBMITTER_ADDRESS);
        inflationMock = await MockContract.new();
        ftsoRegistryMock = await MockContract.new();
        // Make sure daemon is initialized with a governance address...if may revert if already done.
        try {
            await flareDaemon.initialiseFixedAddress();
            await flareDaemon.setInflation(inflationMock.address, {from: GOVERNANCE_GENESIS_ADDRESS});
        } catch (e) {
            const governanceAddress = await flareDaemon.governance();
            if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
                throw e;
            }
            // keep going
        }
        try {
            await priceSubmitter.initialiseFixedAddress();
        } catch (e) {
            const governanceAddress = await priceSubmitter.governance();
            if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
                throw e;
            }
            // keep going
        }
    });

    beforeEach(async() => {
        rewardManagerMock = await RewardManagerMock.new();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();
    });

    describe("daemonize", async() => {
        it("Should be daemonized by daemon", async() => {
            // Assemble
            const ftsoManager = await FtsoManager.new(
              GOVERNANCE_GENESIS_ADDRESS,
              flareDaemon.address,
              priceSubmitter.address,
              startTs,
              60,
              5,
              startTs.addn(5),
              600,
              4
            );
            await ftsoManager.setContractAddresses(
              rewardManagerMock.address,
              ftsoRegistryMock.address,
              constants.ZERO_ADDRESS,
              constants.ZERO_ADDRESS,
              constants.ZERO_ADDRESS,
              {from: GOVERNANCE_GENESIS_ADDRESS}
            );

            await ftsoManager.setGovernanceParameters(10, 10, 500, 100000, 5000, 300, 50000, [], {from: GOVERNANCE_GENESIS_ADDRESS});

            await priceSubmitter.setContractAddresses(
              ftsoRegistryMock.address, 
              constants.ZERO_ADDRESS, 
              ftsoManager.address, 
              {from: GOVERNANCE_GENESIS_ADDRESS}
            );

            await flareDaemon.registerToDaemonize([{daemonizedContract: ftsoManager.address, gasLimit: 0}], {from: GOVERNANCE_GENESIS_ADDRESS});
            // Act
            await ftsoManager.activate({from: GOVERNANCE_GENESIS_ADDRESS});
            // Wait for some blocks to mine...
            for(let i = 0; i < 5; i++) {
              await new Promise(resolve => {
                setTimeout(resolve, 1000);
              });
              await advanceBlock();  
            }
            // Assert
            // If the daemon is calling daemonize on the RewardManager, then there should be
            // an active reward epoch.
            await spewDaemonErrors(flareDaemon);
            //assert.equal(await spewDaemonErrors(flareDaemon), 0);
            const { 1: rewardEpochStartBlock } = await ftsoManager.rewardEpochs(0);
            assert(rewardEpochStartBlock.toNumber() != 0);
        });
    });
});
