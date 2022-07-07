import * as fs from 'fs';
import { signedTransaction } from './utils/airdropTypes';
import { logMessage } from './utils/utils';
import BigNumber from "bignumber.js";
const Web3 = require('web3');
const web3Eth = require("web3-eth");
const cliProgress = require('cli-progress');

let { argv } = require("yargs")
.scriptName("signAirdropTransactions")
.option("f", {
    alias: "transactions-file",
    describe: "Path to transactions file",
    demandOption: "Transactions file is required",
    type: "string",
    nargs: 1,
})
.option("o", {
    alias: "output-file",
    describe: "Path to output raw transactions file",
    demandOption: "Output file is required",
    type: "string",
    nargs: 1,
})
.option("l", {
    alias: "log-path",
    describe: "log data path",
    type: "string",
    default: "airdrop/flare/files/logs/",
    nargs: 1
})
.option("q", {
    alias: "quiet",
    describe: "quiet",
    type: "boolean",
    default: "false",
    nargs: 1
})
.fail(function (msg:any, err:any, yargs:any) {
    if (err) throw err;
    console.error("Exiting with message")
    console.error(msg);
    console.error(yargs.help())
    process.exit(0);
})

async function main(transactionsFile:string, outputFile:string, logPath:string,  quiet:boolean = true) {
    let initialAirdropSigner: string
    let distributionSigner: string
    let signedTransactions:signedTransaction[] = []

    if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
        initialAirdropSigner = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
    }
    else {
        console.error("No GENESIS_GOVERNANCE_PRIVATE_KEY provided in env");
        throw new Error("No GENESIS_GOVERNANCE_PRIVATE_KEY provided in env");
    }

    if (process.env.DEPLOYER_PRIVATE_KEY) {
        distributionSigner = process.env.DEPLOYER_PRIVATE_KEY
    }
    else {
        console.error("No DEPLOYER_PRIVATE_KEY provided in env");
        throw new Error("No DEPLOYER_PRIVATE_KEY provided in env");
    }

    const now = new Date()
    const logFileName = logPath+`${now.toISOString()}_signAirdropTransactions_log.txt`;
    if(!quiet) console.log(logFileName);
    logMessage(logFileName, `Log file created at ${now.toISOString()} GMT(+0)`, quiet);
    logMessage(logFileName, `Script run with `, quiet);
    logMessage(logFileName, `--transactions-file        (-f)                      : ${transactionsFile}`, quiet);
    logMessage(logFileName, `--output-file              (-t)                      : ${outputFile}`, quiet);
    logMessage(logFileName, `--log-path                 (-l)                      : ${logPath}`, quiet);

    const web3 = new Web3();

    const unsignedTransactions = JSON.parse(fs.readFileSync(transactionsFile, "utf8"));
    const initialAirdropSignerWallet = web3.eth.accounts.privateKeyToAccount(initialAirdropSigner);
    const distributionSignerWallet = web3.eth.accounts.privateKeyToAccount(distributionSigner);
    logMessage(logFileName, `signer public key (from GENESIS_GOVERNANCE_PRIVATE_KEY in .env) : ${initialAirdropSignerWallet.address}`, quiet);
    logMessage(logFileName, `signer public key (from DEPLOYER_PRIVATE_KEY in .env)           : ${distributionSignerWallet.address}`, quiet);
    // let totalBalance = new BigNumber(0);
    let totalGasInitialAirdrop = new BigNumber(0);
    let totalGasDistribution = new BigNumber(0);
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    if(!quiet){
        console.log("Signing Transactions")
        bar1.start(unsignedTransactions.length, 0);
    }
    let progress = 0;
    for(let tx of unsignedTransactions){
        let signedTx: any
        let tempGas = new BigNumber(tx.gas);
        if(tx.from.toLocaleLowerCase() === initialAirdropSignerWallet.address.toLocaleLowerCase()){  // intial airdrop trasnaction
            signedTx = await initialAirdropSignerWallet.signTransaction(tx);
            totalGasInitialAirdrop = totalGasInitialAirdrop.plus(tempGas.multipliedBy(tx.gasPrice));
        } else if(tx.from.toLocaleLowerCase() === distributionSignerWallet.address.toLocaleLowerCase()){
            signedTx = await distributionSignerWallet.signTransaction(tx);
            totalGasDistribution = totalGasDistribution.plus(tempGas.multipliedBy(tx.gasPrice));
        } else {
            console.error(`From address is neither of signers ${tx.from}`);
            throw new Error(`From address is neither of signers ${tx.from}`);
        }
        // totalBalance = totalBalance.plus(tx.value);
        
        
        const newRawTx:signedTransaction = {
            raw: signedTx.rawTransaction
        }
        signedTransactions.push(newRawTx)
        progress += 1;
        if(!quiet) bar1.update(progress);
    }
    if(!quiet) bar1.stop();
    // logMessage(logFileName, `Total balance in signed transactions                 : ${totalBalance.toFixed()}`, quiet);
    logMessage(logFileName, `Total gas price in signed transactions for Initial Airdrop  : ${totalGasInitialAirdrop.toString(10)}`, quiet);
    logMessage(logFileName, `Total gas price in signed transactions for Distribution     : ${totalGasDistribution.toString(10)}`, quiet);

    fs.writeFileSync(outputFile, JSON.stringify(signedTransactions));
    logMessage(logFileName, `Complete`, quiet);
}
  
const { transactionsFile, quiet, outputFile, logPath } = argv;
main(transactionsFile, outputFile, logPath, quiet )
.then(() => process.exit(0))
.catch(error => {
    console.error(error);
    process.exit(1);
});
  