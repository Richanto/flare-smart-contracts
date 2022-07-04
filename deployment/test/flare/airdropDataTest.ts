const parse = require('csv-parse/lib/sync');
const fs = require("fs");
const web3 = require("web3");
const toBN = web3.utils.toBN;
const IsAddress = web3.utils.isAddress;
const cliProgress = require('cli-progress');
import path from "path";
import {LineItem, ProcessedLineItem} from "../../../airdrop/flare/utils/airdropTypes"
// const airdropExports = require("../../airdrop/data");

import InitialAirdropAbi from "../../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { InitialAirdrop } from "../../../typechain-web3/InitialAirdrop";

import DistributionAbi from "../../../artifacts/contracts/tokenPools/implementation/Distribution.sol/Distribution.json";
import { Distribution } from "../../../typechain-web3/Distribution";


function parseAndProcessData(dataFile:string):ProcessedLineItem[] {
  let data = fs.readFileSync(dataFile, "utf8");
  const parsed_file:LineItem[] = parse( data, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ',',
    skip_lines_with_error: true
  })
  let seenNATAddressesDetail: {[name: string]: BN } = {};
  let seenNATAddresses:Set<string> = new Set();
  for(let XRPLine of parsed_file){
    if(!seenNATAddresses.has(XRPLine.FlareAddress)){
      seenNATAddresses.add(XRPLine.FlareAddress);
      seenNATAddressesDetail[XRPLine.FlareAddress] = toBN(XRPLine.FlareBalance);
    } 
    else {
      seenNATAddressesDetail[XRPLine.FlareAddress] =seenNATAddressesDetail[XRPLine.FlareAddress].add(toBN(XRPLine.FlareBalance));
    }    
  }
  let processedFile:ProcessedLineItem[] = []
  for(let natAdd of seenNATAddresses){
    let tempTotal = seenNATAddressesDetail[natAdd];
    let tempAirdrop = tempTotal.muln(15).divn(100);
    processedFile.push(
        {
          NativeAddress: natAdd,
          totalNativeBalance: tempTotal,
          initialAirdropBalance: tempAirdrop,
          distributionMonthlyBalance: tempTotal.muln(3).divn(100),
          totalDistributionBalance: tempTotal.sub(tempAirdrop),
        }
    ) 
  }
  return processedFile;
}

contract(`Airdrop testing: Airdrop transactions validation tests tests for Flare mainnet deployment`, async accounts => {
  let parsedAirdrop: ProcessedLineItem[];
  let web3Provider: string;
  let Web3: any;
  let airdropSigner: string;
  let InitialAirdropContract: InitialAirdrop;
  let DistributionContract: Distribution;
  const deploymentName = "deployment/deploys/staging.json"

  before(async() => {
    const airdropExports = path.join(process.cwd(), '/airdrop/flare/data/export.csv')
    parsedAirdrop = parseAndProcessData(airdropExports);
    if (process.env.WEB3_PROVIDER_URL) {
      web3Provider = process.env.WEB3_PROVIDER_URL
      Web3 = new web3(web3Provider);
    }
    else {
        console.error("No WEB3_PROVIDER_URL provided in env");
        throw new Error("No WEB3_PROVIDER_URL provided in env");
    }
    if (process.env.AIRDROP_PUBLIC_KEY) {
      airdropSigner = process.env.AIRDROP_PUBLIC_KEY
    }
    else {
        console.error("No AIRDROP_PUBLIC_KEY provided in env");
        throw new Error("No AIRDROP_PUBLIC_KEY provided in env");
    }
    if(!fs.existsSync(deploymentName)){
      console.error(`No file at ${deploymentName}`);
      throw new Error(`No file at ${deploymentName}`);
  }
  
  const rawDeploy = fs.readFileSync(deploymentName)
  const contractArray = JSON.parse(rawDeploy as any) as {name: string, contractName: string, address: string} []
  
  const InitialAirdropAddress = contractArray.find((elem) => elem.contractName === 'InitialAirdrop.sol')
  const DistributionAddress = contractArray.find((elem) => elem.contractName === 'Distribution.sol')

    try{
      InitialAirdropContract = new web3.eth.Contract(
        InitialAirdropAbi.abi,
        InitialAirdropAddress?.address || ''
      ) as any as InitialAirdrop;
    } catch (e) {
      throw new Error(`Error initializing initial airdrop contract ${e}`);
    }

    try {
      DistributionContract = new web3.eth.Contract(
        DistributionAbi.abi,
        DistributionAddress?.address || ''
      ) as any as Distribution;
    } catch (e) {
      throw new Error(`Error initializing distribution contract ${e}`);
    }
  });

  it(`Testing Initial Airdrop accounting`, async function(){
    console.log("Testing Initial Airdrop accounting");
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let NativeItem of parsedAirdrop){
      if (IsAddress(NativeItem.NativeAddress)){
        const initialAirdropBalance = await InitialAirdropContract.methods.airdropAmountsWei(NativeItem.NativeAddress).call()
        assert.equal(initialAirdropBalance,NativeItem.initialAirdropBalance.toString())
      }
      progress += 1;
      bar1.update(progress);
    }
    bar1.stop();
  });

  it(`Testing Distribution accounting`, async function(){
    console.log("Testing Distribution accounting");
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let NativeItem of parsedAirdrop){
      if (IsAddress(NativeItem.NativeAddress)){
        const {0: entitlementBalanceWei, 1: totalClaimedWei, 2:optOutBalanceWei, 3:airdroppedAtGenesisWei} = await DistributionContract.methods.airdropAccounts(NativeItem.NativeAddress).call()
        assert.equal(airdroppedAtGenesisWei,NativeItem.initialAirdropBalance.toString())
        assert.equal(entitlementBalanceWei,NativeItem.totalDistributionBalance.toString())
        assert.equal(optOutBalanceWei,"0")
        assert.equal(totalClaimedWei,"0")
      }
      progress += 1;
      bar1.update(progress);
    }
    bar1.stop();
  });

  it(`Testing airdrop signer balance is 0`, async function(){
    const signerBalance = await Web3.eth.getBalance(airdropSigner);
    assert.equal(signerBalance,"0");
  });

  it(`Testing airdrop signer transaction count matches airdrops`, async function(){
    const signerTransactionCount = await Web3.eth.getTransactionCount(airdropSigner);
    assert.equal(signerTransactionCount,parsedAirdrop.length*2 + 2);
  });
});