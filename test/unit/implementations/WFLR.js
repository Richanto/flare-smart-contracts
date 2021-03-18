const calcGasCost = require('../../utils/eth').calcGasCost;
const getTestFile = require('../../utils/constants').getTestFile;

const WFLR = artifacts.require("WFLR");

contract(`WFLR.sol; ${getTestFile(__filename)}`, async accounts => {
  // a fresh contract for each test
  let wflr;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    wflr = await WFLR.new();
  });

  it("Should accept FLR deposits.", async () => {
    // Assemble
    let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    // Act
    let depositResult = await wflr.deposit({value: 20, from:accounts[1]});
    // Assert
    let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    // Compute the gas cost of the depositResult
    let txCost = await calcGasCost(depositResult);
    // Compute opening vs closing balance difference less gas cost
    assert.equal(flrOpeningBalance.sub(flrClosingBalance).sub(txCost), 20);
  });

  it("Should issue WFLR when FLR deposited.", async () => {
    // Assemble
    // Act
    await wflr.deposit({value: 20, from:accounts[1]});
    let balance = await wflr.balanceOf(accounts[1]);
    let totalBalance = await wflr.totalSupply();
    // Assert
    assert.equal(balance, 20);
    assert.equal(totalBalance, 20);
  });
  
  it("Should burn WFLR when FLR withdrawn.", async () => {
    // Assemble
    await wflr.deposit({value: 50, from:accounts[1]});
    // Act
    await wflr.withdraw(10, {from:accounts[1]});
    let balance = await wflr.balanceOf(accounts[1]);
    let totalBalance = await wflr.totalSupply();
    // Assert
    assert.equal(balance, 40);
    assert.equal(totalBalance, 40);
  });
  
  it("Should redeem FLR withdrawn.", async () => {
    // Assemble
    await wflr.deposit({value: 50, from:accounts[1]});
    let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    // Act
    let withdrawResult = await wflr.withdraw(10, {from:accounts[1]});
    let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let txCost = await calcGasCost(withdrawResult);
    // Assert
    assert.equal(flrOpeningBalance.sub(flrClosingBalance).sub(txCost), -10);
  });

  it("Should accept FLR deposits from another account.", async () => {
    // Assemble
    let a1FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));

    // Act
    let depositResult = await wflr.depositTo(accounts[2], {value: 20, from:accounts[1]});

    // Assert
    let a1FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    let a2WflrBalance = await wflr.balanceOf(accounts[2]);
    // Compute the gas cost of the depositResult
    let txCost = await calcGasCost(depositResult);
    // Compute opening vs closing balance difference less gas cost for A1
    assert.equal(a1FlrOpeningBalance.sub(a1FlrClosingBalance).sub(txCost), 20);
    // FLR should be in A2
    assert(a2FlrClosingBalance.sub(a2FlrOpeningBalance), 20)
    // WFLR for A2 should have been minted
    assert.equal(a2WflrBalance, 20);
  });

  it("Should burn WFLR when FLR withdrawn to another address with allowance.", async () => {
    // Assemble
    await wflr.deposit({value: 50, from:accounts[1]});
    let a1FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    await wflr.increaseAllowance(accounts[1], 30, {from: accounts[2]})
    // Act
    // A1 spending by burning WFLR and moving FLR to A2
    let withdrawResult = await wflr.withdrawFrom(accounts[1], 30, {from: accounts[2]});
    // Assert
    // Compute the gas cost of the withdrawResult
    let txCost = await calcGasCost(withdrawResult);
    // Get the closing balances
    let a1FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    let a1Wflrbalance = await wflr.balanceOf(accounts[1]);
    assert.equal(a1Wflrbalance, 20);
    // TODO: Why is this passing? Isn't accounts[2] supposed to pay some gas?
    assert(a2FlrClosingBalance.sub(a2FlrOpeningBalance), 30);
    assert.equal(a1FlrOpeningBalance.sub(a1FlrClosingBalance), 0);
  });

  // TODO: Test Deposit and Withdrawal events
});