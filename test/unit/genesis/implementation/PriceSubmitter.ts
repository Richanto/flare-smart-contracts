import { FtsoContract, FtsoInstance, MockContractContract, MockContractInstance, PriceSubmitterContract, PriceSubmitterInstance, VoterWhitelisterContract, VoterWhitelisterInstance, WFlrContract, WFlrInstance } from "../../../../typechain-truffle";
import { compareArrays, increaseTimeTo, lastOf, submitPriceHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import {constants, expectRevert, expectEvent, time} from '@openzeppelin/test-helpers';
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
const getTestFile = require('../../../utils/constants').getTestFile;

const Wflr = artifacts.require("WFlr") as WFlrContract;
const MockWflr = artifacts.require("MockContract") as MockContractContract;
const MockSupply = artifacts.require("MockContract") as MockContractContract;
const MockRegistry = artifacts.require("MockContract") as MockContractContract;
const MockFtso = artifacts.require("MockContract") as MockContractContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const PriceSubmitter = artifacts.require("PriceSubmitter") as PriceSubmitterContract;
const VoterWhitelister = artifacts.require("VoterWhitelister") as VoterWhitelisterContract;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;

const ERR_FTSO_MANAGER_ONLY = "FTSOManager only";
const ERR_NOT_WHITELISTED = "Not whitelisted";

// contains a fresh contract for each test 
let wflrInterface: WFlrInstance;
let mockWflr: MockContractInstance;
let mockSupply: MockContractInstance;
let mockFtsoRegistry: MockContractInstance;
let ftsos: FtsoInstance[];
let priceSubmitter: PriceSubmitterInstance;
let epochId: number;
let voterWhitelister: VoterWhitelisterInstance;

// WARNING: This sets mock vote power fully, irrespective of address and blockNumber
async function setBatchMockVotePower(votePower: number[]) {
    // Both are address and block number are irrelevant. We just need them for proper method coding
    const batchVotePowerOfAt = wflrInterface.contract.methods.batchVotePowerOfAt([constants.ZERO_ADDRESS], 1).encodeABI();
    const batchVotePowerOfAtReturn = web3.eth.abi.encodeParameter('uint256[]', votePower);
    await mockWflr.givenMethodReturn(batchVotePowerOfAt, batchVotePowerOfAtReturn);
}

async function setGetFtsosMock(ftsoIndices: number[]) {
    let params: any[] = [ftsoIndices.map(i => toBN(i))];
    let values: any[] = ftsoIndices.map(i => ftsos[i].address);
    await mockFtsoRegistry.givenCalldataReturn(
        web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtsos", inputs: [{name: "_ftsoIndices", type: "uint256[]"}]} as AbiItem, params), 
        web3.eth.abi.encodeParameters(['address[]'], [values])
    );
}

// TODO FILIP: Some of the logic in this tests is now in other places
contract(`PriceSubmitter.sol; ${getTestFile(__filename)}; PriceSubmitter unit tests`, async accounts => {

    const FTSO_MANAGER_ADDRESS = accounts[12];

    describe("submit and reveal price", async() => {
        beforeEach(async() => {
            ftsos = [];
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            mockSupply = await MockSupply.new();
            mockFtsoRegistry = await MockRegistry.new();
            priceSubmitter = await PriceSubmitter.new();
            await priceSubmitter.initialiseFixedAddress();
            voterWhitelister = await VoterWhitelister.new(GOVERNANCE_GENESIS_ADDRESS, priceSubmitter.address, 10);
            
            // Have an exisitng address just to set up FtsoManager and can act like it in {from: _}
            await voterWhitelister.setContractAddresses(mockFtsoRegistry.address, FTSO_MANAGER_ADDRESS, { from: GOVERNANCE_GENESIS_ADDRESS });
            await priceSubmitter.setContractAddresses(mockFtsoRegistry.address, voterWhitelister.address, FTSO_MANAGER_ADDRESS, { from: GOVERNANCE_GENESIS_ADDRESS });

            
            for (let i = 0; i < 3; i++) {
                let ftso = await Ftso.new(
                    `ATOK${i}`,
                    mockWflr.address,
                    accounts[10],
                    mockSupply.address,
                    1, // initial token price 0.00001$
                    1e10,
                    defaultPriceEpochCyclicBufferSize
                );
                await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
                await ftso.setVotePowerBlock(1, {from: accounts[10]});
                await ftso.activateFtso(priceSubmitter.address, 0, 120, 60, {from: accounts[10]});

                ftsos[i] = ftso;
            }

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndices", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter("uint256[]", [...Array(ftsos.length).keys()]);
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);

            for(let i = 0; i < ftsos.length; ++i){
                await mockFtsoRegistry.givenCalldataReturnAddress(
                    web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, [`${i}`]), 
                    ftsos[i].address
                );

                await voterWhitelister.addFtso(i, {from: FTSO_MANAGER_ADDRESS});
            }

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });
        
        it("Should set trusted addresses only if ftso manager", async () => {
            let addresses: string[] = [accounts[6], accounts[7]];

            let tx = priceSubmitter.setTrustedAddresses(addresses);
            await expectRevert(tx, ERR_FTSO_MANAGER_ONLY);

            compareArrays([], await priceSubmitter.getTrustedAddresses());
            await priceSubmitter.setTrustedAddresses(addresses, {from: FTSO_MANAGER_ADDRESS});
            compareArrays(addresses, await priceSubmitter.getTrustedAddresses());
        });

        it("Should correctly set individual part of mask and fire events", async () => {
            await setBatchMockVotePower([10, 0]);

            // Set 1 on index 0
            let tx = await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            let bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            expectEvent(tx, "VoterWhitelisted", {voter: accounts[10], ftsoIndex: toBN(0)});
            
            // Should not reemit
            tx = await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            expectEvent.notEmitted(tx, "VoterWhitelisted");
            assert.equal(bitmask.toNumber(), 1 * 2**0);
            
            // Set 1 on index 2
            tx = await voterWhitelister.requestWhitelistingVoter(accounts[10], 2);
            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            assert.equal(bitmask.toNumber(), 1 * 2**0 + 1 * 2**2);
            expectEvent(tx, "VoterWhitelisted", {voter: accounts[10], ftsoIndex: toBN(2)});

            // Fill 10 voters
            await setBatchMockVotePower([...Array(11).keys()]);
            for(let i = 0; i < 9; ++i){
                tx = await voterWhitelister.requestWhitelistingVoter(accounts[20 + i], 2);

                expectEvent(tx, "VoterWhitelisted", {voter: accounts[20 + i], ftsoIndex: toBN(2)});
                expectEvent.notEmitted(tx, "VoterRemovedFromWhitelist");
            }

            // Should add and remove old
            tx = await voterWhitelister.requestWhitelistingVoter(accounts[11], 2);

            expectEvent(tx, "VoterWhitelisted", {voter: accounts[11], ftsoIndex: toBN(2)});
            expectEvent(tx, "VoterRemovedFromWhitelist", {voter: accounts[10], ftsoIndex: toBN(2)});

            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            assert.equal(bitmask.toNumber(), 1 * 2**0);

            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[11]);
            assert.equal(bitmask.toNumber(), 1 * 2**2);

            await setBatchMockVotePower([...Array(10).keys()]);

            tx = await voterWhitelister.setMaxVotersForFtso(2, 8, {from : GOVERNANCE_GENESIS_ADDRESS});
            expectEvent(tx, "VoterRemovedFromWhitelist", {voter: accounts[20 + 0], ftsoIndex: toBN(2)});
            // We do not know explicitly which will be the second one (too implementation defined as we are just mocking), 
            // just require another one to be kicked out
            expectEvent(tx, "VoterRemovedFromWhitelist", {ftsoIndex: toBN(2)});

            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[20 + 0]);
            assert.equal(bitmask.toNumber(), 0 * 2**0);
        });

        it("Should work with deleted ftsos", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);
            let addresses = [ftsos[0].address, ftsos[2].address];
            let hashes = [hash1, hash3];

            await ftsos[1].deactivateFtso({from: accounts[10]});
            await voterWhitelister.removeFtso(1, {from: FTSO_MANAGER_ADDRESS});

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndices", inputs: []} as AbiItem, []);
            // Remove 1 from a list of supported indices
            const supportedFtsos = web3.eth.abi.encodeParameter("uint256[]", [...Array(ftsos.length).keys()].filter(x => x != 1));
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);

            await voterWhitelister.setMaxVotersForFtso(0, 100, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(2, 100, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await setGetFtsosMock([0, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceHashSubmitted"));

            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Event.args.submitter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.hash).to.equals(hashes[0]);
            expect(ftso2Event.args.submitter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.hash).to.equals(hashes[1]);
        });

        it("Should allow voting", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[10]);
            let hash2 = submitPriceHash(500, 123, accounts[11]);
            let hash3 = submitPriceHash(300, 125, accounts[12]);

            let mockFtso1 = await MockFtso.new()

            await mockFtsoRegistry.givenCalldataReturnAddress(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, ["3"]), 
                mockFtso1.address
            );

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndices", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter(
                "uint256[]", [...Array(ftsos.length).keys(), 3]);
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);
            
            await mockFtso1.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "symbol", inputs: []} as AbiItem, []),
                web3.eth.abi.encodeParameter("string", "MOCK_1")
                );
            
            await mockFtsoRegistry.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtsos", inputs: [{name: "_ftsoIndices", type: "uint256[]"}]} as AbiItem, [[toBN(3)]] as any[]), 
                web3.eth.abi.encodeParameters(['address[]'], [[mockFtso1.address]])
            );
            
            await voterWhitelister.addFtso(3, {from: FTSO_MANAGER_ADDRESS});

            // Everyone gets some WFLR
            await setBatchMockVotePower([10, 10, 10]);

            await voterWhitelister.setMaxVotersForFtso(3, 3, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[11]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[12]);
            
            // Check that they work
            await priceSubmitter.submitPriceHashes([3], [hash1], {from: accounts[10]});
            await priceSubmitter.submitPriceHashes([3], [hash2], {from: accounts[11]});
            await priceSubmitter.submitPriceHashes([3], [hash3], {from: accounts[12]});
        });

        it("Should submit with precheck", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);

            const getSupportedFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedFtsos", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter("address[]", ftsos.map(ftso => ftso.address));
            await mockFtsoRegistry.givenCalldataReturn(getSupportedFtsos, supportedFtsos);

            const failPrecheck = priceSubmitter.submitPriceHashes([0, 1], [hash1, hash2]);
            await expectRevert(failPrecheck, ERR_NOT_WHITELISTED);

            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);

            await setGetFtsosMock([0, 1]);
            await priceSubmitter.submitPriceHashes([0, 1], [hash1, hash2], {from: accounts[10]});
            
            // This kicks out 10            
            await setBatchMockVotePower([0, 10]);
            // Lower max amount of voters
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(1, 2, {from: GOVERNANCE_GENESIS_ADDRESS});

            await voterWhitelister.requestFullVoterWhitelisting(accounts[11]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);

            await priceSubmitter.submitPriceHashes([0, 1], [hash1, hash2], {from: accounts[10]});

            await setGetFtsosMock([0]);
            await expectRevert(priceSubmitter.submitPriceHashes([0], [hash1], { from: accounts[11] }), ERR_NOT_WHITELISTED);
            await setGetFtsosMock([1]);
            await priceSubmitter.submitPriceHashes([1], [hash2], {from: accounts[11]});
        });

        it("Should submit prices", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceHashSubmitted"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceHashSubmitted"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Event.args.submitter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.hash).to.equals(hashes[0]);
            expect(ftso1Event.args.submitter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.hash).to.equals(hashes[1]);
            expect(ftso2Event.args.submitter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.hash).to.equals(hashes[2]);
        });

        it("Should submit prices from trusted address", async () => {
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});
            
            let hash1 = submitPriceHash(500, 123, accounts[6]);
            let hash2 = submitPriceHash(200, 124, accounts[6]);
            let hash3 = submitPriceHash(300, 125, accounts[6]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[6], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
        });

        it("Should submit prices from whitelisted trusted address", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);
            
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});
            
            let hash1 = submitPriceHash(500, 123, accounts[6]);
            let hash2 = submitPriceHash(200, 124, accounts[6]);
            let hash3 = submitPriceHash(300, 125, accounts[6]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[6], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
        });

        it("Should revert submit prices from removed trusted address", async () => {
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});

            // change trusted addresses
            await priceSubmitter.setTrustedAddresses([accounts[7]], {from: FTSO_MANAGER_ADDRESS});
            
            let hash1 = submitPriceHash(500, 123, accounts[6]);
            let hash2 = submitPriceHash(200, 124, accounts[6]);
            let hash3 = submitPriceHash(300, 125, accounts[6]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await setGetFtsosMock([0, 1, 2]);
            let tx = priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });

        it("Should submit prices from whitelisted trusted address which was then removed from trusted addresses", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);
            
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});

            // change trusted addresses
            await priceSubmitter.setTrustedAddresses([accounts[7]], {from: FTSO_MANAGER_ADDRESS});
            
            let hash1 = submitPriceHash(500, 123, accounts[6]);
            let hash2 = submitPriceHash(200, 124, accounts[6]);
            let hash3 = submitPriceHash(300, 125, accounts[6]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[6], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
        });

        it("Should revert submit prices from whitelisted trusted address which was then removed from whitelist and from trusted addresses", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);
            
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});

            await voterWhitelister.removeTrustedAddressFromWhitelist(accounts[6], 0);

            // change trusted addresses
            await priceSubmitter.setTrustedAddresses([accounts[7]], {from: FTSO_MANAGER_ADDRESS});
            
            let hash1 = submitPriceHash(500, 123, accounts[6]);
            let hash2 = submitPriceHash(200, 124, accounts[6]);
            let hash3 = submitPriceHash(300, 125, accounts[6]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await setGetFtsosMock([0, 1, 2]);
            let tx = priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });

        it("Should revert submit prices if not all ftsos are active", async () => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);

            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);

            await ftsos[0].deactivateFtso({ from: accounts[10] });
            await voterWhitelister.removeFtso(0, { from: FTSO_MANAGER_ADDRESS });

            let hashes = [hash1, hash2];

            let tx = priceSubmitter.submitPriceHashes([0, 1], hashes, { from: accounts[1] });
            await expectRevert(tx, ERR_NOT_WHITELISTED);
            let ftso0Events = await ftsos[0].getPastEvents("PriceHashSubmitted");
            let ftso1Events = await ftsos[1].getPastEvents("PriceHashSubmitted");
            expect(ftso0Events.length).to.equals(0);
            expect(ftso1Events.length).to.equals(0);
        });
        
        it("Should reveal price", async() => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, randoms, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN});
            
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Event.args.voter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.price.toNumber()).to.equals(prices[0]);
            expect(ftso0Event.args.random.toNumber()).to.equals(randoms[0]);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso1Event.args.random.toNumber()).to.equals(randoms[1]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
            expect(ftso2Event.args.random.toNumber()).to.equals(randoms[2]);
        });

        it("Should reveal price from trusted address", async() => {
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});

            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[6]), submitPriceHash(prices[1], randoms[1], accounts[6]), submitPriceHash(prices[2], randoms[2], accounts[6])];
            
            await setGetFtsosMock([0, 1 ,2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[6], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, randoms, {from: accounts[6]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[6], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN});
        });

        it("Should reveal price from whitelisted trusted address", async() => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);

            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await priceSubmitter.setTrustedAddresses(trustedAddresses, {from: FTSO_MANAGER_ADDRESS});

            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[6]), submitPriceHash(prices[1], randoms[1], accounts[6]), submitPriceHash(prices[2], randoms[2], accounts[6])];
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[6]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[6], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, randoms, {from: accounts[6]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[6], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN});
        });

        it("Should submit and reveal price in arbitrary order", async() => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[1].address, ftsos[0].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([1, 0, 2]);
            let tx = await priceSubmitter.submitPriceHashes([1, 0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [1, 0, 2], prices, randoms, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN});
            
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Event.args.voter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso0Event.args.random.toNumber()).to.equals(randoms[1]);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[0]);
            expect(ftso1Event.args.random.toNumber()).to.equals(randoms[0]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
            expect(ftso2Event.args.random.toNumber()).to.equals(randoms[2]);
        });

        it("Should revert submit if not whitelisted", async () => {
            let prices = [500, 200, 300];
            let randoms = [123, 124, 125];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);

            // Kick 1 out
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await setBatchMockVotePower([0, 10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await setGetFtsosMock([1, 0, 2]);
            let tx = priceSubmitter.submitPriceHashes([1, 0, 2], hashes, {from: accounts[1]});
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });

        it("Should revert on reveal whitelist error", async () => {
            let prices = [500, 200, 300];
            let randoms = [123, 124, 125];
            let addresses = [ftsos[1].address, ftsos[0].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([1, 0, 2]);
            let tx = await priceSubmitter.submitPriceHashes([1, 0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            // Kick 1 out
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(1, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(2, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await setBatchMockVotePower([0, 10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [1, 0, 2], prices, randoms, {from: accounts[1]});
            await expectRevert(tx2, ERR_NOT_WHITELISTED);
        });

        it("Should revert on reveal hashes error", async () => {
            let prices = [500, 200, 300];
            let randoms = [123, 124, 125];
            let addresses = [ftsos[1].address, ftsos[0].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([1, 0, 2]);
            let tx = await priceSubmitter.submitPriceHashes([1, 0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [1, 0, 2], [10, 10, 10], randoms, {from: accounts[1]});
            await expectRevert(tx2, "Price already revealed or not valid");
        });

        it("Should revert reveal if not whitelisted", async () => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[1].address, ftsos[0].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([1, 0, 2]);
            let tx = await priceSubmitter.submitPriceHashes([1, 0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            // Kick 1 out
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await setBatchMockVotePower([0, 10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [1, 0, 2], prices, randoms, {from: accounts[1]});
            await expectRevert(tx2, ERR_NOT_WHITELISTED);
            
            // Nothing should happen here
            let ftso0Event = await ftsos[0].getPastEvents("PriceRevealed");
            let ftso1Event = await ftsos[1].getPastEvents("PriceRevealed");
            let ftso2Event = await ftsos[2].getPastEvents("PriceRevealed");
            
            assert.isEmpty(ftso0Event);
            assert.isEmpty(ftso1Event);
            assert.isEmpty(ftso2Event);
        });

        it("Should not allow price shadowing", async () => {
            // Thist tests against an attacker that just copies submitted commit hash and sends 
            // the same revealed price without doing anything else
            // This is mitigated by including sender's address in the hash before reveal.
            let prices = [500, 200, ];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, ];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address,];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1])];
            let hashesAttacker = Array.from(hashes) // Copy sent hashes

            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await setGetFtsosMock([0, 1]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1], hashes, {from: accounts[1]});
            let txAttacker = await priceSubmitter.submitPriceHashes([0, 1], hashesAttacker, {from: accounts[2]});

            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            expectEvent(txAttacker, "PriceHashesSubmitted", {submitter: accounts[2], epochId: toBN(epochId), ftsos: addresses, hashes: hashes});
            
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1], prices, randoms, {from: accounts[1]});

            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN});

            const f0e1 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e1 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));

            // First submit should succeed
            expect(f0e1.args.voter).to.equals(accounts[1]);
            expect(f0e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f0e1.args.price.toNumber()).to.equals(prices[0]);
            expect(f0e1.args.random.toNumber()).to.equals(randoms[0]);
            expect(f1e1.args.voter).to.equals(accounts[1]);
            expect(f1e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f1e1.args.price.toNumber()).to.equals(prices[1]);
            expect(f1e1.args.random.toNumber()).to.equals(randoms[1]);

            let tx2Attacker = priceSubmitter.revealPrices(epochId, [0, 1], prices, randoms, {from: accounts[2]});
            // Copy attacker should not succeed in submitting the final price
            await expectRevert(tx2Attacker, "Price already revealed or not valid");
            
            // No correct prices should be revealed
            const f0e2 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e2 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            
            assert.isUndefined(f0e2);
            assert.isUndefined(f1e2);
        });
    });
});
