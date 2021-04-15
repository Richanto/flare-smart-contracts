// XRP: 1 drop = 0.000001 XRP
// LTC: 1 litoshi = 0.00000001 LTC
// XDG: 1 shibe = 0.00000001 XDG (smallest unit name is uncertain; 10^-8 seems correct )
// Mint max is roughly set to $10,000 per coin
// These parameters derived from: https://docs.google.com/document/d/1r2e2i9WkfHDZuesDWPoXGNFnOQEwxOBdyZUtLZk7tWA/edit#
export const serializedParameters = `{
  "flareKeeperAddress": "0x1000000000000000000000000000000000000002",
  "deployerPrivateKey": "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122",
  "governancePrivateKey": "0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb",
  "inflationFundWithdrawTimeLockSec": 10,
  "totalFlrSupply": 100000000000,
  "rewardEpochDurationSec": 172800,
  "revealEpochDurationSec": 30,
  "priceEpochDurationSec": 120,
  "votePowerBoundaryFraction": 0,
  "minVoteCount": 1,
  "minVotePowerFlrThreshold": 10000000000,
  "minVotePowerAssetThreshold": 10000000000,
  "maxVotePowerFlrThreshold": 10,
  "maxVotePowerAssetThreshold": 10,
  "lowAssetUSDThreshold": 200000000,
  "highAssetUSDThreshold": 3000000000,
  "highAssetTurnoutThreshold": 100,
  "XRP": {
    "fAssetName": "Flare Asset XRP",
    "fAssetSymbol": "FXRP",
    "fAssetDecimals": 6,
    "dummyFAssetMinterMax": 7000000000
  },
  "LTC": {
    "fAssetName": "Flare Asset Litecoin",
    "fAssetSymbol": "FLTC",
    "fAssetDecimals": 8,
    "dummyFAssetMinterMax": 4000000000
  },
  "XDG": {
    "fAssetName": "Flare Asset Dogecoin",
    "fAssetSymbol": "FXDG",
    "fAssetDecimals": 8,
    "dummyFAssetMinterMax": 13000000000000
  }
}`;
