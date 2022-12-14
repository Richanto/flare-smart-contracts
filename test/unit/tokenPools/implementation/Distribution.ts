import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { DistributionInstance, DistributionTreasuryInstance } from "../../../../typechain-truffle";
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";

const getTestFile = require('../../../utils/constants').getTestFile;
const { calcGasCost } = require('../../../utils/eth');

const BN = web3.utils.toBN;

const DistributionTreasury = artifacts.require("DistributionTreasury");
const Distribution = artifacts.require("Distribution");
const SuicidalMock = artifacts.require("SuicidalMock");
const GasConsumer = artifacts.require("GasConsumer2");
const MockContract = artifacts.require("MockContract");

const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ADDRESS_ZERO = "address zero";
const ERR_OUT_OF_BALANCE = "balance too low";
const ERR_OPT_OUT = "already opted out";
const ERR_NOT_STARTED = "not started";
const ERR_FULLY_CLAIMED = "already fully claimed";
const ERR_NO_BALANCE_CLAIMABLE = "no balance currently available";
const ERR_ARRAY_MISMATCH = "arrays lengths mismatch";
const ERR_TOO_MANY = "too many";
const ERR_NOT_REGISTERED = "not registered";
const ERR_ALREADY_STARTED = "already started";
const ERR_TREASURY_ONLY = "treasury only";
const ERR_IN_THE_PAST = "in the past";
const ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";

const EVENT_ENTITLEMENT_START = "EntitlementStart";
const EVENT_ACCOUNT_CLAIM = "AccountClaimed";
const EVENT_ACCOUNT_OPT_OUT = "AccountOptOut";
const EVENT_OPT_OPT_WITHDRAWN = "OptOutWeiWithdrawn";
const EVENT_ACCOUNTS_ADDED = "AccountsAdded";

