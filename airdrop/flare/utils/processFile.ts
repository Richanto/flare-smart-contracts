const Web3Utils = require("web3-utils");
const RippleAPI = require("ripple-lib").RippleAPI;
const Web3 = require("web3");
const cliProgress = require('cli-progress');
import BigNumber from "bignumber.js";
import {
  airdropGenesisRes,
  generateTransactionCallRes, LineItem,
  ProcessedAccount, validateRes
} from "./airdropTypes";
import { isBaseTenNumber, logMessage } from "./utils";

import InitialAirdropAbi from "../../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { InitialAirdrop } from "../../../typechain-web3/InitialAirdrop";

import DistributionAbi from "../../../artifacts/contracts/tokenPools/implementation/Distribution.sol/Distribution.json";
import { Distribution } from "../../../typechain-web3/Distribution";

const TEN = new BigNumber(10);
const MAX_FLARE_BALANCE = new BigNumber(1).multipliedBy(TEN.pow(27));
const indexOffset = 2;
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_FLOOR, DECIMAL_PLACES: 20 });

const RippleApi = new RippleAPI({
  server: "wss://s1.ripple.com", // Public rippled server hosted by Ripple, Inc.
});

export function validateFile(
  parsedFile: LineItem[],
  logFile: string,
  logConsole: boolean = true
): validateRes {
  let validAccountsLen: number = 0;
  let validAccounts: boolean[] = [];
  let invalidAccountsLen: number = 0;
  let lineErrors = 0;
  let seenXRPAddresses = new Set();
  let totalXRPBalance = new BigNumber(0);
  let invalidXRPBalance = new BigNumber(0);
  let totalFLRBalance = new BigNumber(0);
  let invalidFLRBalance = new BigNumber(0);
  let seenXRPAddressesDetail: { [name: string]: number } = {};
  for (let lineIndex = 0; lineIndex < parsedFile.length; lineIndex++) {
    let lineItem = parsedFile[lineIndex];
    let isValid = true;
    let isValidXRP = true;
    let isValidFLR = true;
    let readableIndex = lineIndex + indexOffset;
    if (!RippleApi.isValidAddress(lineItem.XRPAddress)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: XRP address is invalid ${lineItem.XRPAddress}`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
    }
    if (seenXRPAddresses.has(lineItem.XRPAddress)) {
      // We have already seen this XRP address
      logMessage(
        logFile,
        `Line ${readableIndex}: XRP address is duplicate of line ${
          seenXRPAddressesDetail[lineItem.XRPAddress]
        }`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
    }
    if (!seenXRPAddresses.has(lineItem.XRPAddress)) {
      seenXRPAddresses.add(lineItem.XRPAddress);
      seenXRPAddressesDetail[lineItem.XRPAddress] = lineIndex;
    }
    if (!Web3Utils.isAddress(lineItem.FlareAddress)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: Flare address is invalid ${lineItem.FlareAddress}`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
    }
    if (!isBaseTenNumber(lineItem.XRPBalance)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: XRP Balance is not a valid number`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
      isValidXRP = false;
    }
    if (!isBaseTenNumber(lineItem.FlareBalance)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: FLR Balance is not a valid number`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
      isValidFLR = false;
    }
    validAccounts[lineIndex] = isValid;
    if (isValid) {
      validAccountsLen += 1;
      totalXRPBalance = totalXRPBalance.plus(lineItem.XRPBalance);
      totalFLRBalance = totalFLRBalance.plus(lineItem.FlareBalance);
    } else {
      invalidAccountsLen += 1;
      if (isValidXRP) {
        invalidXRPBalance = invalidXRPBalance.plus(lineItem.XRPBalance);
      }
      if (isValidFLR) {
        invalidFLRBalance = invalidFLRBalance.plus(lineItem.FlareBalance);
      }
    }
  }
  return {
    validAccounts,
    validAccountsLen,
    invalidAccountsLen,
    totalXRPBalance,
    invalidXRPBalance,
    totalFLRBalance,
    invalidFLRBalance,
    lineErrors,
  };
}

export function createFlareAirdropGenesisData(
  parsedFile: LineItem[],
  validAccounts: validateRes,
  contingentPercentage: BigNumber,
  conversionFactor: BigNumber,
  logFile: string,
  logConsole: boolean = true
): airdropGenesisRes {
  let processedAccountsLen: number = 0;
  let processedAccounts: ProcessedAccount[] = [];
  let processedWei = new BigNumber(0);
  let seenFlareAddresses = new Set<string>();
  let flrAddDetail: { [name: string]: { balance: BigNumber; num: number } } =
    {};
  for (let lineIndex = 0; lineIndex < parsedFile.length; lineIndex++) {
    let readableIndex = lineIndex + indexOffset;
    if (validAccounts.validAccounts[lineIndex]) {
      let lineItem = parsedFile[lineIndex];
      processedAccountsLen += 1;
      let accBalance = new BigNumber(lineItem.XRPBalance);
      accBalance = accBalance.multipliedBy(conversionFactor);
      let expectedBalance = new BigNumber(lineItem.FlareBalance);
      // To get from XRP to 6 decimal places to Wei (Flare to 18 decimal places)
      accBalance = accBalance.multipliedBy(TEN.pow(12));
      // Special case for RippleWorks
      if (lineItem.XRPAddress == "rKveEyR1SrkWbJX214xcfH43ZsoGMb3PEv") {
        // RippleWorks address is capped to 1BN
        accBalance = BigNumber.minimum(accBalance, MAX_FLARE_BALANCE);
        logMessage(
          logFile,
          `Line ${readableIndex}: Flare balance capped to: ${accBalance.toString(
            10
          )}`,
          !logConsole
        );
      }
      // Check that balances are calculated properly
      if (!accBalance.isEqualTo(expectedBalance)) {
        logMessage(
          logFile,
          `Line ${readableIndex}: Flare balance error: ${accBalance.toString(
            10
          )}`,
          !logConsole
        );
      }
      // Calculate account balance
      accBalance = accBalance.multipliedBy(contingentPercentage);

      // accBalance = accBalance.multipliedBy(initialAirdropPercentage);

      // rounding down to 0 decimal places
      accBalance = accBalance.dp(0, BigNumber.ROUND_FLOOR);
      // Total Wei book keeping
      processedWei = processedWei.plus(accBalance);
      if (seenFlareAddresses.has(lineItem.FlareAddress)) {
        flrAddDetail[lineItem.FlareAddress].balance =
          flrAddDetail[lineItem.FlareAddress].balance.plus(accBalance);
        flrAddDetail[lineItem.FlareAddress].num += 1;
      } else {
        seenFlareAddresses.add(lineItem.FlareAddress);
        flrAddDetail[lineItem.FlareAddress] = { balance: accBalance, num: 1 };
      }
    }
  }
  let accountsDistribution: number[] = [];
  for (let flrAdd of seenFlareAddresses) {
    if (flrAddDetail[flrAdd].balance.gt(MAX_FLARE_BALANCE)) {
      logMessage(
        logFile,
        `Address ${flrAdd}: Flare balance bigger than 1BN`,
        !logConsole
      );
    }
    processedAccounts.push({
      NativeAddress: flrAdd,
      NativeBalance: flrAddDetail[flrAdd].balance.toString(16),
    });
    if (accountsDistribution[flrAddDetail[flrAdd].num]) {
      accountsDistribution[flrAddDetail[flrAdd].num] += 1;
    } else {
      accountsDistribution[flrAddDetail[flrAdd].num] = 1;
    }
  }
  return {
    processedAccounts,
    processedAccountsLen,
    processedWei,
    accountsDistribution,
  };
}

// transaction object https://web3js.readthedocs.io/en/v1.2.9/web3-eth.html#eth-sendtransaction
// export function createAirdropUnsignedTransactions(
//   processedAccounts: ProcessedAccount[],
//   senderAddress: string,
//   gasPrice: string,
//   gas: string,
//   chainId: number,
//   initialNonceOffset: number = 0
// ): generateTransactionRes {
//   let transactions = [];
//   let nonce = initialNonceOffset;
//   for (let acc of processedAccounts) {
//     const newTransaction: unsignedTransaction = {
//       from: senderAddress,
//       to: acc.NativeAddress,
//       gas: gas,
//       gasPrice: gasPrice,
//       value: "0x" + acc.NativeBalance,
//       nonce: nonce,
//       chainId: chainId,
//     };
//     transactions.push(newTransaction);
//     nonce += 1;
//   }
//   let totalGasPriceNum = new BigNumber(1);
//   totalGasPriceNum = totalGasPriceNum
//     .multipliedBy(gas)
//     .multipliedBy(gasPrice)
//     .multipliedBy(transactions.length);
//   const totalGasPrice = totalGasPriceNum.toString(10);
//   return {
//     transactions,
//     totalGasPrice,
//   };
// }

export function createSetAirdropBalanceUnsignedTransactions(
  processedAccounts: ProcessedAccount[],
  initialAirdropContractAddress: string,
  distributionContractAddress: string,
  initialAirdropStartTs: string,
  distributionStartTs: string,
  senderAddress: string,
  gasPrice: string,
  gas: string,
  chainId: number,
  initialNonceOffset: number = 0,
  batchSize: number = 900
): generateTransactionCallRes {
  const rawTransactions = [];
  const web3 = new Web3();

  const InitialAirdropContract = new web3.eth.Contract(
    InitialAirdropAbi.abi,
    initialAirdropContractAddress
  ) as any as InitialAirdrop;

  const distributionContract = new web3.eth.Contract(
    DistributionAbi.abi,
    distributionContractAddress
  ) as any as Distribution;

  let index = 0;
  let nonce = initialNonceOffset;
  let shouldBreak = false;

  const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  let progress = 0

  console.log('Creating unsigned transactions for InitialAirdrop and Distribution');
  bar1.start(Math.ceil(processedAccounts.length / batchSize) + 2, 0);
  while (true) {
    const tempAddresses: string[] = [];
    const tempBalances = [];

    for (let i = 0; i < batchSize; i++) {
      if (!(index < processedAccounts.length)) {
        shouldBreak = true;
        break;
      }
      tempAddresses.push(processedAccounts[index].NativeAddress);
      tempBalances.push(web3.utils.toBN(processedAccounts[index].NativeBalance));
      index += 1;
    }

    if (
      tempAddresses.length > 0 &&
      tempAddresses.length === tempBalances.length
    ) {
      const encodedCallInitialAirdrop = InitialAirdropContract.methods
        .setAirdropBalances(tempAddresses, tempBalances)
        .encodeABI();
      const newTransaction = {
        from: senderAddress,
        to: initialAirdropContractAddress,
        data: encodedCallInitialAirdrop,
        gas: gas,
        gasPrice: gasPrice,
        nonce: nonce,
        chainId: chainId,
      };
      rawTransactions.push(newTransaction);
      nonce += 1;

      const encodedCallDistribution = distributionContract.methods
        .setAirdropBalances(tempAddresses, tempBalances)
        .encodeABI();
      const newTransactionDistribution = {
        from: senderAddress,
        to: initialAirdropContractAddress,
        data: encodedCallDistribution,
        gas: gas,
        gasPrice: gasPrice,
        nonce: nonce,
        chainId: chainId,
      };
      rawTransactions.push(newTransactionDistribution);
      nonce += 1;

      progress += 1
      bar1.update(progress)
    }

    if (shouldBreak) {
      break;
    }
  }
 
  // create transaction to disable adding data to initial airdrop
  const disableInitialAirdrop = InitialAirdropContract.methods.setAirdropStart(initialAirdropStartTs).encodeABI();
  const disableAirdropTx = {
    from: senderAddress,
    to: initialAirdropContractAddress,
    data: disableInitialAirdrop,
    gas: gas,
    gasPrice: gasPrice,
    nonce: nonce,
    chainId: chainId,
  };
  rawTransactions.push(disableAirdropTx);
  nonce += 1;

  progress += 1
  bar1.update(progress)

  const disableDistribution = distributionContract.methods.setEntitlementStart(distributionStartTs).encodeABI();
  const disableDistributionTx = {
    from: senderAddress,
    to: initialAirdropContractAddress,
    data: disableDistribution,
    gas: gas,
    gasPrice: gasPrice,
    nonce: nonce,
    chainId: chainId,
  };
  rawTransactions.push(disableDistributionTx);
  progress += 1
  bar1.update(progress)
  bar1.stop();

  let totalGasPrice = new BigNumber(1);
  totalGasPrice = totalGasPrice
    .multipliedBy(gas)
    .multipliedBy(gasPrice)
    .multipliedBy(rawTransactions.length);
  const GasPrice = totalGasPrice.toString(10);

  return {
    rawTransactions: rawTransactions,
    totalGasPrice: GasPrice,
  };
}
