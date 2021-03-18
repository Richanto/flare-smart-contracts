const getTestFile = require('../../utils/constants').getTestFile;
const { artifacts } = require("hardhat");

const CheckPointsByAddressMock = artifacts.require("CheckPointsByAddressMock");

contract(`CheckPointsByAddress.sol; ${getTestFile(__filename)}`, async accounts => {
  // a fresh contract for each test
  let checkPointsByAddressMock;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    checkPointsByAddressMock = await CheckPointsByAddressMock.new();
  });

  it("Should store value now for address 1", async () => {
    // Assemble
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    // Act
    let value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
    // Assert
    assert.equal(value, 10);
  });

  it("Should store historic value for address 1", async () => {
    const b = [];

    // Assemble
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    b[0] = await web3.eth.getBlockNumber();
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 20);
    // Act
    await checkPointsByAddressMock.writeValueOfAt(accounts[1], 100, b[0]);
    // Assert
    let value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[0]);
    assert.equal(value, 100);
  });

  it("Should store value now for different addresses", async () => {
    // Assemble
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[2], 20);
    // Act
    let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
    let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
    // Assert
    assert.equal(address1Value, 10);
    assert.equal(address2Value, 20);
  });

  it("Should store value history for different addresses", async () => {
    const b = [];

    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    b[1] = await web3.eth.getBlockNumber();
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[2], 20);
    b[2] = await web3.eth.getBlockNumber();
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 30);
    b[3] = await web3.eth.getBlockNumber();
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[2], 40);
    b[4] = await web3.eth.getBlockNumber();
    // Act
    let block0Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[0]);
    let block1Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[1]);
    let block2Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[2]);
    let block3Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[3]);
    let block4Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[4]);
    let block0Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[0]);
    let block1Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[1]);
    let block2Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[2]);
    let block3Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[3]);
    let block4Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[4]);
    // Assert
    assert.equal(block0Address1Value, 0);
    assert.equal(block1Address1Value, 10);
    assert.equal(block2Address1Value, 10);
    assert.equal(block3Address1Value, 30);
    assert.equal(block4Address1Value, 30);
    assert.equal(block0Address2Value, 0);
    assert.equal(block1Address2Value, 0);
    assert.equal(block2Address2Value, 20);
    assert.equal(block3Address2Value, 20);
    assert.equal(block4Address2Value, 40);
  });

  it("Should transmit value now between addresses", async () => {
    // Assemble
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[2], 20);
    // Act
    await checkPointsByAddressMock.transmitAtNow(accounts[2], accounts[1], 20);
    // Assert
    let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
    let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
    assert.equal(address1Value, 30);
    assert.equal(address2Value, 0);
  });

  it("Should transmit historic value between addresses", async () => {
    const b = [];
    // Assemble
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[2], 20);
    b[0] = await web3.eth.getBlockNumber();
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 100);
    // Act
    await checkPointsByAddressMock.transmitAt(accounts[2], accounts[1], 20, b[0]);
    // Assert
    let address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[0]);
    let address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[0]);
    assert.equal(address1Value, 30);
    assert.equal(address2Value, 0);
  });

  it("Should transmit value now between addresses", async () => {
    // Assemble
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[1], 10);
    await checkPointsByAddressMock.writeValueOfAtNow(accounts[2], 20);
    // Act
    await checkPointsByAddressMock.transmitAtNow(accounts[2], accounts[1], 20);
    // Assert
    let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
    let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
    assert.equal(address1Value, 30);
    assert.equal(address2Value, 0);
  });
});