contract(`Distribution.sol; ${getTestFile(__filename)}; Distribution unit tests`, async accounts => {
  let distributionTreasury: DistributionTreasuryInstance;
  let distribution: DistributionInstance;
  let claimants: string[] = [];
  let latestStart: BN;
  const GOVERNANCE_ADDRESS = accounts[0];

  beforeEach(async () => {
    distributionTreasury = await DistributionTreasury.new();
    await distributionTreasury.initialiseFixedAddress();
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    distribution = await Distribution.new(GOVERNANCE_ADDRESS, distributionTreasury.address, latestStart);
    // Build an array of claimant accounts
    for (let i = 0; i < 10; i++) {
      claimants[i] = accounts[i + 1];
    }
  });

  async function bulkLoad(balance: BN) {
    let balances = [];
    for (let i = 0; i < claimants.length; i++) {
      balances[i] = balance;
    }
    await distribution.setAirdropBalances(claimants, balances);
  }

  async function bestowClaimableBalance(balance: BN) {
    // Give the distribution contract the native token required to be in balance with entitlements
    // Our subversive attacker will be suiciding some native token into flareDaemon
    const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
    // Give suicidal some native token
    await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: balance });
    // Attacker dies
    await suicidalMock.die();
    // set distribution contract
    await distributionTreasury.setContracts(distribution.address, (await MockContract.new()).address, {from: GOVERNANCE_GENESIS_ADDRESS});
    // select distribution contract
    await distributionTreasury.selectDistributionContract(distribution.address, {from: GOVERNANCE_GENESIS_ADDRESS});
  }

  describe("Basic", async () => {
    it("Should revert if treasury contract zero", async () => {
      // Assemble
      // Act
      const distributionPromise = Distribution.new(GOVERNANCE_ADDRESS, constants.ZERO_ADDRESS, latestStart);
      // Assert
      await expectRevert(distributionPromise, ERR_ADDRESS_ZERO);
    });
    
    it("Should revert sending founds if not treasury contract", async () => {
      // Assemble
      // Act
      const res = web3.eth.sendTransaction({ from: accounts[0], to: distribution.address, value: 500 });
      // Assert
      await expectRevert(res, ERR_TREASURY_ONLY)
    });

    it("Should revert if latest start time in the past", async () => {
      // Assemble
      // Act
      const distributionPromise = Distribution.new(GOVERNANCE_ADDRESS, distributionTreasury.address, (await time.latest()).subn(5));
      // Assert
      await expectRevert(distributionPromise, ERR_IN_THE_PAST);
    });
  });

  describe("Adding Accounts", async () => {
    it("Should add account", async () => {
      // Assemble
      const balances = [BN(1000), BN(1000), BN(1000), BN(1000), BN(1000),
      BN(1000), BN(1000), BN(1000), BN(1000), BN(1000)];
      await distribution.setAirdropBalances(claimants, balances);
      // Act
      // Assert
      const totalEntitlementWei = await distribution.totalEntitlementWei();
      assert.equal(totalEntitlementWei.toNumber(), 8500);
    });

    it("Should emit add accounts event", async () => {
      // Assemble
      const balances = [BN(1000), BN(1000), BN(1000), BN(1000), BN(1000),
      BN(1000), BN(1000), BN(1000), BN(1000), BN(1000)];
      // Act
      const addingEvent = await distribution.setAirdropBalances(claimants, balances);
      // Assert
      expectEvent(addingEvent, EVENT_ACCOUNTS_ADDED);
    });

    it("Should revert if accounts and balance length don't agree", async () => {
      // Assemble
      const balances = [BN(1000), BN(1000), BN(1000), BN(1000), BN(1000),
      BN(1000), BN(1000), BN(1000), BN(1000)];
      // Act
      const addingEvent = distribution.setAirdropBalances(claimants, balances);
      // Assert
      await expectRevert(addingEvent, ERR_ARRAY_MISMATCH);
    });

    it("Should revert if we add to many accounts at once", async () => {
      // Assemble
      let addresses = [];
      let balances = [];
      for (let i = 0; i < 1001; i++) {
        let account = web3.eth.accounts.create();
        addresses[i] = account.address;
        balances[i] = web3.utils.toWei(BN(420));
      }
      // Act
      const addingEvent = distribution.setAirdropBalances(addresses, balances);
      // Assert
      await expectRevert(addingEvent, ERR_TOO_MANY);
    });

    it("Should revert if entitlement already started", async () => {
      // Assemble
      await bulkLoad(BN(1000));
      await bestowClaimableBalance(BN(8500));
      const nowTs = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(nowTs);
      // Act
      const addingEvent = distribution.setAirdropBalances([accounts[20]], [BN(1000)]);
      // Assert
      await expectRevert(addingEvent, ERR_ALREADY_STARTED);
    });
  });

  describe("Claiming amounts", async () => {
    let addresses = [
      "0xe1b4F620B46458217f19E548f013D1E63a9Bf0C7",
      "0x79560b567e16F98F6b5Fa2deD7fD8286433b4fAb"
    ]
    let balances = [BN(420), BN(320)];
    let totalBalance = BN(740 - (63 + 48));  // We must ignore initial 15%
    let now = BN(0);

    beforeEach(async () => {
      for (let txNumber = 0; txNumber < 1; txNumber++) {
        // Add addresses to airdrop
        await distribution.setAirdropBalances(addresses, balances);
        // Allocate the right amount of wei
        await bestowClaimableBalance(totalBalance);
        now = (await time.latest()).addn(1);
        // Start the rewarding process
        await distribution.setEntitlementStart(now);
        await time.advanceBlock();
      }
    });

    it("Should Check initial balances", async () => {
      // Assemble
      // Act
      const {
        0: entitlementBalanceWei1,
        1: totalClaimedWei1,
        2: optOutBalance1,
        3: atGenesisWei1
      } = await distribution.airdropAccounts(addresses[0]);
      const {
        0: entitlementBalanceWei2,
        1: totalClaimedWei2,
        2: optOutBalance2,
        3: atGenesisWei2
      } = await distribution.airdropAccounts(addresses[1]);
      const totalEntitlementWei = await distribution.totalEntitlementWei();
      const totalClaimedWei = await distribution.totalClaimedWei();
      // Assert
      assert.equal(entitlementBalanceWei1.toNumber(), 420 * 0.85);
      assert.equal(totalClaimedWei1.toNumber(), 0);
      assert.equal(optOutBalance1.toNumber(), 0);
      assert.equal(atGenesisWei1.toNumber(), 63);
      assert.equal(entitlementBalanceWei2.toNumber(), 320 * 0.85);
      assert.equal(totalClaimedWei2.toNumber(), 0);
      assert.equal(optOutBalance2.toNumber(), 0);
      assert.equal(atGenesisWei2.toNumber(), 48);
      assert.equal(totalEntitlementWei.toNumber(), 629);
      assert.equal(totalClaimedWei.toNumber(), 0);
    });

    it("Should not be able to claim anything on day 1", async () => {
      // Assemble
      // Act
      const claimable1 = await distribution.getClaimableAmountOf(addresses[0]);
      const claimable2 = await distribution.getClaimableAmountOf(addresses[1]);
      // Assert
      assert.equal(claimable1.toNumber(), 0);
      assert.equal(claimable2.toNumber(), 0);
    });

    it("Should not be able to claim anything on day 28", async () => {
      // Assemble
      await time.increaseTo(now.addn(86400 * 28));
      // Act
      const claimable1 = await distribution.getClaimableAmountOf(addresses[0]);
      const claimable2 = await distribution.getClaimableAmountOf(addresses[1]);
      // Assert
      assert.equal(claimable1.toNumber(), 0);
      assert.equal(claimable2.toNumber(), 0);
    });

    it("Should be able to claim 2.37% after day 30", async () => {
      // Assemble
      await time.increaseTo(now.addn(86400 * 30 + 20));
      // Act
      const claimable1 = await distribution.getClaimableAmountOf(addresses[0]);
      const claimable2 = await distribution.getClaimableAmountOf(addresses[1]);
      // Assert
      assert.equal(claimable1.toNumber(), 9);
      assert.equal(claimable2.toNumber(), 7);
    });

    it("Should be able to claim 3*2.37% after day 90", async () => {
      // Assemble
      await time.increaseTo(now.addn(86400 * 90 + 20));
      // Act
      const claimable1 = await distribution.getClaimableAmountOf(addresses[0]);
      const claimable2 = await distribution.getClaimableAmountOf(addresses[1]);
      // Assert
      assert.equal(claimable1.toNumber(), 29);
      assert.equal(claimable2.toNumber(), 22);
    });

    it("Should be able to claim 85% after day 1080", async () => {
      // Assemble
      await time.increaseTo(now.add(BN(86400).muln(1080).addn(20)));
      // Act
      const claimable1 = await distribution.getClaimableAmountOf(addresses[0]);
      const claimable2 = await distribution.getClaimableAmountOf(addresses[1]);
      // Assert
      assert.equal(claimable1.toNumber(), 357);
      assert.equal(claimable2.toNumber(), 272);
    });
  });

  describe("Time till next claimable Wei", async () => {
    let nowTs = BN(0);

    beforeEach(async () => {
      await bulkLoad(BN(1000));
      await bestowClaimableBalance(BN(8500));
      nowTs = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(nowTs);
      await time.advanceBlock();
    });

    it("Should be 30 days right after start", async () => {
      const timeTillClaim = await distribution.secondsTillNextClaim({ from: claimants[0] });
      assert.equal(timeTillClaim.toNumber(), 30 * 24 * 60 * 60 - 1);
    });

    it("Should be 10 days after 20 days has passed", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 20)));
      const timeTillClaim = await distribution.secondsTillNextClaim({ from: claimants[0] });
      assert.equal(timeTillClaim.toNumber(), 10 * 24 * 60 * 60);
    });

    it("Should be 7 days after 53 days has passed", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 53)));
      const timeTillClaim = await distribution.secondsTillNextClaim({ from: claimants[0] });
      assert.equal(timeTillClaim.toNumber(), 7 * 24 * 60 * 60);
    });

    it("Should be 1 second just before end of distribution", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 30).muln(36).subn(1)));
      const timeTillClaim = await distribution.secondsTillNextClaim({ from: claimants[0] });
      assert.equal(timeTillClaim.toNumber(), 1);
    });

    it("Should Revert after 36 months has passed", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 30).muln(36)));
      const timeTillClaim_promise = distribution.secondsTillNextClaim({ from: claimants[0] });
      await expectRevert(timeTillClaim_promise, ERR_FULLY_CLAIMED);
    });
  });

  describe("account load", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Should ignore loading bulk again", async () => {
      // Assemble
      // Act
      await bulkLoad(BN(1000));
      // Assert
      const totalEntitlementWei = await distribution.totalEntitlementWei();
      assert.equal(totalEntitlementWei.toNumber(), 8500);
    });

    it("Should bulk load and total account entitlement balances", async () => {
      // Assemble
      // Act
      // Assert
      const totalEntitlementWei = await distribution.totalEntitlementWei();
      assert.equal(totalEntitlementWei.toNumber(), 8500);
    });

    it("Should have loaded an account with an entitlement balance", async () => {
      // Assemble
      // Act
      // Assert
      const { 0: entitlementBalanceWei } = await distribution.airdropAccounts(claimants[0]);
      assert.equal(entitlementBalanceWei.toNumber(), 850);
    });
  });

  describe("entitlement startup", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Should start entitlement", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      // Act
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Assert
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
    });

    it("Should emit entitlement start event", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      // Act
      const now = (await time.latest()).addn(1);
      const startEvent = await distribution.setEntitlementStart(now);
      // Assert
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      expectEvent(startEvent, EVENT_ENTITLEMENT_START);
    });

    it("Should not start entitlement if not in balance", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8000));
      // Act
      const now = (await time.latest()).addn(1);
      let start_promise = distribution.setEntitlementStart(now);
      // Assert
      await expectRevert(start_promise, ERR_OUT_OF_BALANCE);
    });

    it("Should not start entitlement if not from governance", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      // Act
      const now = (await time.latest()).addn(1);
      let start_promise = distribution.setEntitlementStart(now, { from: accounts[1] });
      // Assert
      await expectRevert(start_promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not allow entitlement start to be pushed in the past", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(10);
      await distribution.setEntitlementStart(now);
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      // Act
      const before = now.subn(60 * 60 * 24 * 5);
      const restart_promise = distribution.setEntitlementStart(before);
      // Assert
      await expectRevert(restart_promise, ERR_WRONG_START_TIMESTAMP);
    });

    it("Should allow entitlement start to be pushed in the future", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(10);
      await distribution.setEntitlementStart(now);
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      await distribution.setEntitlementStart(later);
      // Assert
      const entitlementStartTs2 = await distribution.entitlementStartTs();
      assert(entitlementStartTs2.eq(later));
    });

    it("Should not allow entitlement start to be pushed in the future if already started", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      const restart_promise = distribution.setEntitlementStart(later);
      // Assert
      await expectRevert(restart_promise, ERR_ALREADY_STARTED);
    });

    it("Should not allow entitlement start to be pushed to far in the future", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(10);
      await distribution.setEntitlementStart(now);
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      // Act
      const later = now.subn(60 * 60 * 24 * 10);
      const restart_promise = distribution.setEntitlementStart(later);
      // Assert
      await expectRevert(restart_promise, ERR_WRONG_START_TIMESTAMP);
    });
  });

  describe("Token Pool tests", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Returns proper token pool numbers to be used by token pool at initial time", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const { 0: allocatedWei, 1: inflationWei, 2: claimedWei } = await distribution.getTokenPoolSupplyData()
      // Assert
      assert.equal(allocatedWei.toString(10), "8500");
      assert.equal(inflationWei.toString(10), "0");
      assert.equal(claimedWei.toString(10), "0");
    });

    it("Returns proper token pool numbers after some claiming", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      await time.increaseTo(now.add(BN(86400 * 30).muln(36).addn(150)));
      for (let i of [0, 1, 2, 3, 4, 5]) {
        await distribution.claim(claimants[i], { from: claimants[i] });
      }
      // Assert
      let { 0: allocatedWei, 1: inflationWei, 2: claimedWei } = await distribution.getTokenPoolSupplyData()
      assert.equal(allocatedWei.toString(10), "8500");
      assert.equal(inflationWei.toString(10), "0");
      assert.equal(claimedWei.toString(10), "5100");
    });
  });

  describe("Claiming", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Should not be able to claim before entitelment start", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      // Act
      const claimPrommise = distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      await expectRevert(claimPrommise, ERR_NOT_STARTED);
    });

    it("Should not be able to claim if not registered to distribution", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const optOutRevert = distribution.claim(accounts[150], { from: accounts[150] });
      // Assert
      await expectRevert(optOutRevert, ERR_NOT_REGISTERED);
    });

    it("Should claim claimable entitlement 1 month from start", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Time travel to next month
      await time.increaseTo(now.addn(86400 * 31));
      // Act
      const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const claimResult = await distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), Math.floor(1000 * 2.37 / 100));
    });

    it("Should emit claiming event", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Time travel to next month
      await time.increaseTo(now.addn(86400 * 31));
      // Act
      const claimResult = await distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      expectEvent(claimResult, EVENT_ACCOUNT_CLAIM);
    });

    it("Should revert while claiming", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Time travel to next month
      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let gasConsumer = await GasConsumer.new(3)
      const claim = distribution.claim(gasConsumer.address, { from: claimants[0] });
      // should revert because contract gasConsumer cannot receive tokens
      await expectRevert(claim, "error");
    });

    it("Should update variables after claimal", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      await time.increaseTo(now.addn(86400 * 31));
      const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const claimResult = await distribution.claim(claimants[0], { from: claimants[0] });
      const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), Math.floor(1000 * 2.37 / 100));
      // Act
      const {
        0: entitlementBalanceWei1,
        1: totalClaimedWei1,
        2: optOutBalance1,
        3: airdroppedWei1
      } = await distribution.airdropAccounts(claimants[0]);
      const {
        0: entitlementBalanceWei2,
        1: totalClaimedWei2,
        2: optOutBalance2,
        3: airdroppedWei2
      } = await distribution.airdropAccounts(claimants[1]);
      const totalEntitlementWei = await distribution.totalEntitlementWei();
      const totalClaimedWei = await distribution.totalClaimedWei();
      // Assert
      assert.equal(entitlementBalanceWei1.toNumber(), 850);
      assert.equal(totalClaimedWei1.toNumber(), 23);
      assert.equal(optOutBalance1.toNumber(), 0);
      assert.equal(airdroppedWei1.toNumber(), 150);
      assert.equal(entitlementBalanceWei2.toNumber(), 850);
      assert.equal(totalClaimedWei2.toNumber(), 0);
      assert.equal(optOutBalance2.toNumber(), 0);
      assert.equal(airdroppedWei2.toNumber(), 150);
      assert.equal(totalEntitlementWei.toNumber(), 8500);
      assert.equal(totalClaimedWei.toNumber(), 23);
    });

    it("Should not be able to claim if no funds are claimable at given time", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      await expectRevert(claimResult, ERR_NO_BALANCE_CLAIMABLE);
    });

    it("Should not be able to claim if already claimed in this month", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      await time.increaseTo(now.add(BN(86400 * 30).muln(2).addn(150)));
      await distribution.claim(claimants[0], { from: claimants[0] });
      const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      await expectRevert(claimResult, ERR_NO_BALANCE_CLAIMABLE);
    });

    it("Should not be able to claim after opt-out", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      await distribution.optOutOfAirdrop({ from: claimants[0] });
      await time.increaseTo(now.add(BN(86400 * 30).muln(2).addn(150)));
      const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      await expectRevert(claimResult, ERR_OPT_OUT);
    });

    it("Should emit opt-out event", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const optOutEvent = await distribution.optOutOfAirdrop({ from: claimants[0] });
      // Assert
      expectEvent(optOutEvent, EVENT_ACCOUNT_OPT_OUT);
    });

    it("Should not be able to opt-out if not registered to distribution", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const optOutRevert = distribution.optOutOfAirdrop({ from: accounts[150] });
      // Assert
      await expectRevert(optOutRevert, ERR_NOT_REGISTERED);
    });

    it("Should not be able to opt-out after fully claimed", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      await time.increaseTo(now.add(BN(86400 * 30).muln(36).addn(150)));
      await distribution.claim(claimants[0], { from: claimants[0] });
      const optOutRevert = distribution.optOutOfAirdrop({ from: claimants[0] });
      // Assert
      await expectRevert(optOutRevert, ERR_FULLY_CLAIMED);
    });

    it("Should not be able to claim wei after opt-out even if it was allocated", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      await time.increaseTo(now.add(BN(86400 * 30).muln(2).addn(150)));
      await distribution.optOutOfAirdrop({ from: claimants[0] });
      const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
      // Assert
      await expectRevert(claimResult, ERR_OPT_OUT);
      const {
        1: cl0totalClaimed,
        2: cl0totalOptOut,
      } = await distribution.airdropAccounts(claimants[0]);
      assert.equal(cl0totalClaimed.toNumber(), 0);
      assert.equal(cl0totalOptOut.toNumber(), 850);
    });
  });

  describe("Withdrawing opt-out Wei", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
      await bestowClaimableBalance(BN(8500));
    });

    it("Should not be able to withdraw before entitlement started", async () => {
      // Assemble
      // Act
      const withdrawPrommise = distribution.withdrawOptOutWei(GOVERNANCE_ADDRESS);
      // Assert
      await expectRevert(withdrawPrommise, ERR_NOT_STARTED);
    });

    it("Should not be able to withdraw from not governed account", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const withdrawPrommise = distribution.withdrawOptOutWei(GOVERNANCE_ADDRESS, { from: claimants[0] });
      // Assert
      await expectRevert(withdrawPrommise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not be able to withdraw if there are no founds", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      const withdrawPrommise = distribution.withdrawOptOutWei(GOVERNANCE_ADDRESS);
      // Assert
      await expectRevert(withdrawPrommise, ERR_NO_BALANCE_CLAIMABLE);
    });

    it("Should be able to withdraw if some account opts out", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      await distribution.optOutOfAirdrop({ from: claimants[0] })
      const initBalance = BN(await web3.eth.getBalance(claimants[1]));
      // Act
      const withdrawnResult = await distribution.withdrawOptOutWei(claimants[1]);
      const txCost = BN(await calcGasCost(withdrawnResult));
      const endBalance = BN(await web3.eth.getBalance(claimants[1]));
      // Assert
      assert.equal(endBalance.sub(initBalance).toNumber(), 850);
    });

    it("Should emit withdraw event", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      await distribution.optOutOfAirdrop({ from: claimants[0] })
      // Act
      const withdrawnResult = await distribution.withdrawOptOutWei(GOVERNANCE_ADDRESS);
      // Assert
      expectEvent(withdrawnResult, EVENT_OPT_OPT_WITHDRAWN);
    });

    it("Should be able to withdraw if some account opts out 2", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      const withdrawTo = web3.eth.accounts.create();
      await distribution.setEntitlementStart(now);
      await distribution.optOutOfAirdrop({ from: claimants[0] })
      const initBalance = BN(await web3.eth.getBalance(withdrawTo.address));
      // Act
      const withdrawResult = await distribution.withdrawOptOutWei(withdrawTo.address);
      const txCost = BN(await calcGasCost(withdrawResult));
      const endBalance = BN(await web3.eth.getBalance(withdrawTo.address));
      // Assert
      assert.equal(endBalance.sub(initBalance).toNumber(), 850);
    });

    it("Should not be able to withdraw if some account opts out and it is already withdrawn", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      const withdrawTo = web3.eth.accounts.create();
      await distribution.setEntitlementStart(now);
      await distribution.optOutOfAirdrop({ from: claimants[0] })
      const initBalance = BN(await web3.eth.getBalance(withdrawTo.address));
      const withdrawnResult = await distribution.withdrawOptOutWei(withdrawTo.address);
      const txCost = BN(await calcGasCost(withdrawnResult));
      const endBalance = BN(await web3.eth.getBalance(withdrawTo.address));
      assert.equal(endBalance.sub(initBalance).toNumber(), 850);
      // Act
      const withdrawPrommise = distribution.withdrawOptOutWei(withdrawTo.address);
      // Assert
      await expectRevert(withdrawPrommise, ERR_NO_BALANCE_CLAIMABLE);
    });
  });

  describe("Pending claim entitlements with claiming", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Should not have a pending claimable entitlement since just started", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      await time.advanceBlock();
      // Act
      const entitlementPending = await distribution.getClaimableAmountOf(claimants[0]);
      // Assert
      assert.equal(entitlementPending.toNumber(), 0);
    });

    it("Should not have a pending claimable entitlement since just started 2", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      await time.advanceBlock();
      // Act
      const entitlementPending = await distribution.getClaimableAmount({ from: claimants[0] });
      // Assert
      assert.equal(entitlementPending.toNumber(), 0);
    });

    it("Should simmulate claiming light", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Initial balances
      const openingBalance0 = BN(await web3.eth.getBalance(claimants[0]));
      const openingBalance1 = BN(await web3.eth.getBalance(claimants[1]));
      const openingBalance5 = BN(await web3.eth.getBalance(claimants[5]));
      const openingBalance6 = BN(await web3.eth.getBalance(claimants[6]));
      // Time travel to next month
      await time.increaseTo(now.addn(86400 * 30 + 150));
      const claimResult0 = await distribution.claim(claimants[0], { from: claimants[0] });
      const claimResult5 = await distribution.claim(claimants[5], { from: claimants[5] });
      const midBalance0 = BN(await web3.eth.getBalance(claimants[0]));
      const midBalance1 = BN(await web3.eth.getBalance(claimants[1]));
      const midBalance5 = BN(await web3.eth.getBalance(claimants[5]));
      const midBalance6 = BN(await web3.eth.getBalance(claimants[6]));
      // Time travel another month
      await time.increaseTo(now.addn(86400 * 60 + 150));
      const claimResult0_1 = await distribution.claim(claimants[0], { from: claimants[0] });
      const claimResult1 = await distribution.claim(claimants[1], { from: claimants[1] });
      const endBalance0 = BN(await web3.eth.getBalance(claimants[0]));
      const endBalance1 = BN(await web3.eth.getBalance(claimants[1]));
      const endBalance5 = BN(await web3.eth.getBalance(claimants[5]));
      const endBalance6 = BN(await web3.eth.getBalance(claimants[6]));
      // Act
      // Assert
      // ACC 0 balance
      const midVal0 = BN(await calcGasCost(claimResult0));
      assert.equal(midVal0.add(midBalance0).sub(openingBalance0).toNumber(), 23);
      const endVal0 = BN(await calcGasCost(claimResult0_1));
      assert.equal(endVal0.add(endBalance0).sub(midBalance0).toNumber(), 24);
      assert.equal(midVal0.add(endVal0).add(endBalance0).sub(openingBalance0).toNumber(), 47);
      // ACC 1 balance 
      assert.isTrue(openingBalance1.eq(midBalance1));
      const endVal1 = BN(await calcGasCost(claimResult1));
      assert.equal(endVal1.add(endBalance1).sub(midBalance1).toNumber(), 47);
      // ACC 5 balance 
      const midVal5 = BN(await calcGasCost(claimResult5));
      assert.equal(midVal5.add(midBalance5).sub(openingBalance5).toNumber(), 23);
      assert.isTrue(midBalance5.eq(endBalance5));
      // ACC 6 balance 
      assert.isTrue(openingBalance6.eq(midBalance6));
      assert.isTrue(midBalance6.eq(endBalance6));
    });

    it("Should claim the whole thing after the end of claimant", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      // It takes 36 months to claim all 
      await time.increaseTo(now.add(BN(86400 * 30).muln(36).addn(150)));
      const entitlementPending = await distribution.getClaimableAmountOf(claimants[0]);
      // Assert
      assert.equal(entitlementPending.toNumber(), 850);
    });

    it("Should not be able to get pending amount after opt-out", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8500));
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now);
      // Act
      await distribution.optOutOfAirdrop({ from: claimants[0] });
      const pendingPrommise = distribution.getClaimableAmountOf(claimants[0]);
      // Assert
      await expectRevert(pendingPrommise, ERR_OPT_OUT);
    });
  });
});
