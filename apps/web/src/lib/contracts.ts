// Contract addresses from addresses.json
export const USDC_ADDRESS = "0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce";
export const SETTLEMENT_ADDRESS = "0xc73967F29E6dB5b7b61a616d030a9180e8617464";
export const MARKET_REGISTRY_ADDRESS = "0xE108166156626bD94e5686847F7a29E044D2b73c";
export const ORACLE_ADAPTER_ADDRESS = "0xad3F4094cfA60d2503057e26EbeAf241AC7434E8";
export const CTF_ADDRESS = "0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665";
export const CHAIN_ID = 1111111;

// Minimal ABIs for required functions
export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export const SETTLEMENT_ABI = [
  "function collateralBalances(address user, address collateral) view returns (uint256)",
  "function depositCollateral(address collateral, uint256 amount)",
  "function withdrawCollateral(address collateral, uint256 amount)",
];

export const CTF_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function redeemPositions(address collateral, bytes32 conditionId, uint256[] indexSets)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
];

export const MARKET_REGISTRY_ABI = [
  "function createMarket(address collateral, address oracle, uint256 startTime, uint8 kind, uint8 timeframe) returns (uint256)",
  "function getMarket(uint256 marketId) view returns (tuple(bytes32 conditionId, address collateral, address oracle, uint256 startTime, uint256 endTime, bool resolved, uint8 winningOutcome, uint8 kind, uint8 timeframe))",
  "function nextMarketId() view returns (uint256)",
];

// Build EIP-712 Domain for signing orders
export const getEip712Domain = () => ({
  name: "PredictXSettlementV2",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: SETTLEMENT_ADDRESS,
});

// EIP-712 Types for OrderV2
export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "conditionId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "collateral", type: "address" },
    { name: "pricePips", type: "uint128" },
    { name: "amount", type: "uint128" },
    { name: "makerFeeBps", type: "uint16" },
    { name: "takerFeeBps", type: "uint16" },
    { name: "expiry", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "mintOnFill", type: "bool" },
    { name: "allowedTaker", type: "address" },
  ],
};
