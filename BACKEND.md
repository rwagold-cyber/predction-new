# Backend Services Documentation

This document describes the backend architecture, services, API reference, and deployment for the PredictX prediction market platform.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Backend Services                        │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │  API Server  │────────▶│      Matching Engine         │  │
│  │  (Express)   │         │    (In-Memory Orderbook)     │  │
│  └──────┬───────┘         └──────────────┬───────────────┘  │
│         │                                 │                  │
│         │                    Fills        │                  │
│         ▼                                 ▼                  │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │   Market     │         │         Relayer              │  │
│  │   Manager    │         │   (Batch Submission)         │  │
│  └──────────────┘         └──────────────┬───────────────┘  │
└────────────────────────────────────────────┼──────────────────┘
                                             │
                                             │ batchFill()
                                             ▼
                                     Smart Contracts
```

The backend consists of four main services:

1. **API Server**: REST API for order submission and queries
2. **Matching Engine**: Off-chain orderbook and matching logic
3. **Relayer**: Batch submission of matched orders to blockchain
4. **Market Manager**: Auto-discovery and resolution of markets

---

## Service Locations

```
services/
├── api/              # REST API server
│   └── src/
│       └── server.ts
├── matcher/          # Matching engine
│   └── src/
│       ├── matcher.ts
│       ├── orderbook.ts
│       ├── signature.ts
│       └── types.ts
├── relayer/          # On-chain submission
│   └── src/
│       └── relayer.ts
├── manager/          # Market discovery & resolution
│   └── src/
│       └── manager.ts
└── runner.ts         # Unified service launcher
```

---

## Configuration

### Environment Variables

**File**: `services/.env`

```bash
# Blockchain Connection
RPC_URL=https://rpc-testnet.socrateschain.org
CHAIN_ID=1111111

# Private Keys
RELAYER_PRIVATE_KEY=0x...         # Required: Submit fill transactions
MARKET_MANAGER_PRIVATE_KEY=0x...  # Recommended: Resolve markets

# Contract Addresses
USDC_ADDRESS=0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce
CTF_ADDRESS=0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665
SETTLEMENT_ADDRESS=0xc73967F29E6dB5b7b61a616d030a9180e8617464
MARKET_REGISTRY_ADDRESS=0xE108166156626bD94e5686847F7a29E044D2b73c
ORACLE_ADAPTER_ADDRESS=0xad3F4094cfA60d2503057e26EbeAf241AC7434E8

# Relayer Configuration
BATCH_SIZE=10             # Max fills per batch
BATCH_DELAY_MS=2000       # Max wait time (ms)
MAX_GAS_PRICE=100         # Max gas price (gwei)
MAX_RETRIES=3             # Retry attempts

# API Configuration
API_PORT=8080             # API server port
CORS_ORIGIN=*             # CORS allowed origin
```

### Account Requirements

- **Relayer Account**: ≥ 0.1 ETH (for gas fees)
- **Market Manager Account**: ≥ 0.05 ETH (for gas fees)

---

## API Server

**Location**: `services/api/src/server.ts`

Express-based REST API that provides order submission, market queries, and system stats.

### Startup

```bash
cd services
pnpm install
pnpm start
```

The API server will start on `http://localhost:8080` (configurable via `API_PORT`).

---

## REST API Reference

### Base URL

```
http://localhost:8080
```

---

### Health Check

**Endpoint**: `GET /health`

**Description**: Check service health status

**Response**:
```json
{
  "status": "ok",
  "service": "PredictX API"
}
```

---

### Market Endpoints

#### Get All Markets

**Endpoint**: `GET /api/v1/markets`

**Description**: Retrieve all markets

**Response**:
```json
{
  "success": true,
  "count": 3,
  "markets": [
    {
      "id": "12",
      "conditionId": "0x...",
      "startTime": 1761771180,
      "endTime": 1761771240,
      "resolved": false,
      "collateral": "0x0CE3...",
      "oracle": "0xad3F...",
      "kind": 0,
      "timeframe": 1
    }
  ]
}
```

---

#### Get Unresolved Markets

**Endpoint**: `GET /api/v1/markets/unresolved`

**Description**: Retrieve only unresolved markets

**Response**: Same format as `/api/v1/markets`

---

#### Get Market by ID

**Endpoint**: `GET /api/v1/markets/:marketId`

**Description**: Retrieve specific market details

**Parameters**:
- `marketId` (path): Market ID

