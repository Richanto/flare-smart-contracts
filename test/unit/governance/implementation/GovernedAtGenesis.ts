import { GovernedAtGenesisInstance } from "../../../../typechain-truffle";

import {constants, expectRevert, expectEvent} from '@openzeppelin/test-helpers';
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
const getTestFile = require('../../../utils/constants').getTestFile;

const GovernedAtGenesis = artifacts.require("GovernedAtGenesis");

const ALREADY_INIT_MSG = "initialised != false";
const ONLY_GOVERNANCE_MSG = "only governance";


contract(`GovernedAtGenesis.sol; ${getTestFile(__filename)};`, async accounts => {
  // contains a fresh contract for each test
  let governedAtGenesis: GovernedAtGenesisInstance;

  beforeEach(async() => {
    governedAtGenesis = await GovernedAtGenesis.new(constants.ZERO_ADDRESS);
  });

  describe("initialise", async() => {
    it("Should not initialize with a specifiable governance address", async() => {
      // Assemble
      // Act
      let initializePromise = governedAtGenesis.initialise(accounts[1]);
      // Assert
      await expectRevert.assertion(initializePromise);
    });

    it("Should initialize with a fixed governance address", async() => {
      // Assemble
      // Act
      await governedAtGenesis.initialiseFixedAddress();
      // Assert
      let governedAddress = await governedAtGenesis.governance();
      assert.equal(governedAddress, GOVERNANCE_GENESIS_ADDRESS);
    });  

    it("Should not initialize twice", async() => {
      // Assemble
      await governedAtGenesis.initialiseFixedAddress();
      // Act
      let initializePromise = governedAtGenesis.initialiseFixedAddress();
      // Assert
      await expectRevert(initializePromise, ALREADY_INIT_MSG);
    });

    it("Should not switch to production if not initialized to fixed address", async() => {
      const promise1 = governedAtGenesis.switchToProductionMode();
      await expectRevert(promise1, ONLY_GOVERNANCE_MSG);
      const promise2 = governedAtGenesis.switchToProductionMode({ from: GOVERNANCE_GENESIS_ADDRESS });
      await expectRevert(promise2, ONLY_GOVERNANCE_MSG);
    });
  });
});
