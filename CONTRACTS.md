# Smart Contracts Documentation

This document describes the smart contract architecture, interfaces, and mechanics of the PredictX prediction market platform.

## Architecture Overview

The PredictX V2 platform consists of four main smart contracts:

```
┌─────────────────────────────────────────────────────────────┐
│                      Smart Contracts                          │
│  ┌──────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │ SettlementV2 │◀──▶│     CTF     │◀──▶│ MarketRegistry  │  │
│  │  (Trading)   │    │ (Positions) │    │   V2 (Markets)  │  │
│  └──────────────┘    └─────────────┘    └────────┬────────┘  │
│                                                    │           │
│                                          ┌─────────▼────────┐ │
│                                          │ PythOracle       │ │
│                                          │   Adapter        │ │
│                                          └──────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## ConditionalTokensV2 (CTF)

**Location**: `chain/contracts/ConditionalTokensV2.sol`

The ConditionalTokensV2 contract is an ERC1155-based implementation that manages outcome tokens for prediction markets. It is the core component that enables zero-sum conditional token mechanics.

### Core Functions

#### prepareCondition
```solidity
function prepareCondition(
    address oracle,
    bytes32 questionId,
    uint256 outcomeSlotCount
) external
```

Prepares a new condition (market outcome set) for trading.

**Parameters**:
- `oracle`: Address authorized to report the result (MarketRegistryV2)
- `questionId`: Unique identifier for the condition
- `outcomeSlotCount`: Number of possible outcomes (always 2 for UP/DOWN markets)

**Returns**: `conditionId` (bytes32) - Unique identifier for this condition

**Usage**: Called automatically by `MarketRegistryV2.createMarket()`

---

#### splitPosition
```solidity
function splitPosition(
    IERC20 collateralToken,
    bytes32 conditionId,
    uint256 amount
) external
```

Splits collateral into a complete set of outcome tokens.

**Parameters**:
- `collateralToken`: Collateral token address (USDC)
- `conditionId`: Condition to split into
- `amount`: Amount of collateral to split (6 decimals for USDC)

**Behavior**:
- Transfers `amount` of collateral from user to CTF contract
- Mints `amount` of each outcome token (DOWN and UP) to user
- User receives complete set that can be merged back at any time

**Example**:
```
Input: 100 USDC
Output: 100 DOWN tokens + 100 UP tokens
```

---

#### mergePositions
```solidity
function mergePositions(
    IERC20 collateralToken,
    bytes32 conditionId,
    uint256 amount
) external
```

Merges a complete set of outcome tokens back into collateral.

**Parameters**:
- `collateralToken`: Collateral token address (USDC)
- `conditionId`: Condition to merge from
- `amount`: Amount of complete set to merge

**Behavior**:
- Burns `amount` of each outcome token (DOWN and UP) from user
- Transfers `amount` of collateral back to user
- Must hold complete set (equal amounts of all outcomes)

**Example**:
```
Input: 100 DOWN tokens + 100 UP tokens
Output: 100 USDC
```

---

#### reportPayouts
```solidity
function reportPayouts(
    bytes32 questionId,
    uint256[] calldata payouts
) external
```

Reports the final result for a condition.

**Parameters**:
- `questionId`: Question to resolve
- `payouts`: Payout vector (e.g., `[0, 1]` for UP wins, `[1, 0]` for DOWN wins)

**Access**: Only callable by the oracle address (MarketRegistryV2)

**Behavior**:
- Permanently records the payout vector for this condition
- Enables users to redeem winning outcome tokens
- Cannot be called twice for the same questionId

---

#### redeemPositions
```solidity
function redeemPositions(
    IERC20 collateralToken,
    bytes32 conditionId,
    uint256[] calldata indexSets
) external
```

Redeems outcome tokens for collateral after condition is resolved.

**Parameters**:
- `collateralToken`: Collateral token address
- `conditionId`: Resolved condition
- `indexSets`: Array of index sets to redeem (e.g., `[1]` for DOWN, `[2]` for UP)

**Behavior**:
- Calculates payout based on reported results
- Burns outcome tokens
- Transfers proportional collateral to user

**Example** (UP wins with payout `[0, 1]`):
```
User holds: 100 UP tokens
Redemption: Burns 100 UP, receives 100 USDC