**Response**:
```json
{
  "success": true,
  "market": {
    "id": "12",
    "conditionId": "0x...",
    "startTime": 1761771180,
    "endTime": 1761771240,
    "resolved": false,
    "winningOutcome": null,
    "startPrice": null,
    "endPrice": null,
    "collateral": "0x0CE3...",
    "oracle": "0xad3F...",
    "kind": 0,
    "timeframe": 1
  }
}
```

---

#### Get Market Stats

**Endpoint**: `GET /api/v1/markets/stats/summary`

**Description**: Retrieve market statistics

**Response**:
```json
{
  "success": true,
  "stats": {
    "total": 15,
    "active": 3,
    "resolved": 12
  }
}
```

---

### Order Endpoints

#### Submit Order

**Endpoint**: `POST /api/v1/orders`

**Description**: Submit a signed order

**Request Body**:
```json
{
  "order": {
    "maker": "0x...",
    "marketId": "12",
    "conditionId": "0x...",
    "outcome": 1,
    "collateral": "0x0CE3...",
    "pricePips": "5000",
    "amount": "50000000",
    "makerFeeBps": 30,
    "takerFeeBps": 30,
    "expiry": 1761772000,
    "salt": "0x...",
    "nonce": 1,
    "mintOnFill": true,
    "allowedTaker": "0x0000000000000000000000000000000000000000",
    "chainId": 1111111,
    "verifyingContract": "0xc73967F29E6dB5b7b61a616d030a9180e8617464"
  },
  "signature": "0x...",
  "side": "buy"
}
```

**Response** (Success):
```json
{
  "success": true,
  "orderId": "0x1234..."
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "Invalid signature"
}
```

**Status Codes**:
- `201`: Order created successfully
- `400`: Invalid request (missing fields, invalid signature, expired order)
- `503`: Service unavailable (matching engine not running)

---

#### Get Order Status

**Endpoint**: `GET /api/v1/orders/:orderId`

**Description**: Query order status by order ID

**Parameters**:
- `orderId` (path): Order hash

**Response**:
```json
{
  "success": true,
  "order": {
    "orderId": "0x1234...",
    "status": "active",
    "filledAmount": "0",
    "remainingAmount": "50000000"
  }
}
```

**Order Status Values**:
- `active`: Order in orderbook, partially/unfilled
- `filled`: Order completely filled
- `cancelled`: Order cancelled by user
- `not_found`: Order not found

---

#### Cancel Order

**Endpoint**: `DELETE /api/v1/orders/:orderId`

**Description**: Cancel an active order

**Parameters**:
- `orderId` (path): Order hash
- `marketId` (query): Market ID
- `outcome` (query): Outcome (0 or 1)

**Example**:
```
DELETE /api/v1/orders/0x1234...?marketId=12&outcome=1
```

**Response** (Success):
```json
{
  "success": true,
  "message": "Order cancelled"
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "Order not found"
}
```

**Status Codes**:
- `200`: Order cancelled successfully
- `404`: Order not found
- `400`: Missing required query parameters

---

### Orderbook Endpoints

#### Get Orderbook

**Endpoint**: `GET /api/v1/orderbook/:marketId/:outcome`

**Description**: Get current orderbook snapshot

**Parameters**:
- `marketId` (path): Market ID
- `outcome` (path): Outcome (0 or 1)

**Response**:
```json
{
  "marketId": "12",
  "outcome": 1,
  "bids": [
    {
      "price": "5000",
      "amount": "80000000",
      "orderCount": 3
    },
    {
      "price": "4900",
      "amount": "120000000",
      "orderCount": 5
    }
  ],
  "asks": [
    {
      "price": "5100",
      "amount": "60000000",
      "orderCount": 2
    },
    {
      "price": "5200",
      "amount": "90000000",
      "orderCount": 4
    }
  ]
}
```

**Notes**:
- `price`: Price in BPS (e.g., "5000" = 50%)
- `amount`: Total amount at this price level (6 decimals)
- `orderCount`: Number of orders at this price level

---

### Stats Endpoint

#### Get System Stats

**Endpoint**: `GET /api/v1/stats`

**Description**: Get matching engine statistics

**Response**:
```json
{
  "success": true,
  "stats": {
    "totalOrders": 150,
    "totalBooks": 6,
    "activeBooks": 4,
    "books": [
      { "market": "12-1", "orders": 45 },
      { "market": "12-0", "orders": 38 }
    ]
  }
}
```

---

## Matching Engine

**Location**: `services/matcher/src/matcher.ts`

