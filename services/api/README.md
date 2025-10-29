# PredictX API Service

REST API for submitting orders to the PredictX prediction market.

## Overview

The API service provides HTTP endpoints for:
- Submitting signed orders to the matching engine
- Checking order status
- Viewing orderbook state
- Getting matcher statistics

## Endpoints

### Health Check

```
GET /health
```

Returns API health status.

**Response:**
```json
{
  "status": "ok",
  "service": "PredictX API"
}
```

---

### Submit Order

```
POST /api/v1/orders
```

Submit a signed order to the matching engine.

**Request Body:**
```json
{
  "order": {
    "maker": "0x...",
    "marketId": "1",
    "conditionId": "0x...",
    "outcome": 1,
    "collateral": "0x...",
    "pricePips": "5500",
    "amount": "100000000",
    "makerFeeBps": 30,
    "takerFeeBps": 30,
    "expiry": 1234567890,
    "salt": "0x...",
    "nonce": 1,
    "mintOnFill": true,
    "allowedTaker": "0x0000000000000000000000000000000000000000"
  },
  "signature": "0x...",
  "side": "buy"
}
```

**Note on Precision:**
- `pricePips`: Price in basis points (BPS), range 0-10000 (e.g., 5500 = 55%)
- `amount`: Amount in USDC wei (6 decimals, e.g., 100000000 = 100 USDC)

**Parameters:**
- `order`: Order object matching OrderV2 type
- `signature`: EIP-712 signature from the maker
- `side`: Either "buy" or "sell"

**Response (Success):**
```json
{
  "success": true,
  "orderId": "0x..."
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid signature"
}
```

---

### Get Order Status

```
GET /api/v1/orders/:orderId
```

Get the current status of an order.

**Response:**
```json
{
  "orderId": "0x...",
  "status": "active",
  "filledAmount": "50000000000000000000",
  "remainingAmount": "50000000000000000000"
}
```

**Status Values:**
- `active`: Order is in the orderbook
- `filled`: Order is completely filled
- `cancelled`: Order was cancelled
- `not_found`: Order not found

---

### Get Orderbook

```
GET /api/v1/orderbook/:marketId/:outcome
```

Get the current orderbook for a market and outcome.

**Response:**
```json
{
  "marketId": "1",
  "outcome": 1,
  "bids": [
    {
      "price": "0.55",
      "amount": "100"
    }
  ],
  "asks": [
    {
      "price": "0.60",
      "amount": "200"
    }
  ]
}
```

---

### Get Statistics

```
GET /api/v1/stats
```

Get matching engine statistics.

**Response:**
```json
{
  "totalOrders": 150,
  "activeBooks": 6,
  "totalMatches": 42
}
```

## Configuration

Configure via environment variables:

```bash
API_PORT=3000  # API server port (default: 3000)
```

## Usage Example

### Using cURL

```bash
# Submit a buy order
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "order": { ... },
    "signature": "0x...",
    "side": "buy"
  }'

# Check order status
curl http://localhost:3000/api/v1/orders/0x1234...

# Get orderbook
curl http://localhost:3000/api/v1/orderbook/1/1

# Get stats
curl http://localhost:3000/api/v1/stats
```

### Using JavaScript/TypeScript

```typescript
import { ethers } from "ethers";

// 1. Sign order with EIP-712
const order = {
  maker: wallet.address,
  marketId: "1",
  conditionId: "0x...",
  outcome: 1,
  collateral: usdcAddress,
  pricePips: "5500", // 55% in BPS (basis points, 0-10000)
  amount: "100000000", // 100 USDC (6 decimals)
  makerFeeBps: 30,
  takerFeeBps: 30,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  salt: ethers.hexlify(ethers.randomBytes(32)),
  nonce: 1,
  mintOnFill: true,
  allowedTaker: ethers.ZeroAddress,
};

const domain = {
  name: "PredictXSettlementV2",
  version: "1",
  chainId: 1111111,
  verifyingContract: settlementAddress,
};

const types = {
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

const signature = await wallet.signTypedData(domain, types, order);

// 2. Submit to API
const response = await fetch("http://localhost:3000/api/v1/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    order,
    signature,
    side: "buy",
  }),
});

const result = await response.json();
console.log("Order ID:", result.orderId);
```

## Integration Flow

```
User (Frontend)
    |
    | 1. Sign order with EIP-712
    v
API Server (POST /api/v1/orders)
    |
    | 2. Validate signature
    | 3. Submit to MatchingEngine
    v
Matching Engine
    |
    | 4. Add to orderbook
    | 5. Match orders (every 5s)
    v
Relayer
    |
    | 6. Batch fills (every 2s)
    | 7. Submit to blockchain
    v
Settlement Contract
    |
    | 8. Execute trades
    | 9. Mint CTF positions
```

## Error Handling

The API returns standard HTTP status codes:

- `200`: Success
- `201`: Order created
- `400`: Bad request (validation error)
- `404`: Not found
- `500`: Internal server error
- `503`: Service unavailable

All error responses include an `error` field with a description:

```json
{
  "success": false,
  "error": "Order expired"
}
```

## CORS

CORS is enabled for all origins in the current implementation. For production, configure allowed origins in the API server code.
