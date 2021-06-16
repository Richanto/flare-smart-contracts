# Deployment of Flare Networks smart contracts

This document describes local deployment procedures for *Flare Network* smart contracts.
Note: the contracts are still under development and the deployment procedure is not fully secure and is subject to significantly change.

## Structure of folders

- `chain-config` - deployment configuration JSON files containing relevant parameters. These are deploy inputs.
- `deploys` - addresses of the deployed contracts. Each deployed contract is labeled. These are deploy outputs.
- `scripts` - deployment related scripts.
- `test` - tests verifying whether a deployment is correct. Triggered after deployment.

## Local deployment 

For local deployment a *Flare Network* node(s) must be first run in order to deploy the contract to the network.

### Running the local Flare Network nodes

- Clone [Flare Network repository](https://gitlab.com/flarenetwork/flare). 
- Use the branch `37-add-pricesubmitter-contract-to-genesis-for-scdev-network` (SUBJECT TO CHANGE - if you can find this branch, otherwise use `master`)
- Set up the environment (node, npm, golang, etc.) according to instructions in [`README.md`](https://gitlab.com/flarenetwork/flare/-/blob/master/README.md).
- In terminal run either 1-node network by running the script `scdev1.sh` or 4-node network (`scdev.sh`).
- The API node of the network is present at `http://127.0.0.1:9660` and RPC route is `http://127.0.0.1:9660/ext/bc/C/rpc`.

Note: to test if the network/node is up, one can call RPC route from browser and it should return empty page, but response code should be 200 (see in Inspector). Alternatively, use `wget http://127.0.0.1:9660/ext/bc/C/rpc`. Another option is to explicitly check the health of a node by calling `curl -m 10 http://127.0.0.1:9660/ext/health`. 

### Test accounts and Metamask

Private keys loaded with balances for the `scdev` network are in file `test-1020-accounts.json`. 
One can test this with *Metamask*. Click on top button indicating the connected network (usually the selected network is `Ethereum Mainnet`). From a dropdown select the last entry `Custom RPC`. Set network name to `Flare SCdev`, as RPC URL use `http://127.0.0.1:9660/ext/bc/C/rpc`.
DO NOT enter *Currency Symbol* (which is optional anyway) as some versions of *Metamask* do not work well with *Flare Network* API when currency symbol is provided.
*Chain ID* for the `scdev` network is subject to change during the development, so just enter some number and press *Save*. An error will be prompted with the correct Chain ID printed out. Use that one and press *Save* again.

### Deploying smart contracts

- Use this repository.
- Make sure the `scdev` network is running and the node(s) are up.
- Work on branch `master`.
- Make sure *Yarn* package manager is installed. The recommended version is v1.22.10 or higher.
- Recommended `node` version is v14.15.4 or higher.
- Make sure node packages are installed. Call `yarn`.
- To carry out the deployment, important private keys and settings must be defined in `.env` file. Use `.env-template` as a template for a custom `.env` file. Note the in `.env-template` the genesis governance private key matching the `SCdev` network is already provided. The other two private keys should be provided by the deployer. When testing one can use private keys from `test-2020-accounts.json`.
- Check `deployment/chain-config/scdev.json` for possible change of deployment configuration parameters. Update the file if needed to tweak the deployment.
- Run a deploy onto the running *Flare network*: `yarn deploy_local_scdev`. During the deploy, deployed contracts' addresses will be printed out. The script also runs some simple tests after the deployment. If some tests fail, the deployment might be faulty, or the deployment script could be broken (note that it is still under development).

## Usage

Use *web3* or *ethers* libraries to connect to the network. To obtain ABIs (Application Binary Interfaces) for contracts, use `artifacts/contracts` folder, which is generated by Solidity compilation. Addresses for the deployed contracts are available in `deployment/deploys/scdev.json`. Each deployment contract has a label which is more or less selfexplanatory. As RPC URL use `http://127.0.0.1:9660/ext/bc/C/rpc`. 

Note that when sending transactions either by using *Web3*, *ethers* or relevant *web3* wrappers in *truffle*, obtaining the transaction receipt is not a confirmation that transaction was mined. In addition to obtaining the receipt, it must be verified that the sending account nonce had increased. One can use a wrapper like `waitFinalize3` that waits until nonce increases. In order to send transactions faster, nonce management and waiting for receipts must be done manually. Adding to that, a 1-node chain will usually run faster and with less issues, hence using `scdev1.sh` for tests is preferred.

Data providers can further check the proposed *Flare Price Provider* implementation at https://gitlab.com/flarenetwork/flare-price-provider/