The Matching Engine maintains in-memory orderbooks and executes price-time priority matching.

### Architecture

```typescript
MatchingEngine
├── orderBooks: Map<string, OrderBook>  // marketId-outcome → OrderBook
├── filledAmounts: Map<string, bigint>  // orderId → filled amount
└── Methods:
    ├── addOrder()         // Add validated order to orderbook
    ├── cancelOrder()      // Remove order from orderbook
    ├── matchMarket()      // Match orders for specific market
    ├── matchAll()         // Match all markets
    └── matchesToFills()   // Convert matches to fill structures
```

### Orderbook Implementation

**Location**: `services/matcher/src/orderbook.ts`

**Key Features**:
- Price-time priority matching
- Partial fill support
- Efficient price level aggregation
- O(log n) order insertion/removal

**Matching Algorithm**:
```typescript
// For each market + outcome:
1. Sort buy orders by price DESC, then timestamp ASC
2. Sort sell orders by price ASC, then timestamp ASC
3. While (best bid price >= best ask price):
   a. Match orders
   b. Generate fill
   c. Update remaining amounts
   d. Remove fully filled orders
```

### Order Validation

Orders are validated before being added to the orderbook:

```typescript
// Basic validation
- amount > 0
- expiry > now
- outcome ∈ {0, 1}

// Signature validation
- Verify EIP-712 signature
- Check signer === order.maker

// Duplicate check
- Calculate order hash
- Check if already fully filled
```

### Matching Frequency

The matching engine runs every **1 second** (configurable):

```typescript
setInterval(async () => {
  const matches = engine.matchAll();
  // Send matches to Relayer
}, 1000);
```

### Single-Fill System

**Critical**: The system uses a single-sided fill approach to prevent duplicate minting:

```typescript
matchesToFills(matches: Match[]): Fill[] {
  const fills: Fill[] = [];

  for (const match of matches) {
    // Only create ONE fill per match
    // sellOrder is maker, buyOrder.maker is taker
    fills.push({
      order: match.sellOrder.order,
      signature: match.sellOrder.signature,
      fillAmount: match.matchAmount,
      taker: match.buyOrder.order.maker,
    });
  }

  return fills;
}
```

**Why Single-Fill?**
- Prevents double-minting of tokens
- Seller locks collateral, mints complete set
- Seller transfers outcome token to buyer
- Seller keeps opposite outcome token

---

## Relayer

**Location**: `services/relayer/src/relayer.ts`

The Relayer batches matched orders and submits them to the blockchain via `SettlementV2.batchFill()`.

### Features

1. **Batch Processing**: Groups multiple fills into single transaction
2. **Gas Monitoring**: Checks gas price before submission
3. **Retry Logic**: Automatic retry on temporary failures
4. **Failure Detection**: Identifies permanent vs. temporary failures
5. **Statistics Tracking**: Monitors submission success rate

### Configuration

```typescript
const config = {
  batchSize: 10,           // Max fills per batch
  batchDelayMs: 2000,      // Max wait time (2 seconds)
  maxGasPrice: 100,        // Max gas price (gwei)
  maxRetries: 3,           // Retry attempts
};
```

### Submission Flow

```typescript
1. Receive fills from Matcher
2. Add to pending queue
3. When queue reaches batchSize OR timeout expires:
   a. Check current gas price
   b. If gasPrice > maxGasPrice: wait and retry
   c. Estimate gas for batch
   d. Call settlement.batchFill(fills)
   e. Wait for confirmation
   f. On success: clear queue
   g. On failure: retry or mark permanent failure
```

### Error Handling

**Temporary Failures** (retry):
- Network timeout
- Gas price too high
- Nonce too low
- Transaction underpriced

**Permanent Failures** (no retry):
- Invalid signature
- Order expired
- Insufficient balance
- Order overfill

### Statistics

```typescript
{
  totalSubmissions: 25,
  totalFills: 180,
  pendingFills: 8,
  failedSubmissions: 2,
  permanentlyFailedFills: 1,
  averageGasPerSubmission: 850000n,
  averageFillsPerBatch: 7.2
}
```

---

## Market Manager

**Location**: `services/manager/src/manager.ts`

The Market Manager automatically discovers new markets and resolves expired markets.

### Features

1. **Event Listening**: Monitors `MarketCreated` events from MarketRegistryV2
2. **Periodic Scanning**: Checks for resolvable markets every 30 seconds
3. **Auto Resolution**: Calls `MarketRegistryV2.resolveMarket()` when ready
4. **Market Caching**: Maintains local cache of markets synced from blockchain

### Market Discovery

**Event-Based**:
```typescript
// Listen for MarketCreated events
marketRegistry.on("MarketCreated", async (marketId, conditionId, event) => {
  console.log(`📡 New market discovered: ${marketId}`);
  await syncMarket(marketId);
});
```

**Periodic Scanning**:
```typescript
setInterval(async () => {
  // Get total market count
  const latestId = await marketRegistry.latestMarketId();

  // Sync any missing markets
  for (let id = 1; id <= latestId; id++) {
    if (!markets.has(id.toString())) {
      await syncMarket(id.toString());
    }
  }
}, 60000); // Every 60 seconds
```

### Market Resolution

**Resolution Criteria**:
```typescript
canResolve = (
  market.resolved === false &&
  block.timestamp >= market.endTime &&
  block.timestamp >= market.endTime + resolveBuffer
);
```

**Resolution Flow**:
```typescript
1. Find all unresolved markets
2. For each market where canResolve == true:
   a. Call marketRegistry.resolveMarket(marketId)
   b. Wait for confirmation
   c. Update local cache
   d. Log resolution details
```

**Resolve Buffer**: 60 seconds after market end time to ensure price data is available

### Statistics

```typescript
{
  totalMarkets: 15,
  unresolvedMarkets: 3,
  marketDiscoveries: 15,
  marketResolutions: 12,
  failedResolutions: 0
}
```

---

## Runner

**Location**: `services/runner.ts`

The Runner is the unified service launcher that starts and monitors all backend services.

### Services Started

```typescript
1. API Server (Express)
2. Matching Engine
3. Relayer
4. Market Manager
```

### Monitoring

The Runner outputs consolidated statistics every **30 seconds**:

```
=== PredictX Backend Stats ===

Matcher:
  Total Orders: 150
  Active Books: 4
  Total Matches: 45

Relayer:
  Total Submissions: 25
  Total Fills: 180
  Pending Fills: 8
  Failed Submissions: 2

Market Manager:
  Total Markets: 15
  Unresolved: 3
  Resolutions: 12

API Server:
  Port: 8080
  Status: Running

==============================
```

### Startup

```bash
cd services
pnpm start
```

Expected output:
```
Starting PredictX Backend Services...
✅ Matching Engine started
✅ Relayer started
✅ Market Manager started
📡 启动 MarketCreated 事件监听...
🚀 API Server listening on http://localhost:8080
```

---

## Deployment

### Local Development

```bash
# Install dependencies
cd services
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your private keys

# Start all services
pnpm start
```

### Docker Deployment

**Build Image**:
```bash
docker build -f docker/Dockerfile.backend -t predictx-backend .
```

**Run Container**:
```bash
docker run -d \
  --name predictx-backend \
  -p 8080:8080 \
  --env-file services/.env \
  predictx-backend
```

**Docker Compose**:
```bash
docker-compose -f docker-compose.backend.yml up -d
```

### Production Checklist

- [ ] Configure `RELAYER_PRIVATE_KEY` and `MARKET_MANAGER_PRIVATE_KEY`
- [ ] Ensure accounts have sufficient ETH for gas
- [ ] Set `CORS_ORIGIN` to frontend domain
- [ ] Configure `MAX_GAS_PRICE` appropriately
- [ ] Set up monitoring and alerting
- [ ] Configure log aggregation (ELK/Loki)
- [ ] Set up load balancer for API server
- [ ] Enable rate limiting
- [ ] Implement database persistence (PostgreSQL)

---

## Monitoring & Debugging

### Health Check

```bash
curl http://localhost:8080/health
```

### View Logs

**Docker**:
```bash
docker logs -f predictx-backend
```

**Local**:
```bash
cd services
pnpm start | tee backend.log
```

### Debug Order Submission

```bash
# Submit test order
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Content-Type: application/json" \
  -d @test-order.json

# Check order status
curl http://localhost:8080/api/v1/orders/0x1234...
```

### Monitor Matching

```bash
# Get orderbook snapshot
curl http://localhost:8080/api/v1/orderbook/12/1

# Get stats
curl http://localhost:8080/api/v1/stats
```

---

## Performance Metrics

### API Response Times

- Health check: < 5ms
- Market list: < 20ms
- Orderbook query: < 15ms
- Order submission: < 100ms (including signature verification)

### Matching Performance

- Matching frequency: 1 second
- Orders per book: 100-1000
- Matching latency: < 10ms per market
- Memory usage: ~50MB for 10,000 orders

### Relayer Performance

- Batch size: 10 fills
- Batch delay: 2 seconds
- Average gas per batch: ~850k
- Transaction confirmation: ~2-5 seconds (Socrates Testnet)

---

## Error Codes

### API Errors

| Code | Message | Description |
|------|---------|-------------|
| 400 | Invalid amount | Order amount <= 0 |
| 400 | Order expired | Order expiry < current time |
| 400 | Invalid outcome | Outcome not 0 or 1 |
| 400 | Invalid signature | EIP-712 signature verification failed |
| 400 | Order already filled | Order has no remaining amount |
| 404 | Order not found | Order ID not in any orderbook |
| 404 | Market not found | Market ID doesn't exist |
| 503 | Service unavailable | Matching engine not initialized |

### Contract Errors

| Selector | Error | Description |
|----------|-------|-------------|
| 0x... | InsufficientBalance() | Not enough deposited collateral |
| 0x... | InvalidSignature() | Order signature invalid |
| 0x... | OrderExpired() | Order past expiry timestamp |
| 0x... | Overfill() | Trying to fill more than order amount |
| 0x... | UnsupportedCollateral() | Collateral token not whitelisted |

---

## Future Enhancements

### High Priority

1. **Database Persistence**
   - PostgreSQL for order/fill/market storage
   - Redis for orderbook caching
   - Prevents data loss on restart

2. **WebSocket Support**
   - Real-time orderbook updates
   - Order status notifications
   - Market resolution events

3. **Rate Limiting**
   - Per-IP request limiting
   - Anti-spam protection
   - DDoS mitigation

### Medium Priority

4. **Order History API**
   - Query user's historical orders
   - Query market trade history
   - Analytics endpoints

5. **Advanced Matching**
   - Market orders
   - Stop loss/take profit
   - Fill-or-kill, Immediate-or-cancel

6. **Monitoring & Alerting**
   - Prometheus metrics
   - Grafana dashboards
   - Telegram/email alerts

### Low Priority

7. **Horizontal Scaling**
   - Multiple API server instances
   - Load balancing
   - Distributed orderbook

8. **GraphQL API**
   - Flexible query interface
   - Subscription support
   - Better developer experience

---

## API Client Examples

### JavaScript/TypeScript

```typescript
import { ethers } from 'ethers';

const API_URL = 'http://localhost:8080';

// Submit order
async function submitOrder(wallet, order) {
  const domain = {
    name: 'PredictXSettlementV2',
    version: '1',
    chainId: 1111111,
    verifyingContract: settlementAddress,
  };

  const signature = await wallet.signTypedData(domain, ORDER_TYPES, order);

  const response = await fetch(`${API_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order, signature, side: 'buy' }),
  });

  return await response.json();
}

// Get orderbook
async function getOrderbook(marketId, outcome) {
  const response = await fetch(
    `${API_URL}/api/v1/orderbook/${marketId}/${outcome}`
  );
  return await response.json();
}
```

### Python

```python
import requests

API_URL = 'http://localhost:8080'

# Get markets
def get_markets():
    response = requests.get(f'{API_URL}/api/v1/markets')
    return response.json()

# Get orderbook
def get_orderbook(market_id, outcome):
    response = requests.get(
        f'{API_URL}/api/v1/orderbook/{market_id}/{outcome}'
    )
    return response.json()
```

---

## Troubleshooting

### Orders Not Matching

**Possible Causes**:
1. Price doesn't cross (buy price < sell price)
2. Different orderbooks (different marketId or outcome)
3. Order expired
4. Order already filled

**Solutions**:
- Check order prices and parameters
- View matcher logs for matching activity
- Verify order not expired

### Fills Not Submitting

**Possible Causes**:
1. Relayer not running
2. Gas price too high
3. Insufficient ETH balance
4. Network connectivity issues

**Solutions**:
- Check Relayer process is running
- Increase `MAX_GAS_PRICE`
- Ensure Relayer account has sufficient ETH
- Check RPC connection

### Markets Not Auto-Resolving

**Possible Causes**:
1. Market Manager not running
2. Insufficient ETH balance
3. Oracle price not available
4. Resolve buffer not elapsed

**Solutions**:
- Check Market Manager process
- Ensure Market Manager account has ETH
- Wait 60 seconds after market endTime
- Check Oracle adapter has price data

---

For smart contract details, see **CONTRACTS.md**.
For frontend integration, see **FRONTEND.md**.
