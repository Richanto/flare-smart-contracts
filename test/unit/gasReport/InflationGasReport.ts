import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { DataAvailabilityRewardManagerInstance, FlareDaemonWithInflationMockInstance, InflationAllocationInstance, InflationInstance, InflationReceiverAndTokenPoolMockInstance, StateConnectorMockInstance, SupplyInstance } from "../../../typechain-truffle";
import { getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../utils/constants";
import { increaseTimeTo, toBN } from "../../utils/test-helpers";

const Supply = artifacts.require("Supply");
const Inflation = artifacts.require("Inflation");
const InflationAllocation = artifacts.require("InflationAllocation");
const InflationReceiverAndTokenPoolMock = artifacts.require("InflationReceiverAndTokenPoolMock");
const SuicidalMock = artifacts.require("SuicidalMock");
const FlareDaemonWithInflationMock = artifacts.require("FlareDaemonWithInflationMock");
const StateConnectorMock = artifacts.require("StateConnectorMock");
const DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");

function toBNFixed(x: number, decimals: number) {
  const prec = Math.min(decimals, 6);
  const s = x.toFixed(prec);
  const dot = s.indexOf('.');
  const bn = toBN(s.slice(0, dot) + s.slice(dot + 1));
  return prec === decimals ? bn : bn.mul(toBN(10).pow(toBN(decimals - prec)));
}

function usd(x: number) {
  return toBNFixed(x, 5);     // asset prices are multiplied by 10**5 (see Ftso.sol)
}

contract(`Inflation.sol; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  const inflationAccount: string = accounts[0];

  const dayDurationSec = 24 * 60 * 60;
  const rewardPeriodSec = 7 * dayDurationSec;
  const yearDurationSec = 365 * dayDurationSec;

  let inflation: InflationInstance;
  let inflationAllocation: InflationAllocationInstance;
  let flareDaemon: FlareDaemonWithInflationMockInstance;
  let stateConnectorMock: StateConnectorMockInstance;
  let dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance;

  let supply: SupplyInstance;
  let startTs: BN;
  let tokenPools: InflationReceiverAndTokenPoolMockInstance[];

  async function getCurrentDay(): Promise<number> {
    await time.advanceBlock();
    let timestamp = await time.latest();
    return Math.floor(timestamp.sub(startTs).toNumber() / dayDurationSec);
  }

  async function inflationGasBenchmarking(
    inflationReceiversSharingBIPS: number[],
    inflationReceiversTopupFactorX100: number[],
    noOfTokenPools: number,
    noOfDays: number
  ) {

    let inflationReceivers = [];
    tokenPools = [];

    const noOfInflationReceivers = inflationReceiversSharingBIPS.length;
    assert(noOfInflationReceivers == inflationReceiversTopupFactorX100.length);
    
    // Assemble
    for (let i = 0; i < noOfInflationReceivers + noOfTokenPools; i++) {

      const contract = await InflationReceiverAndTokenPoolMock.new(governance, inflation.address);
      if (i < noOfInflationReceivers) {
        inflationReceivers.push(contract);
        await inflation.setTopupConfiguration(contract.address, 0, inflationReceiversTopupFactorX100[i], {from: governance});
      }

      tokenPools.push(contract);
      supply.addTokenPool(contract.address, 0, {from: governance});

    }
    await inflationAllocation.setSharingPercentages(inflationReceivers.map(ir => ir.address), inflationReceiversSharingBIPS, {from: governance});

    let normalDaemonizeCallTx = await flareDaemon.triggerDaemonize();
    console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);

    for (let j = 0; j < tokenPools.length; j++) {
      await tokenPools[j].receiveFoundationAllocatedFunds({ value: toBN(50), from: governance });
      await tokenPools[j].claimMock(constants.ZERO_ADDRESS, 10); // send to burn address
      let suicidalContract = await SuicidalMock.new(tokenPools[j].address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: j == 0 ? 50_000 : 50 });
      await suicidalContract.die();
    }

    await increaseTimeTo(startTs, 'web3');

    // initialize first annum
    await expectRevert(inflation.getCurrentAnnum(), "no annum");
    let oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
    let initializeFirstAnnumTx = await flareDaemon.triggerDaemonize();
    expectEvent.notEmitted.inTransaction(initializeFirstAnnumTx.tx, supply, "AuthorizedInflationUpdateError");
    await inflation.getCurrentAnnum(); // should not revert
    console.log(`initialize first annum: ${initializeFirstAnnumTx.receipt.gasUsed}`);
    await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));

    let currentDay = await getCurrentDay();
    assert(currentDay == 0, "currentDay != 0");

    for (let i = 1; i <= noOfDays; i++) {

      await increaseTimeTo(startTs.addn(i * dayDurationSec + i), 'web3');

      for (let j = 0; j < tokenPools.length; j++) {
        await tokenPools[j].receiveFoundationAllocatedFunds({ value: toBN(50), from: governance });
        await tokenPools[j].claimMock(constants.ZERO_ADDRESS, 10); // send to burn address
        let suicidalContract = await SuicidalMock.new(tokenPools[j].address);
        await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: j == 0 ? 50_000 : 50 });
        await suicidalContract.die();
      }

      console.log("day: " + i);
      oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
      let updateSupplyAndReceiveInflation = await flareDaemon.triggerDaemonize();
      expectEvent.notEmitted.inTransaction(updateSupplyAndReceiveInflation.tx, supply, "AuthorizedInflationUpdateError");
      console.log(`update supply contract and inflation: ${updateSupplyAndReceiveInflation.receipt.gasUsed}`);
      await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));

      oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
      normalDaemonizeCallTx = await flareDaemon.triggerDaemonize();
      console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);
      await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));
    }

    for (let j = 0; j < tokenPools.length; j++) {
      await tokenPools[j].receiveFoundationAllocatedFunds({ value: toBN(50), from: governance });
      await tokenPools[j].claimMock(constants.ZERO_ADDRESS, 10); // send to burn address
      let suicidalContract = await SuicidalMock.new(tokenPools[j].address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: j == 0 ? 50_000 : 50 });
      await suicidalContract.die();
    }

    // finalize first annum
    await increaseTimeTo(startTs.addn(yearDurationSec), 'web3');
    oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
    let finalizeAnnumTx = await flareDaemon.triggerDaemonize();
    console.log(`finalize annum: ${finalizeAnnumTx.receipt.gasUsed}`);
    await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));
  }

  describe("Inflation gas benchmarking", async () => {

    beforeEach(async () => {

      // create inflation allocation
      inflationAllocation = await InflationAllocation.new(governance, constants.ZERO_ADDRESS, 1000);

      // create flare daemon with inflation mock
      flareDaemon = await FlareDaemonWithInflationMock.new();
      await flareDaemon.initialiseFixedAddress();

      startTs = (await time.latest()).addn(500);
      // create inflation
      inflation = await Inflation.new(governance, flareDaemon.address, inflationAllocation.address, inflationAllocation.address, startTs);
      
      // Supply contract
      supply = await Supply.new(
        governance,
        constants.ZERO_ADDRESS,
        inflation.address,
        10_000_000,
        0,
        []
      );

      // set contract addresses
      await flareDaemon.setInflation(inflation.address, { from: governance });
      await inflation.setSupply(supply.address, { from: governance });
      await inflationAllocation.setInflation(inflation.address, { from: governance });

      // send flare daemon some initial balance
      let suicidalContract = await SuicidalMock.new(flareDaemon.address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: 500_000 });
      await suicidalContract.die();
    });

    
    // real conditions
    it("Inflation daemonize calls for 5 inflation receivers and 6 additional token pools (10 days)", async () => {
      await inflationGasBenchmarking([2000, 3000, 2000, 1000, 2000], [300, 500, 200, 200, 700], 6, 10);
    });
  });
  
  async function dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(skipRewardPeriods: number, rewardExpiryOffset: number, emptyRewardPeriod: boolean, noOfAdditionalRewardPeriods: number) {
    
    dataAvailabilityRewardManager = await DataAvailabilityRewardManager.new(governance, rewardExpiryOffset, stateConnectorMock.address, inflationAccount);
    dataAvailabilityRewardManager.activate({from: governance});
    
    for (let i = 1; i <= skipRewardPeriods; i++) {
      if (!emptyRewardPeriod) {
        await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[i]);
      }
      await increaseTimeTo(startTs.addn(i * rewardPeriodSec), 'web3');
    }
    let setDailyAuthorizedInflationTx = await dataAvailabilityRewardManager.setDailyAuthorizedInflation(500_000, { from: inflationAccount });
    console.log(`set first daily authorized inflation: ${setDailyAuthorizedInflationTx.receipt.gasUsed}`);

    for (let i = 0; i < noOfAdditionalRewardPeriods; i++) {
      if (!emptyRewardPeriod) {
        await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[i]);
      }

      for (let day = 1; day < 7; day++) {
        await increaseTimeTo(startTs.addn((skipRewardPeriods + i) * rewardPeriodSec + day * dayDurationSec), 'web3');

        let setDailyAuthorizedInflationTx = await dataAvailabilityRewardManager.setDailyAuthorizedInflation(500_000, { from: inflationAccount });
        console.log(`set daily authorized inflation (no reward epoch): ${setDailyAuthorizedInflationTx.receipt.gasUsed}`);
      }

      await increaseTimeTo(startTs.addn((skipRewardPeriods + i + 1) * rewardPeriodSec), 'web3');

      let setDailyAuthorizedInflationTx = await dataAvailabilityRewardManager.setDailyAuthorizedInflation(500_000, { from: inflationAccount });
      console.log(`set daily authorized inflation: ${setDailyAuthorizedInflationTx.receipt.gasUsed}`);

    }
  }

  describe("Set daily inflation in data availability manager gas benchmarking", async () => {

    beforeEach(async () => {

      stateConnectorMock = await StateConnectorMock.new();
      await stateConnectorMock.initialiseChains();
      startTs = await stateConnectorMock.initialiseTime();
    });


    it("Set daily authorized inflation (1+2 reward periods, expire after 1 reward period, not empty)", async () => {
      await dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(1, 1, false, 2);
    });

    it("Set daily authorized inflation (1+2 reward periods, expire after 5 reward periods, not empty)", async () => {
      await dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(1, 5, false, 2);
    });

    it("Set daily authorized inflation (2+2 reward periods, expire after 1 reward period, not empty)", async () => {
      await dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(2, 1, false, 2);
    });

    it("Set daily authorized inflation (6 reward periods, expire after 5 reward periods, not empty)", async () => {
      await dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(6, 5, false, 0);
    });

    it("Set daily authorized inflation (50 reward periods, expire after 10 reward periods, not empty)", async () => {
      await dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(50, 10, false, 0);
    });

    it("Set daily authorized inflation (50 reward periods, expire after 10 reward periods, empty)", async () => {
      await dataAvailabilitySetDailyAuthorizedInflationGasBenchmarking(50, 10, true, 0);
    });
  });
});