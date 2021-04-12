import { DummyFAssetMinterContract, 
  DummyFAssetMinterInstance, 
  FAssetTokenContract,
  FAssetTokenInstance,
  FlareKeeperContract,
  FtsoContract,
  FtsoInstance,
  InflationContract,
  RewardManagerContract,
  WFLRContract} from "../typechain-truffle";

import { pascalCase } from "pascal-case";

const BN = web3.utils.toBN;
const { time } = require('@openzeppelin/test-helpers');

const serializedParameters = `{
  "flareKeeperAddress": "0x1000000000000000000000000000000000000002",
  "deployerPrivateKey": "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122",
  "governancePrivateKey": "0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb",
  "inflationFundWithdrawTimeLockSec": 10,
  "totalFlrSupply": 100000000000,
  "rewardEpochDurationSec": 172800,
  "priceEpochDurationSec": 120,
  "XRP": {
    "fAssetName": "Flare Asset XRP",
    "fAssetSymbol": "FXRP",
    "fAssetDecimals": 6,
    "dummyFAssetMinterMax": 1000
  },
  "LTC": {
    "fAssetName": "Flare Asset Litecoin",
    "fAssetSymbol": "FLTC",
    "fAssetDecimals": 6,
    "dummyFAssetMinterMax": 1000
  },
  "XDG": {
    "fAssetName": "Flare Asset Dogecoin",
    "fAssetSymbol": "FXDG",
    "fAssetDecimals": 6,
    "dummyFAssetMinterMax": 1000
  }
}`;

class Contract {
  name: string;
  address: string;

  constructor(name: string, address: string) {
    this.name = name;
    this.address = address;
  }
}

class Contracts {
  collection: Contract[];

  constructor() {
    this.collection = [];
  }

  add(contract: Contract) {
    this.collection.push(contract);
  }

  serialize(): string {
    return JSON.stringify(this.collection);
  }
}

const parameters = JSON.parse(serializedParameters);

async function main(parameters: any) {
  // Define repository for created contracts
  const contracts = new Contracts();

  // Define accounts in play for the deployment process
  const deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  const governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const FlareKeeper = artifacts.require("FlareKeeper") as FlareKeeperContract;
  const Inflation = artifacts.require("Inflation") as InflationContract;
  const RewardManager = artifacts.require("RewardManager") as RewardManagerContract;
  const WFLR = artifacts.require("WFLR") as WFLRContract;

  // Inflation contract
  const inflation = await Inflation.new(deployerAccount.address, 
    parameters.inflationFundWithdrawTimeLockSec, 
    web3.utils.toWei(BN(parameters.totalFlrSupply)));
  spewNewContractInfo(contracts, Inflation.contractName, inflation.address);

  // RewardManager contract
  // Get the timestamp for the just mined block
  const startTs = await time.latest();
  const rewardManager = await RewardManager.new(
    deployerAccount.address,
    inflation.address,
    parameters.rewardEpochDurationSec,
    parameters.priceEpochDurationSec,
    startTs,
    startTs
  );
  spewNewContractInfo(contracts, RewardManager.contractName, rewardManager.address);

  // Initialize the keeper
  const flareKeeper = await FlareKeeper.at(parameters.flareKeeperAddress);
  spewNewContractInfo(contracts, FlareKeeper.contractName, flareKeeper.address);
  await flareKeeper.initialise(deployerAccount.address);

  // Register reward manager to the keeper
  await flareKeeper.registerToKeep(rewardManager.address);

  // Deploy wrapped FLR
  const wflr = await WFLR.new();
  spewNewContractInfo(contracts, WFLR.contractName, wflr.address);

  // Deploy FAsset, minter, and ftso for XRP
  console.log("Rigging XRP...");
  await deployNewFAsset(
    contracts,
    deployerAccount.address, 
    rewardManager.address, 
    wflr.address, 
    parameters.XRP.fAssetName, 
    parameters.XRP.fAssetSymbol, 
    parameters.XRP.dummyFAssetMinterMax);

  // Deploy FAsset, minter, and ftso for LTC
  console.log("Rigging LTC...");
  await deployNewFAsset(
    contracts,
    deployerAccount.address, 
    rewardManager.address, 
    wflr.address, 
    parameters.LTC.fAssetName, 
    parameters.LTC.fAssetSymbol, 
    parameters.LTC.dummyFAssetMinterMax);

  // Deploy FAsset, minter, and ftso for XDG
  console.log("Rigging XDG...");
  await deployNewFAsset(
    contracts,
    deployerAccount.address, 
    rewardManager.address, 
    wflr.address, 
    parameters.XDG.fAssetName, 
    parameters.XDG.fAssetSymbol, 
    parameters.XDG.dummyFAssetMinterMax);

  // Activate the reward manager
  console.log("Activating reward manager...");
  await rewardManager.activate();

  // Turn over governance
  console.log("Transfering governance...");
  await flareKeeper.proposeGovernance(governanceAccount.address);
  await rewardManager.proposeGovernance(governanceAccount.address);
  await inflation.proposeGovernance(governanceAccount.address);

  console.log("Contracts in JSON:");

  console.log(contracts.serialize());

  console.log("Deploy complete.");
}

async function deployNewFAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  rewardManagerAddress: string,
  wflrAddress: string, 
  name: string, 
  symbol: string, 
  maxMintRequestTwei: number):
  Promise<{fAssetToken: FAssetTokenInstance, 
    dummyFAssetMinter: DummyFAssetMinterInstance, 
    ftso: FtsoInstance}> {

  const DummyFAssetMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
  const FAssetToken = artifacts.require("FAssetToken") as FAssetTokenContract;
  const Ftso = artifacts.require("Ftso") as FtsoContract;

  // Deploy FAsset
  const fAssetToken = await FAssetToken.new(deployerAccountAddress, name, symbol);
  spewNewContractInfo(contracts, symbol, fAssetToken.address);

  // Deploy dummy FAsset minter
  const dummyFAssetMinter = await DummyFAssetMinter.new(fAssetToken.address, maxMintRequestTwei);
  spewNewContractInfo(contracts, `Dummy ${symbol} minter`, dummyFAssetMinter.address);

  // Establish governance over FAsset by minter
  await fAssetToken.proposeGovernance(dummyFAssetMinter.address, {from: deployerAccountAddress});
  await dummyFAssetMinter.claimGovernanceOverMintableToken();

  // Register an FTSO for the new FAsset
  const ftso = await Ftso.new(wflrAddress, fAssetToken.address, rewardManagerAddress);
  spewNewContractInfo(contracts, `FTSO ${symbol}/WFLR`, ftso.address);

  return {fAssetToken, dummyFAssetMinter, ftso};
}

function spewNewContractInfo(contracts: Contracts, name: string, address: string) {
  console.log(`${name} contract: `, address);
  contracts.add(new Contract(pascalCase(name), address));
}

main(parameters)
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });