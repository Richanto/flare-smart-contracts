
# FTSO price provider
#### Providing prices to the Flare time series oracle for fun and for profit


## TL;DR
On chain FTSO prices will be updated every few minutes. Any user (address) can provide prices (data) by reading prices from any chosen source and submitting them to a dedicated API on the ftso contract. Any FLR holder can participate by delegating their vote power (1:1 based on flare balance) to another address (price provider) that submits prices. Good price feeds will be rewarded with part of the FLR inflation, in the form of FLR tokens on the Flare network. An address must have some minimum vote power in order to submit prices.

# FTSO overview
The FTSO or ‘Flare Time Series Oracle’ is a service to gather price (and data) signals of off-chain assets for consumption by other smart contracts on the Flare blockchain. The system is designed to encourage FLR holders to submit accurate prices to the FTSO contracts. Prices will be submitted in price epochs of a few minutes. For every price epoch, a weighted median algorithm will aggregate all price submissions to find the median price, which will become the current FTSO price. Good price submissions will be rewarded with newly minted FLR tokens (FLR inflation).

Price submissions are considered good if they are within the interquartile range (within 25% of either side) of the submissions around the weighted median price. The rewards will be distributed between good submissions according to the relative weight (balance / vote power) of each address. 

An FTSO contract will be deployed for any new data signal supported by the Flare network, as determined by governance. The Flare Foundation currently plans to deploy contracts that will provide USD prices of FLR, XRP, LTC, XLM, DOGE, ADA, Algo, BCH, Digi and more to come.

More detail about the FTSO can be found here: [https://blog.flare.xyz/ftso-a-breakdown/](https://blog.flare.xyz/ftso-a-breakdown/)

## Introducing WFLR - a vote power token
The WFLR token represents wrapped FLR. Any user can wrap their FLR by sending FLR to the WFLR contract via the deposit API. WFLR can then be converted back to FLR by calling a withdrawal transaction on the WFLR contract. FLR and WFLR will always have a 1:1 ratio.

WFLR must be used in the price submission process. It is an ERC20 token that also supports vote power delegation from one address to another. Meaning, any WFLR holder can delegate their vote power to any other addresses. FLR depositors always maintain custody of their WFLR. **When delegating vote power, WFLR holders retain full custody over their WFLR.**

Note that although WFLR and FLR always have the same value, they differ in usage. Only FLR can be used to pay for flare network transactions (gas), while only WFLR can be used to represent and delegate vote power in price submissions.

### Who can submit prices

Any account (Flare address) submitting prices will require a minimum amount of WFLR voting power, and vote power must be some minimal percentage of the total WFLR supply. WFLR vote power reflects any given account’s balance, plus the vote power delegated by any other account. Use _getpriceepochdata()_ (below), to query minimal required vote power.

Price providers must have WFLR voting power and/or FAsset (flare XRP, flare LTC, etc.) voting power. However, only WFLR holders will receive FLR rewards for good price submissions.

### How does this work?
A WFLR holder can delegate vote power by percentage to a limited number of addresses, currently 3. The actual delegated vote power will be updated upon each token transfer. 

#### Example:
Alice has 10 FLR, she has no vote power delegated to her.
Alice wraps her 10 FLR by calling WFLR.deposit(), thus she now has vote power of 10.
Bob has 30 WFLR so he has vote power of 30.
Bob decides to delegate 50% of his vote power to Alice. Now Alice has vote power of 25 and Bob has vote power of 15. 
Bob receives 20 more WFLRtokens, so now Alice has vote power of 35 and Bob has vote power of 25.

Notice how when a delegator receives additional WFLR, the contract automatically updates vote power for all relevant delegatees according to their delegation percentage. It is important to note that although Bob has delegated 50% of his vote power to Alice, he still retains his 30 WFLR.

Note that for the Beta run of FTSOs, any address holding WFLR can submit prices. However, there will be minimum thresholds of vote power required to submit prices at mainnet launch.

## How to submit prices
Price epochs follow the commit and reveal scheme. The commit period is the price epoch period (few minutes long) immediately followed by x minutes of the reveal period. More on this scheme can be found [here](https://en.wikipedia.org/wiki/Commitment_scheme). This scheme is designed to stop individuals from submitting prices based on others’ price proposals. Within the commit period, all submissions are secret. After the commit period passes, individuals will no longer be able to change their submissions. During the reveal period, individuals must mandatorily reveal their prices to be considered by the FTSO. At this point, changes can not be made, and prices become public record.  

Together with price data, any price provider must add a random number to their price submissions. This helps seed the source of randomness on the Flare chain for FTSO operations that require randomization.

# Coding
Following files expose all relevant functions and events:
- [FTSO interface](../../contracts/userInterface/IFtso.sol)
- [Price submitter interface](../../contracts/userInterface/IPriceSubmitter.sol)

see more details below.

#### Submit price hash
```
   function submitPriceHash(bytes32 _hash) external;
```
The _hash should be keccak256(price, random)

#### Reveal price
```
   function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external;
```
Epoch ID should match the epoch in which the hash was submitted. For keeping track of epoch IDs, see the next section.

Price and random should be the same ones that were used to create the hash in the relevant price epoch period. If they don’t match, the transaction will be reverted and the committed price will not be included in the price determination algorithm.

As soon as the reveal period ends, the weighted median algorithm will process all revealed prices, and publish the median as the current price of the asset.

## Price submitter contract
A Price submitter contract will enable each provider to send the above Txs batched together. One Tx can be used to suנmitPrice to all FTSO contracts and later to revealPrice in all FTSO contracts. Contract interface is [here](../../contracts/userInterfaces/IPriceSubmitter.sol)

```
   function submitPriceHashes(
       IIFtso[] memory _ftsos,
       bytes32[] memory _hashes
   ) external;

   function revealPrices(
       uint256 _epochId,
       IIFtso[] memory _ftsos,
       uint256[] memory _prices,
       uint256[] memory _randoms
   ) external;
```

With batched transactions the price provider sends a list of FTSO addresses and the relevant data according to the operation type (submit or reveal). One can use this contract to interact with all FTSOs or a partial list.

## Price submission timing
The price provider should maintain accurate time synchronization with the on-chain timestamp value. Note, both high and low on-chain activity as well as high API node activity will affect the accuracy of the queried timestamp. It is advisable to run a flare node (more instructions to be made public) that is dedicated to price provider activity and event polling. When using a public API node to interact with the Flare network, one should expect lower accuracy, leading to possibly fewer accepted prices.

The time frame for an epoch can be taken from:

```
   function getPriceEpochData() external view returns (
       uint256 _epochId,
       uint256 _epochSubmitEndTime,
       uint256 _epochRevealEndTime,
       uint256 _votePowerBlock,
       uint256 _minVotePowerFlr,
       uint256 _minVotePowerAsset,
       bool _fallbackMode
   );

```
*   All time values are using timestamp from the unix epoch.
*   When in fallback mode, the FTSO takes price values from a trusted list of addresses (chain link style) and doesn't allocate any rewards.  

### Price submission vote power
Each price epoch has a specific vote power block which is used as a snapshot to find vote power of each address. The above function - getPriceEpochData() - can be used to determine the vote power block of each price epoch. Each provider should check their own vote power at the block and make sure they have enough vote power to submit prices. The same vote power block will be used in a series of price epochs. More on this will be described in a separate blog post. WFLR vote power can be determined using API WFLR.votePowerOfAt(address, block). Later when the fAsset system goes live, the same API will be used for the fAsset tokens to query the vote power of an address. 

## Events

#### Price submission event
```
   event PriceHashSubmitted(
       address indexed submitter, uint256 indexed epochId, bytes32 hash, uint256 timestamp
   );
```
A submitter can listen for this event to know which epoch ID the price was submitted for.

#### Price reveal event
```
   event PriceRevealed(
       address indexed voter, uint256 indexed epochId, uint256 price, uint256 random, uint256 timestamp,
       uint256 votePowerFlr, uint256 votePowerAsset
   );
```
The event will be emitted only if the price reveal was accepted, meaning the submitting address holds enough vote power (in either WFLR or FAsset) and that the hash of the submitted data matches the committed hash for the given price epoch.


#### Events price Epoch init + finalize
```
   event PriceFinalized(
       uint256 indexed epochId, uint256 price, bool rewardedFtso,
       uint256 lowRewardPrice, uint256 highRewardPrice, PriceFinalizationType finalizationType,
       uint256 timestamp
   );

   event PriceEpochInitializedOnFtso(
       uint256 indexed epochId, uint256 endTime, uint256 timestamp
   );
```

### General recommendations for system design
Congested API nodes can cause delays in events, revert messages, or lead to any other web3 exception. The same holds for any data query. Therefore, it is not advisable to rely on the timing of events: PriceSubmitted, PriceRevealed etc. 

Due to the above, it is advised that price providers:
*   Maintain internal timing mechanisms for sending TXs at correct times
*   Maintain internal nonce count. 
*   Do not send PriceReveal and PriceSubmit calls near the end of the allowed time frame. Congested networks can cause price reveals to confirm after the reveal period ends **even if the transaction was initiated within the reveal period**.

### Price provider pseudocode
```
const BobAddress;
const providerAddress; // price provider address
// below values should be obtained from deployment json file
const wFlr;
const xrpFtso;
const priceEpochDurationSec;
// FTSO address list should be loaded from a json that will be published
const FTSOAddressList {XRP_FTSO_Address, LTC_FTSO_Address, DOGE_FTSO_Address};
// preliminary steps of wrapping flare and delegating vote power.
// these steps will usually be done in a different scope
/////////////////////////////////////////////////////////////////
// Bob wrapps 100 FLR
wFlr.deposit(){from: BobAddress, amount: 100};
// Bob delegates 100% of his vote power to a price provider
wFlr.delegate(providerAddress, percentToBips(100)){from: BobAddress};
// price provider steps
///////////////////////
main() {
   while (true) {

       let providerVotePower;
       let validFtsoAddressList[];
       let ftsoPriceHashes[];
       let ftsoPrices[];
       let ftsoRandoms[];

       for (uint i = 0; i < FTSOAddressList.length; i++) {

           address ftso = FTSOAddressList[i];

           {
               epochId;
               epochSubmitEndTime;
               epochRevealEndTime;
               votePowerBlock;
               lowFlrVotePowerThreshold;
               isFallBackMode;
           } = ftso.getPriceEpochData();


    // note price epochs have fixed time frames
           // note vote power block for each price epoch is shared between all FTSOs
           if(providerVotePower == 0) providerVotePower =              wFlr.votePowerOfAt(providerAddress, votePowerBlock))

           if (isFallBackMode || providerVotePower < lowFlrVotePowerThreshold) {
               // not enough VP to post to this FTSO. go to next
               continue;
           }

           validFtsoAddressList.push(FTSOAddressList[i]);

           // create a new random
           ftsoRandoms.push(rand());

           // read token symbol
           let symbol = symbolftso.symbol();

           // read price from any chosen price source provider wishes to use
           ftsoPrices.push(priceSource.getPrice(symbol));

           uint currentFtso = ftsoPrices.length - 1;
           // create hash of above values and submit
           ftsoPriceHashes[currentFtso] = solidityKeccak256(
               ["uint256", "uint256"],
               [ftsoPrices[currentFtso], ftsoRandoms[currentFtso]]
           );
       }

       // submit hashes in batch
       if (validFtsoAddressList > 0) {
           priceSubmitter.submitPriceHashes(validFtsoAddressList, ftsoRandoms);
       }

       // wait for this commit period to end
       waitUntil(epochSubmitEndTime);

       // send reveal batch
       if (validFtsoAddressList > 0) {
           priceSubmitter.revealPrices(
               validFtsoAddressList,
               ftsoPrices,
               ftsoRandoms
           );
       }
   }

   function percentToBips(percent) {
       return percent * 100;
   }
   function waitUntil(linuxTs) {
      while(now() < linuxTs) {
          // sleep 1 second
           sleep(1);
       }
   }