User holds: 100 DOWN tokens
Redemption: Burns 100 DOWN, receives 0 USDC
```

---

### Helper Functions

#### getConditionId
```solidity
function getConditionId(
    address oracle,
    bytes32 questionId,
    uint256 outcomeSlotCount
) public pure returns (bytes32)
```

Calculates the condition ID for given parameters.

**Returns**: `keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount))`

---

#### getCollectionId
```solidity
function getCollectionId(
    bytes32 conditionId,
    uint256 indexSet
) public pure returns (bytes32)
```

Calculates collection ID for an outcome.

**Parameters**:
- `conditionId`: Condition identifier
- `indexSet`: Outcome index set (1 for outcome 0, 2 for outcome 1, 3 for complete set)

---

#### getPositionId
```solidity
function getPositionId(
    IERC20 collateralToken,
    bytes32 collectionId
) public pure returns (uint256)
```

Calculates the ERC1155 token ID for a position.

**Returns**: `uint256(keccak256(abi.encodePacked(collateralToken, collectionId)))`

**Note**: This is the token ID used for `balanceOf()` and `safeTransferFrom()` calls.

---

## SettlementV2

**Location**: `chain/contracts/SettlementV2.sol`

The SettlementV2 contract handles order validation, signature verification, and trade execution.

### Core Functions

#### depositCollateral
```solidity
function depositCollateral(address token, uint256 amount) external
```

Deposits collateral into the Settlement contract for trading.

**Pre-requisite**: User must approve Settlement contract to spend USDC

**Example**:
```solidity
await usdc.approve(settlementAddress, amount);
await settlement.depositCollateral(usdcAddress, amount);
```

---

#### withdrawCollateral
```solidity
function withdrawCollateral(address token, uint256 amount) external
```

Withdraws deposited collateral from the Settlement contract.

**Requirements**:
- User has sufficient deposited balance
- Amount > 0

---

#### fill
```solidity
function fill(
    Types.OrderV2 calldata order,
    bytes calldata signature,
    uint256 fillAmount,
    address taker
) external
```

Executes a single order fill (used internally by batchFill).

**Parameters**:
- `order`: Order structure (see OrderV2 below)
- `signature`: EIP-712 signature from order maker
- `fillAmount`: Amount to fill (6 decimals for USDC)
- `taker`: Address of the taker

**Validations**:
- Signature verification (EIP-712)
- Order not expired
- Order not overfilled
- Sufficient balances
- Valid nonce

---

#### batchFill
```solidity
function batchFill(Types.FillV2[] calldata fills) external
```

Executes multiple order fills in a single transaction.

**Parameters**:
- `fills`: Array of fill structures

**Behavior**:
- Validates each order signature
- Checks balances and nonces
- If `mintOnFill = true`: Calls CTF.splitPosition() to mint outcome tokens
- Transfers outcome tokens between maker and taker
- Deducts fees
- Updates filled amounts
- Emits `OrderFilled` events

**Gas Optimization**: Batching reduces transaction overhead significantly

---

### OrderV2 Structure

```solidity
struct OrderV2 {
    address maker;              // Order creator
    string marketId;            // Market identifier
    bytes32 conditionId;        // CTF condition ID
    uint8 outcome;              // 0=DOWN, 1=UP
    address collateral;         // Collateral token (USDC)
    string pricePips;           // Price in BPS (0-10000, e.g., "5000" = 50%)
    string amount;              // Order size in collateral units (6 decimals)
    uint16 makerFeeBps;         // Maker fee in BPS (e.g., 30 = 0.3%)
    uint16 takerFeeBps;         // Taker fee in BPS
    uint256 expiry;             // Unix timestamp expiration
    string salt;                // Random salt for uniqueness
    uint256 nonce;              // Order nonce
    bool mintOnFill;            // Whether to mint tokens on fill
    address allowedTaker;       // Specific taker (0x0 = anyone)
    uint256 chainId;            // Chain ID (1111111 for Socrates)
    address verifyingContract;  // Settlement contract address
}
```

---

### EIP-712 Signing

Orders are signed using EIP-712 typed data:

**Domain**:
```typescript
{
  name: "PredictXSettlementV2",
  version: "1",
  chainId: 1111111,
  verifyingContract: settlementAddress
}
```

**Type Definition**:
```typescript
const ORDER_TYPES = {
  OrderV2: [
    { name: "maker", type: "address" },
    { name: "marketId", type: "string" },
    { name: "conditionId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "collateral", type: "address" },
    { name: "pricePips", type: "string" },
    { name: "amount", type: "string" },
    { name: "makerFeeBps", type: "uint16" },
    { name: "takerFeeBps", type: "uint16" },
    { name: "expiry", type: "uint256" },
    { name: "salt", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "mintOnFill", type: "bool" },
    { name: "allowedTaker", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
};
```

**Frontend Signing Example**:
```typescript
const signature = await signer.signTypedData(domain, ORDER_TYPES, order);
```

---

## MarketRegistryV2

**Location**: `chain/contracts/MarketRegistryV2.sol`

The MarketRegistryV2 contract manages market creation and resolution.

### Core Functions

#### createMarket
```solidity
function createMarket(
    address collateral,
    address oracle,
    uint256 startTime,
    Types.MarketKind kind,
    uint8 timeframe
) external onlyOwner returns (uint256 marketId, bytes32 conditionId)
```

Creates a new prediction market.

**Parameters**:
- `collateral`: Collateral token address (USDC)
- `oracle`: Oracle adapter address (PythOracleAdapter)
- `startTime`: Market start timestamp (must be minute-aligned: `timestamp % 60 == 0`)
- `kind`: Market type (`BTC_UPDOWN = 0`, `ETH_UPDOWN = 1`)
- `timeframe`: Duration in minutes (`1`, `3`, or `5`)

**Returns**:
- `marketId`: Numeric market identifier
- `conditionId`: CTF condition ID for this market

**Behavior**:
- Validates `startTime` is future and minute-aligned
- Calculates `endTime = startTime + timeframe * 60`
- Generates unique `questionId`
- Calls `CTF.prepareCondition()`
- Stores market metadata
- Emits `MarketCreated` event

**Example**:
```solidity
// Create a 5-minute BTC market starting at next minute
uint256 nextMinute = ((block.timestamp / 60) + 1) * 60;
(uint256 marketId, bytes32 conditionId) = registry.createMarket(
    usdcAddress,
    oracleAdapterAddress,
    nextMinute,
    Types.MarketKind.BTC_UPDOWN,
    5
);
```

---

#### resolveMarket
```solidity
function resolveMarket(uint256 marketId) external
```

Resolves a market using oracle price data.

**Requirements**:
- Market must be ended: `block.timestamp >= market.endTime`
- Resolve buffer elapsed: `block.timestamp >= market.endTime + resolveBuffer` (60s)
- Market not already resolved

**Behavior**:
1. Fetches start price from oracle at `market.startTime`
2. Fetches end price from oracle at `market.endTime`
3. Determines winning outcome: `endPrice > startPrice ? UP : DOWN`
4. Calls `CTF.reportPayouts()` with payout vector
5. Stores resolution data
6. Emits `MarketResolved` event

**Payout Logic**:
```solidity
if (endPrice > startPrice) {
    payouts = [0, 1];  // UP wins
} else {
    payouts = [1, 0];  // DOWN wins
}
```

---

#### getMarket
```solidity
function getMarket(uint256 marketId) external view returns (Types.Market memory)
```

Retrieves market information.

**Returns**: Market structure with:
- `id`: Market ID
- `collateral`: Collateral token address
- `oracle`: Oracle address
- `conditionId`: CTF condition ID
- `startTime`: Market start timestamp
- `endTime`: Market end timestamp
- `kind`: Market type
- `timeframe`: Duration in minutes
- `resolved`: Resolution status
- `winningOutcome`: Winning outcome (0=DOWN, 1=UP, only if resolved)
- `startPrice`: Price at start (only if resolved)
- `endPrice`: Price at end (only if resolved)

---

#### canResolve
```solidity
function canResolve(uint256 marketId) external view returns (bool)
```

Checks if a market can be resolved.

**Returns**: `true` if:
- Market exists
- Market not already resolved
- Current time >= endTime + resolveBuffer

---

### Market Structure

```solidity
struct Market {
    uint256 id;
    address collateral;
    address oracle;
    bytes32 conditionId;
    uint256 startTime;
    uint256 endTime;
    MarketKind kind;
    uint8 timeframe;
    bool resolved;
    uint8 winningOutcome;
    int256 startPrice;
    int256 endPrice;
}
```

---

## PythOracleAdapter

**Location**: `chain/contracts/oracle/PythOracleAdapter.sol`

The PythOracleAdapter provides minute-aligned historical price queries for BTC and ETH.

### Core Functions

#### getPriceAt
```solidity
function getPriceAt(uint64 minuteTs) external view returns (int256 price, bool valid)
```

Retrieves historical price at a specific minute-aligned timestamp.

**Parameters**:
- `minuteTs`: Unix timestamp (must be minute-aligned: `minuteTs % 60 == 0`)

**Returns**:
- `price`: Price with 8 decimals (e.g., `6500000000000` = $65,000)
- `valid`: Whether the price data is valid

**Requirements**:
- `minuteTs` must be minute-aligned
- Oracle must have price data for that timestamp

**Internal**: Calls Pyth's `getPriceAtZeroTimestamp(feedId, minuteTs)`

---

#### getLatestPrice
```solidity
function getLatestPrice() external view returns (int256 price, uint256 timestamp, bool valid)
```

Retrieves the most recent price from Pyth Oracle.

**Returns**:
- `price`: Current price
- `timestamp`: Price timestamp
- `valid`: Validity flag

---

### Pyth Oracle Integration

The PythOracleAdapter integrates with Pyth Network's price feeds:

**BTC Feed ID**: `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de`
**Pyth Contract**: `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd` (Socrates Testnet)

**Price Format**:
- Exponent: -8 (8 decimal places)
- Example: `6500000000000` represents $65,000.00

---

## Complete Trade Lifecycle

### 1. Market Creation

```solidity
// Owner creates market
registry.createMarket(
    usdcAddress,
    oracleAdapter,
    startTime,
    MarketKind.BTC_UPDOWN,
    5  // 5 minutes
);
// → Emits MarketCreated(marketId, conditionId)
// → CTF.prepareCondition() called
```

### 2. User Deposits Collateral

```solidity
// User approves and deposits USDC
usdc.approve(settlementAddress, 1000e6);
settlement.depositCollateral(usdcAddress, 1000e6);
```

### 3. Order Creation and Signing

```typescript
// Frontend: User creates and signs order
const order = {
    maker: userAddress,
    marketId: "1",
    conditionId: "0x...",
    outcome: 1,  // UP
    collateral: usdcAddress,
    pricePips: "5500",  // 55%
    amount: "100000000",  // 100 USDC
    makerFeeBps: 30,
    takerFeeBps: 30,
    expiry: Math.floor(Date.now() / 1000) + 86400,
    salt: randomSalt,
    nonce: userNonce,
    mintOnFill: true,
    allowedTaker: ZERO_ADDRESS,
    chainId: 1111111,
    verifyingContract: settlementAddress
};

const signature = await signer.signTypedData(domain, types, order);

// Submit to API
await fetch('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({ order, signature, side: 'buy' })
});
```

### 4. Off-chain Matching

```typescript
// Matcher finds crossing orders and generates fills
const fills = [{
    order: sellOrder,
    signature: sellSignature,
    fillAmount: "100000000",
    taker: buyOrder.maker
}];
```

### 5. On-chain Settlement

```solidity
// Relayer submits batch
settlement.batchFill(fills);

// For each fill with mintOnFill=true:
// 1. Verify signature
// 2. Check balances
// 3. CTF.splitPosition() - mints outcome tokens
// 4. Transfer outcome tokens to taker
// 5. Transfer opposite outcome to maker
// 6. Deduct fees
```

### 6. Market Resolution

```solidity
// After market expires (endTime + 60s buffer)
registry.resolveMarket(marketId);

// → Fetches start and end prices from oracle
// → Determines winning outcome
// → CTF.reportPayouts([0, 1]) if UP wins
// → Emits MarketResolved event
```

### 7. User Redemption

```solidity
// User redeems winning positions
uint256[] indexSets = [2];  // Index 2 = UP outcome
ctf.redeemPositions(usdcAddress, conditionId, indexSets);

// → Burns outcome tokens
// → Transfers proportional collateral to user
```

### 8. Withdraw Collateral

```solidity
// User withdraws collateral back to wallet
settlement.withdrawCollateral(usdcAddress, amount);
```

---

## Position ID Calculation

Position IDs are ERC1155 token IDs used to identify specific outcome tokens:

```solidity
// Step 1: Get condition ID
bytes32 conditionId = ctf.getConditionId(oracle, questionId, 2);

// Step 2: Get collection ID for outcome
// indexSet: 1 for outcome 0 (DOWN), 2 for outcome 1 (UP)
bytes32 collectionId = ctf.getCollectionId(conditionId, indexSet);

// Step 3: Get position ID
uint256 positionId = ctf.getPositionId(collateralToken, collectionId);

// Check balance
uint256 balance = ctf.balanceOf(userAddress, positionId);
```

**Alternate Calculation (using solidityPackedKeccak256)**:
```typescript
import { solidityPackedKeccak256 } from 'ethers';

const conditionId = solidityPackedKeccak256(
    ['address', 'bytes32', 'uint256'],
    [oracleAddress, questionId, 2]
);

const collectionId = solidityPackedKeccak256(
    ['bytes32', 'uint256'],
    [conditionId, indexSet]
);

const positionId = solidityPackedKeccak256(
    ['address', 'bytes32'],
    [collateralAddress, collectionId]
);
```

---

## Gas Optimization

### Batch Processing

SettlementV2 supports batch filling to reduce gas costs:

```solidity
// Instead of 10 separate fill() calls:
// Gas: ~150k * 10 = 1,500,000

// Use batchFill():
// Gas: ~850k for 10 fills
// Savings: ~43%
```

### CTF Benefits

ConditionalTokensV2 enables efficient market resolution:

**Without CTF** (iterate all users):
```
Gas: ~50k per user
1000 users = 50M gas (would fail)
```

**With CTF** (single reportPayouts):
```
Gas: ~50k total
Users redeem independently
Scales to millions of users
```

---

## Security Features

### 1. Signature Verification

- EIP-712 typed data signing prevents replay attacks
- Signature includes chainId and verifyingContract
- Nonce bitmap prevents double-spending

### 2. Collateral Safety

- Whitelisted collateral tokens only
- Settlement contract holds custody
- Balance checks before execution
- ReentrancyGuard protection

### 3. Market Safety

- Owner-only market creation
- Oracle verification with cooldown period
- Immutable market parameters after creation
- CTF ensures correct payouts

### 4. Access Control

- Ownable pattern for administrative functions
- Only oracle can reportPayouts
- Only Relayer submits fills (in production setup)

---

## Error Handling

### Common Errors

**InsufficientBalance()**
- User doesn't have enough collateral deposited
- Solution: Deposit more collateral

**InvalidSignature()**
- Order signature verification failed
- Solution: Re-sign order with correct parameters

**OrderExpired()**
- Order expiry timestamp passed
- Solution: Create new order with future expiry

**Overfill()**
- Trying to fill more than order amount
- Solution: Reduce fill amount

**UnsupportedCollateral()**
- Collateral token not whitelisted
- Solution: Use USDC

**InvalidOutcome()**
- Outcome must be 0 or 1
- Solution: Use valid outcome value

---

## Testing

### Contract Tests

Run full test suite:
```bash
cd chain
pnpm hardhat test
```

### Manual Testing Scripts

**Mint USDC**:
```bash
npx hardhat run scripts/mintUSDC.ts --network soc_test
```

**Create Markets**:
```bash
npx hardhat run scripts/createMarkets.ts --network soc_test
```

**Resolve Market**:
```bash
npx hardhat run scripts/resolveMarket.ts --network soc_test
```

**Check Balances**:
```bash
npx hardhat run scripts/checkBalance.ts --network soc_test
```

---

## Deployment

### Full Deployment

```bash
cd chain
pnpm hardhat deploy --network soc_test
```

Deploys in order:
1. MockUSDC
2. ConditionalTokensV2
3. SettlementV2
4. PythOracleAdapter
5. MarketRegistryV2

Generates `chain/addresses.json` with deployed addresses.

### Verification

Verify contracts on block explorer:
```bash
npx hardhat verify --network soc_test <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## References

- [CTF Specification](https://docs.gnosis.io/conditionaltokens/)
- [EIP-712: Typed Data Signing](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-1155: Multi Token Standard](https://eips.ethereum.org/EIPS/eip-1155)
- [Pyth Network Documentation](https://docs.pyth.network/)
- [Socrates Testnet Explorer](https://explorer-testnet.socrateschain.org/)

---

For backend integration and API usage, see **BACKEND.md**.
For frontend development, see **FRONTEND.md**.
