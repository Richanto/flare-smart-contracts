// Unit tests for Delegatable behavior library, vote power calculations

const {expectRevert} = require('@openzeppelin/test-helpers');
const {log} = require('../../../utils/log');
const {sumGas} = require('../../../utils/eth');
const {getTestFile} = require('../../../utils/constants');

const Delegatable = artifacts.require("DelegatableMock");

const UNDELEGATED_VP_TOO_SMALL_MSG = "Undelegated vote power too small";

contract(`Delegatable.sol; ${getTestFile(__filename)}; Vote power calculation unit tests`, async accounts => {
  // a fresh contract for each test
  let delegatable;

  // Mimic FAsset spec test case names
  let bob = accounts[1];
  let lucy = accounts[2];
  let ed = accounts[3];

  // Store block numbers
  const b = [];

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegatable = await Delegatable.new();
  });

  // First FAsset token stage 1 unit test
  it("Should delegate by percentage undelegated vote power, with retrievable history", async () => {
    let blockAtStart = 0;
    let blockAfterGeneration = 1;
    let blockAfterLucyDelegation = 2;
    let blockAfterEdDelegation = 3;

    // Assemble
    b[blockAtStart] = await web3.eth.getBlockNumber();
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    await delegatable.mintVotePower(ed, 0);
    b[blockAfterGeneration] = await web3.eth.getBlockNumber();
    // Act
    await delegatable.delegate(lucy, 5000, {from: bob});
    b[blockAfterLucyDelegation] = await web3.eth.getBlockNumber();
    await delegatable.delegate(ed, 2500, {from: bob});
    b[blockAfterEdDelegation] = await web3.eth.getBlockNumber();
    // Assert
    let votePowerOfLucyPriorToDelegation = await delegatable.votePowerOfAt(lucy, b[blockAfterGeneration]);
    let votePowerOfLucyAfterLucyDelegation = await delegatable.votePowerOfAt(lucy, b[blockAfterLucyDelegation]);
    let votePowerOfLucyAfterEdDelegation = await delegatable.votePowerOfAt(lucy, b[blockAfterEdDelegation]);
    assert.equal(votePowerOfLucyPriorToDelegation, 10);
    assert.equal(votePowerOfLucyAfterLucyDelegation, 20);
    assert.equal(votePowerOfLucyAfterEdDelegation, 20);
  });

  // Third FAsset token stage 1 unit test
  it("Should only delegate 1 level deep", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    // let's gen no tokens for Ed to check an edge case
    //await fAssetToken.generateTokens(ed, 0);

    // Act
    await delegatable.delegate(lucy, 5000, {from: bob});
    await delegatable.delegate(ed, 10000, {from: lucy});

    // Assert
    let votePowerOfEd = await delegatable.votePowerOf(ed);
    let votePowerOfLucy =  await delegatable.votePowerOf(lucy);
    let votePowerOfBob =  await delegatable.votePowerOf(bob);
    assert.equal(votePowerOfEd, 10);
    assert.equal(votePowerOfLucy, 10);
    assert.equal(votePowerOfBob, 10);
  });

  it("Should transmit vote power when vote power delegated by percent", async () => {
    // Assemble
    let sum = {gas: 0};
    sumGas(await delegatable.mintVotePower(bob, 20), sum);
    sumGas(await delegatable.mintVotePower(lucy, 10), sum);
    sumGas(await delegatable.mintVotePower(ed, 5), sum);
    //        T   V
    // Bob    20  20
    // Lucy   10  10
    // Ed     5   5

    // Bob delegates 50% voting power to Lucy
    sumGas(await delegatable.delegate(lucy, 5000, {from: bob}), sum);
    //        T   V
    // Bob    20  10
    // Lucy   10  20
    // Ed     5   5

    // Lucy delegates 100% voting power to Ed
    sumGas(await delegatable.delegate(ed, 10000, {from: lucy}), sum);
    //        T   V
    // Bob    20  10
    // Lucy   10  10
    // Ed     5   15

    // Act
    // Bob transfers 10 tokens to Lucy
    sumGas(await delegatable.transmitVotePower(bob, lucy, 10), sum);
    //        T   V
    // Bob    10  5
    // Lucy   20  5
    // Ed     5   25

    // Assert
    log(`    Total gas: ${sum.gas}`);
    // Collect vote power of constituents
    let votePowerOfBob = await delegatable.votePowerOf(bob);
    let votePowerOfLucy = await delegatable.votePowerOf(lucy);
    let votePowerOfEd = await delegatable.votePowerOf(ed);
    assert.equal(votePowerOfBob, 5);
    assert.equal(votePowerOfLucy, 5);
    assert.equal(votePowerOfEd, 25);
  });

  it("Should undelegate all vote power", async () => {
    // Assemble
    await delegatable.mintVotePower(lucy, 50);
    await delegatable.delegate(bob, 30, {from: lucy});
    await delegatable.delegate(ed, 40, {from: lucy});

    // Act
    await delegatable.undelegateAll({from: lucy});

    // Assert
    let votePowerOfBob = await delegatable.votePowerOf(bob);
    let votePowerOfLucy = await delegatable.votePowerOf(lucy);
    let votePowerOfEd = await delegatable.votePowerOf(ed);
    assert.equal(votePowerOfBob, 0);
    assert.equal(votePowerOfLucy, 50);
    assert.equal(votePowerOfEd, 0);
  });

  it("Should delegate when minting tokens", async () => {
    // Assemble
    await delegatable.delegate(accounts[2], 5000, {from: accounts[1]});
    await delegatable.delegate(accounts[3], 5000, {from: accounts[1]});
    // Act
    await delegatable.mintVotePower(accounts[1], 1000);
    // Assert
    let account2VotePower = await delegatable.votePowerOf(accounts[2]);
    let account3VotePower = await delegatable.votePowerOf(accounts[3]);
    assert.equal(account2VotePower, 500);
    assert.equal(account3VotePower, 500);
  });

  it("Should revert when existing delegation is explicit by amount", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    // An explicit VP delegation to Lucy from Bob of 5 
    await delegatable.delegateExplicit(lucy, 5, {from: bob});
    // Act
    // Change to a 50% vote power delegation from Bob to Lucy - yielding VP(lucy) = 20
    let delegatePromise = delegatable.delegate(lucy, 5000, {from: bob});
    // Assert
    await expectRevert.assertion(delegatePromise);
  });

  it("Should compute undelegated amount when delegated by percentage", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    await delegatable.delegate(lucy, 5000, {from: bob});
    // Act
    let undelegatedBob = await delegatable.undelegatedVotePowerOf(bob);
    let undelegatedLucy = await delegatable.undelegatedVotePowerOf(lucy);
    // Assert
    assert.equal(undelegatedBob, 10);
    assert.equal(undelegatedLucy, 10);
  });

  it("Should explicitly delegate vote power, with retrievable history", async () => {
    // Do not try to manipulate mining...not necessary for this testing need.
    let blockAtStart = 0;
    let blockAfterGeneration = 1;
    let blockAfterLucyDelegation = 2;
    let blockAfterEdDelegation = 3;

    // Assemble
    b[blockAtStart] = await web3.eth.getBlockNumber();
    await delegatable.mintVotePower(bob, 200);
    await delegatable.mintVotePower(lucy, 100);
    await delegatable.mintVotePower(ed, 0);
    b[blockAfterGeneration] = await web3.eth.getBlockNumber();
    // Act
    await delegatable.delegateExplicit(lucy, 50, {from: bob});
    b[blockAfterLucyDelegation] = await web3.eth.getBlockNumber();
    await delegatable.delegateExplicit(ed, 25, {from: bob});
    b[blockAfterEdDelegation] = await web3.eth.getBlockNumber();
    // Assert
    let votePowerOfLucyPriorToDelegation = await delegatable.votePowerOfAt(lucy, b[blockAfterGeneration]);
    let votePowerOfLucyAfterLucyDelegation = await delegatable.votePowerOfAt(lucy, b[blockAfterLucyDelegation]);
    let votePowerOfLucyAfterEdDelegation = await delegatable.votePowerOfAt(lucy, b[blockAfterEdDelegation]);
    let votePowerOfBobAfterEdDelegation = await delegatable.votePowerOfAt(bob, b[blockAfterEdDelegation]);
    assert.equal(votePowerOfLucyPriorToDelegation, 100);
    assert.equal(votePowerOfLucyAfterLucyDelegation, 150);
    assert.equal(votePowerOfLucyAfterEdDelegation, 150);
    assert.equal(votePowerOfBobAfterEdDelegation, 125);
  });

  it("Should transfer undelegated vote power when some explicitly delegated", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    await delegatable.delegateExplicit(lucy, 10, {from: bob});
    // Act
    await delegatable.transmitVotePower(bob, ed, 10);
    // Assert
    let votePowerOfBob = await delegatable.votePowerOf(bob);
    let votePowerOfLucy =  await delegatable.votePowerOf(lucy);
    let votePowerOfEd =  await delegatable.votePowerOf(ed);
    assert.equal(votePowerOfBob, 0);
    assert.equal(votePowerOfLucy, 20);
    assert.equal(votePowerOfEd, 10);
  });

  it("Given being delegated to, should not transmit vote power with explicit delegations > undelegated amount", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    // Delegate 10 to Lucy from Bob
    await delegatable.delegateExplicit(lucy, 10, {from: bob});
    // Act
    // Try to transfer 15 from Bob to Ed
    let transferPromise = delegatable.transmitVotePower(bob, ed, 15);
    // Assert
    // Bob should only have 10 unallocated VP to transfer
    await expectRevert(transferPromise, UNDELEGATED_VP_TOO_SMALL_MSG);
  });

  it("Should undelegate all explicitly delegated vote power", async () => {
    // Assemble
    await delegatable.mintVotePower(lucy, 500);
    await delegatable.delegateExplicit(bob, 30, {from: lucy});
    await delegatable.delegateExplicit(ed, 40, {from: lucy});

    // Act
    await delegatable.undelegateAll({from: lucy});

    // Assert
    let votePowerOfBob = await delegatable.votePowerOf(bob);
    let votePowerOfLucy = await delegatable.votePowerOf(lucy);
    let votePowerOfEd = await delegatable.votePowerOf(ed);
    assert.equal(votePowerOfBob, 0);
    assert.equal(votePowerOfLucy, 500);
    assert.equal(votePowerOfEd, 0);
  });

  it("Should not explicitly delegate if not enough vote power", async () => {
    // Assemble
    // Act
    let delegatePromise = delegatable.delegateExplicit(lucy, 10, {from: bob});
    // Assert
    await expectRevert(delegatePromise, UNDELEGATED_VP_TOO_SMALL_MSG);
  });

  it("Should compute undelegated amount when explicitly delegated", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    await delegatable.delegateExplicit(lucy, 10, {from: bob});
    // Act
    let undelegatedBob = await delegatable.undelegatedVotePowerOf(bob);
    let undelegatedLucy = await delegatable.undelegatedVotePowerOf(lucy);
    // Assert
    assert.equal(undelegatedBob, 10);
    assert.equal(undelegatedLucy, 10);
  });

  it("Should burn vote power", async () => {
    // Assemble
    await delegatable.mintVotePower(lucy, 50);
    await delegatable.delegate(bob, 3000, {from: lucy});
    await delegatable.delegate(ed, 4000, {from: lucy});

    // Act
    await delegatable.burnVotePower(lucy, 10);

    // Assert
    let votePowerOfBob = await delegatable.votePowerOf(bob);
    let votePowerOfLucy = await delegatable.votePowerOf(lucy);
    let votePowerOfEd = await delegatable.votePowerOf(ed);
    assert.equal(votePowerOfBob, 12);
    assert.equal(votePowerOfLucy, 12);
    assert.equal(votePowerOfEd, 16);
  });

  it("Should not burn vote power when explicitly delegated and undelegated amount < amount to burn", async () => {
    // Assemble
    await delegatable.mintVotePower(bob, 20);
    await delegatable.mintVotePower(lucy, 10);
    await delegatable.delegateExplicit(lucy, 10, {from: bob});
    // Act
    let burnPromise = delegatable.burnVotePower(bob, 11);
    // Assert
    await expectRevert(burnPromise, UNDELEGATED_VP_TOO_SMALL_MSG);
  });
});
