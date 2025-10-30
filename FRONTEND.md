# Frontend Documentation

This document describes the frontend architecture, components, and integration guide for the PredictX prediction market platform.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│                   (React + ethers.js)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Account    │  │   Market     │  │    Trade     │      │
│  │   Panel      │  │   List       │  │    Form      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Orderbook   │  │  My Orders   │  │  Position    │      │
│  │   Display    │  │   Panel      │  │   Panel      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────┬─────────────────────────────────────┬──────────┘
             │                                     │
             ▼                                     ▼
      REST API Server                      Smart Contracts
    (Order Submission)                  (Wallet Interaction)
```

---

## Technology Stack

- **Framework**: React 18 + Vite
- **Language**: TypeScript
- **Blockchain**: ethers.js v6
- **Styling**: Inline CSS (currently), migrate to Tailwind/MUI recommended
- **State Management**: React useState/useEffect (migrate to Zustand/Redux recommended)

---

## Project Structure

```
apps/web/
├── src/
│   ├── components/
│   │   ├── AccountPanel.tsx      # Account selection, balances, deposit/withdraw
│   │   ├── MarketCreator.tsx     # Quick market creation (testing only)
│   │   ├── TradeForm.tsx         # Buy/Sell order submission
│   │   ├── OrderBook.tsx         # Orderbook display
│   │   ├── MyOrders.tsx          # User's active orders
│   │   ├── PositionPanel.tsx     # User's CTF positions
│   │   ├── RedemptionPanel.tsx   # Redeem winning positions
│   │   └── AllPositionsPanel.tsx # All positions across markets
│   ├── lib/
│   │   ├── contracts.ts          # Contract addresses and ABIs
│   │   └── ethers.ts             # ethers.js utilities and helpers
│   ├── App.tsx                   # Main application component
│   └── main.tsx                  # Application entry point
├── .env.development              # Development environment variables
└── package.json
```

---

## Setup & Installation

### Prerequisites

- Node.js >= 18
- pnpm >= 8

### Install Dependencies

```bash
cd apps/web
pnpm install
```

### Configure Environment

**File**: `apps/web/.env.development`

```bash
# API Configuration
VITE_API_URL=http://localhost:8080

# Blockchain Configuration
VITE_RPC_URL=https://rpc-testnet.socrateschain.org
VITE_CHAIN_ID=1111111

# Demo Accounts (for testing only - DO NOT USE IN PRODUCTION)
VITE_DEMO_TRADER_ADDRESS=0xe40a34B77CBf15b49F6981e4236c76c2f096D261
VITE_DEMO_TRADER_PK=0x5cdd95739afcbbff215713d1f43bdda57805eca339f4025bff6f78109d766560

VITE_LIQUIDITY_PROVIDER_ADDRESS=0x44ffe865Ed0807D95be110E58B673111B702a122
VITE_LIQUIDITY_PROVIDER_PK=0xbdaf9384fcdbcfc432001bfec2713e81ffbae2cb617305a8d765f17bfb28ae1c

VITE_MARKET_CREATOR_PK=0xb304b6c6a8ed29942c2414d1dd2aaa9817aa5ff42f80e5634e2b1e1d8fc63f47
```

**WARNING**: Demo private keys are for local testing only. Remove before production deployment.

### Start Development Server

```bash
pnpm dev
```

Application will be available at `http://localhost:5173` (or next available port).

---

## Core Components

### AccountPanel.tsx

**Purpose**: Manage user accounts, display balances, deposit/withdraw collateral

**Key Features**:
- Switch between demo accounts or connect MetaMask
- Display USDC balance, deposited collateral, and CTF positions
- Deposit/withdraw USDC to/from Settlement contract

**Usage**:
```tsx
<AccountPanel
  account={selectedAccount}
  onAccountChange={setSelectedAccount}
/>
```

**Key Functions**:

```typescript
// Load balances
const loadBalances = async () => {
  const usdcBalance = await usdc.balanceOf(account.address);
  const collateralBalance = await settlement.collateralBalances(
    account.address,
    USDC_ADDRESS
  );
};

// Deposit collateral
const handleDeposit = async (amount: string) => {
  const wallet = createWallet(account.privateKey);
  const usdc = getUSDC(wallet);
  const settlement = getSettlement(wallet);

  await usdc.approve(SETTLEMENT_ADDRESS, parseUSDC(amount));
  await settlement.depositCollateral(USDC_ADDRESS, parseUSDC(amount));
};

// Withdraw collateral
const handleWithdraw = async (amount: string) => {
  const wallet = createWallet(account.privateKey);
  const settlement = getSettlement(wallet);

  await settlement.withdrawCollateral(USDC_ADDRESS, parseUSDC(amount));
};
```

---

### MarketCreator.tsx

**Purpose**: Quick market creation for testing (admin/testing only)

**Key Features**:
- Create BTC UP/DOWN markets with custom timeframes
- Auto-calculate next minute-aligned start time
- Display created market details

**Usage**:
```tsx
<MarketCreator onMarketCreated={refreshMarkets} />
```

**Key Functions**:

```typescript
const handleCreateMarket = async (timeframe: number) => {
  const wallet = createWallet(import.meta.env.VITE_MARKET_CREATOR_PK);
  const registry = getMarketRegistry(wallet);

  // Calculate next minute-aligned timestamp + buffer
  const now = Math.floor(Date.now() / 1000);
  const nextMinute = Math.ceil((now + 60) / 60) * 60;

  const tx = await registry.createMarket(
    USDC_ADDRESS,
    ORACLE_ADAPTER_ADDRESS,
    nextMinute,
    0, // BTC_UPDOWN
    timeframe
  );

  const receipt = await tx.wait();
  // Parse MarketCreated event for marketId
};
```

**WARNING**: This component should only be visible in development mode and only to authorized accounts.

---

### TradeForm.tsx

**Purpose**: Submit buy/sell orders for specific market outcomes

**Key Features**:
- Buy or Sell order submission
- Price input (0-1 range, converted to BPS)
- Amount input with quick select buttons
- Cost/profit calculation preview
- EIP-712 order signing

**Usage**:
```tsx
<TradeForm
  market={selectedMarket}
  account={currentAccount}
  outcome={1} // 0=DOWN, 1=UP
  side="buy" // or "sell"
  onOrderSubmitted={handleOrderSubmitted}
/>
```

**Order Submission Flow**:

```typescript
const handleSubmit = async () => {
  // 1. Create wallet from private key
  const wallet = createWallet(account.privateKey);

  // 2. Prepare order
  const order: OrderV2 = {
    maker: account.address,
    marketId: market.id,
    conditionId: market.conditionId,
    outcome: outcome, // 0=DOWN, 1=UP
    collateral: USDC_ADDRESS,
    pricePips: parsePriceToPips(price), // Convert 0.55 → "5500"
    amount: parseUSDC(amount).toString(), // Convert 100 → "100000000"
    makerFeeBps: 30, // 0.3%
    takerFeeBps: 30, // 0.3%
    expiry: Math.floor(Date.now() / 1000) + 86400, // 24h
    salt: ethers.hexlify(ethers.randomBytes(16)),
    nonce: Math.floor(Date.now() / 1000),
    mintOnFill: true, // Always true in V2
    allowedTaker: '0x0000000000000000000000000000000000000000',
    chainId: CHAIN_ID,
    verifyingContract: SETTLEMENT_ADDRESS,
  };

  // 3. Sign order with EIP-712
  const signature = await signOrder(wallet, order);

  // 4. Submit to API
  const response = await fetch(`${API_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order, signature, side }),
  });

  const data = await response.json();

  if (data.success) {
    onOrderSubmitted({
      orderId: data.orderId,
      marketId: market.id,
      outcome,
      side,
      pricePips: order.pricePips,
      amount: order.amount,
      timestamp: Date.now(),
    });
  }
};
```

**Price Conversion**:
```typescript
// User inputs: 0.55 (55%)
// Convert to BPS: 5500
function parsePriceToPips(price: string): string {
  return Math.round(parseFloat(price) * 10000).toString();
}

// Display BPS as percentage
function formatPrice(pricePips: string): string {
  return (parseInt(pricePips) / 100).toFixed(2) + '%';
}
```

---

### OrderBook.tsx

**Purpose**: Display current orderbook (bids and asks) for a market outcome

**Key Features**:
- Real-time orderbook display (polled every 5s)
- Price level aggregation
- Order count per price level
- Total volume at each level

**Usage**:
```tsx
<OrderBook
  marketId={market.id}
  outcome={1}
/>
```

**Data Fetching**:

```typescript
const loadOrderbook = async () => {
  const response = await fetch(
    `${API_URL}/api/v1/orderbook/${marketId}/${outcome}`
  );
  const data = await response.json();

  setBids(data.bids); // [{ price, amount, orderCount }]
  setAsks(data.asks);
};

// Auto-refresh every 5 seconds
useEffect(() => {
  loadOrderbook();
  const interval = setInterval(loadOrderbook, 5000);
  return () => clearInterval(interval);
}, [marketId, outcome]);
```

---

### MyOrders.tsx

**Purpose**: Display user's active orders with cancel functionality

**Key Features**:
- Show all orders submitted by current account
- Display order status (active/filled/cancelled)
- Cancel active orders
- Filter by market/outcome

**Usage**:
```tsx
<MyOrders
  account={currentAccount}
  orders={submittedOrders}
  onOrderCancelled={refreshOrders}
/>
```

**Order Cancellation**:

```typescript
const handleCancelOrder = async (order) => {
  const response = await fetch(
    `${API_URL}/api/v1/orders/${order.orderId}?marketId=${order.marketId}&outcome=${order.outcome}`,
    { method: 'DELETE' }
  );

  const data = await response.json();

  if (data.success) {
    onOrderCancelled(order.orderId);
  }
};
```

---

### PositionPanel.tsx

**Purpose**: Display user's CTF position balances

**Key Features**:
- Show DOWN and UP token balances for each market
- Real-time balance updates
- Position value calculation

**Usage**:
```tsx
<PositionPanel
  account={currentAccount}
  markets={allMarkets}
/>
```

**Position Querying**:

```typescript
const loadPositions = async () => {
  const ctf = getCTF(provider);
  const positions = [];

  for (const market of markets) {
    // Query DOWN position
    const downPositionId = getPositionId(market.conditionId, 0);
    const downBalance = await ctf.balanceOf(account.address, downPositionId);

    // Query UP position
    const upPositionId = getPositionId(market.conditionId, 1);
    const upBalance = await ctf.balanceOf(account.address, upPositionId);

    positions.push({
      marketId: market.id,
      downBalance: formatUnits(downBalance, 6),
      upBalance: formatUnits(upBalance, 6),
    });
  }

  setPositions(positions);
};
```

**Position ID Calculation**:

```typescript
import { solidityPackedKeccak256 } from 'ethers';

function getPositionId(conditionId: string, outcome: number): string {
  const indexSet = outcome === 0 ? 1 : 2; // 1 for DOWN, 2 for UP

  const collectionId = solidityPackedKeccak256(
    ['bytes32', 'uint256'],
    [conditionId, indexSet]
  );

  const positionId = solidityPackedKeccak256(
    ['address', 'bytes32'],
    [USDC_ADDRESS, collectionId]
  );

  return positionId;
}
```

---

### RedemptionPanel.tsx

**Purpose**: Redeem winning positions after market resolution

**Key Features**:
- Show only redeemable positions (resolved markets with winning outcomes)
- Display potential payout
- One-click redemption

**Usage**:
```tsx
<RedemptionPanel
  account={currentAccount}
  markets={allMarkets}
/>
```

**Redemption Flow**:

```typescript
const loadRedeemablePositions = async () => {
  const ctf = getCTF(provider);
  const redeemable = [];

  // Filter only resolved markets
  const resolvedMarkets = markets.filter(m => m.resolved && m.winningOutcome !== null);

  for (const market of resolvedMarkets) {
    for (let outcome = 0; outcome <= 1; outcome++) {
      const positionId = getPositionId(market.conditionId, outcome);
      const balance = await ctf.balanceOf(account.address, positionId);

      // Only include winning positions with non-zero balance
      if (balance > 0n && outcome === market.winningOutcome) {
        redeemable.push({
          marketId: market.id,
          conditionId: market.conditionId,
          outcome,
          balance: formatUnits(balance, 6),
          payout: formatUnits(balance, 6), // 1:1 for winning outcome
        });
      }
    }
  }

  setRedeemablePositions(redeemable);
};

const handleRedeem = async (position) => {
  const wallet = createWallet(account.privateKey);
  const ctf = getCTF(wallet);

  const indexSet = position.outcome === 0 ? 1 : 2;

  await ctf.redeemPositions(
    USDC_ADDRESS,
    position.conditionId,
    [indexSet]
  );

  // Refresh balances
  await loadRedeemablePositions();
};
```

---

## Utility Functions

### lib/ethers.ts

**Purpose**: Centralized ethers.js utilities and contract helpers

**Key Functions**:

```typescript
// Create wallet from private key
export function createWallet(privateKey: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL);
  return new ethers.Wallet(privateKey, provider);
}

// Get contract instances
export function getUSDC(signerOrProvider: any) {
  return new ethers.Contract(USDC_ADDRESS, USDC_ABI, signerOrProvider);
}

export function getSettlement(signerOrProvider: any) {
  return new ethers.Contract(SETTLEMENT_ADDRESS, SETTLEMENT_ABI, signerOrProvider);
}

export function getCTF(signerOrProvider: any) {
  return new ethers.Contract(CTF_ADDRESS, CTF_ABI, signerOrProvider);
}

export function getMarketRegistry(signerOrProvider: any) {
  return new ethers.Contract(MARKET_REGISTRY_ADDRESS, REGISTRY_ABI, signerOrProvider);
}

// Format USDC amounts
export function parseUSDC(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}

export function formatUSDC(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

// Price conversion
export function parsePriceToPips(price: string): string {
  return Math.round(parseFloat(price) * 10000).toString();
}

export function formatPriceFromPips(pricePips: string): string {
  return (parseInt(pricePips) / 10000).toString();
}

// EIP-712 order signing
export async function signOrder(
  wallet: ethers.Wallet,
  order: OrderV2
): Promise<string> {
  const domain = {
    name: 'PredictXSettlementV2',
    version: '1',
    chainId: parseInt(order.chainId.toString()),
    verifyingContract: order.verifyingContract,
  };

  const types = {
    OrderV2: [
      { name: 'maker', type: 'address' },
      { name: 'marketId', type: 'string' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'outcome', type: 'uint8' },
      { name: 'collateral', type: 'address' },
      { name: 'pricePips', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'makerFeeBps', type: 'uint16' },
      { name: 'takerFeeBps', type: 'uint16' },
      { name: 'expiry', type: 'uint256' },
      { name: 'salt', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'mintOnFill', type: 'bool' },
      { name: 'allowedTaker', type: 'address' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
  };

  return await wallet.signTypedData(domain, types, order);
}
```

---

### lib/contracts.ts

**Purpose**: Contract addresses and constants

```typescript
export const USDC_ADDRESS = '0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce';
export const CTF_ADDRESS = '0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665';
export const SETTLEMENT_ADDRESS = '0xc73967F29E6dB5b7b61a616d030a9180e8617464';
export const MARKET_REGISTRY_ADDRESS = '0xE108166156626bD94e5686847F7a29E044D2b73c';
export const ORACLE_ADAPTER_ADDRESS = '0xad3F4094cfA60d2503057e26EbeAf241AC7434E8';
export const CHAIN_ID = 1111111;

export const USDC_ABI = [ /* ... */ ];
export const SETTLEMENT_ABI = [ /* ... */ ];
export const CTF_ABI = [ /* ... */ ];
export const MARKET_REGISTRY_ABI = [ /* ... */ ];
```

---

## User Workflows

### 1. Complete Trading Flow

**Step 1: Select Account**
```
User selects "Demo Trader" or "Liquidity Provider" from dropdown
→ Displays USDC balance, deposited collateral, CTF positions
```

**Step 2: Deposit Collateral**
```
User clicks "Deposit 50 USDC"
→ Approve USDC spending
→ Call settlement.depositCollateral()
→ Wait for confirmation
→ Refresh balances
```

**Step 3: Select Market**
```
User selects an active market from market list
→ Displays market details, countdown to expiry
→ Loads orderbook for both outcomes
```

**Step 4: Submit Order**
```
User enters:
- Price: 0.55 (55%)
- Amount: 100 USDC
- Side: BUY
- Outcome: UP

→ Sign EIP-712 order
→ Submit to API
→ Order appears in "My Orders" panel
→ Order appears in orderbook
```

**Step 5: Wait for Match**
```
Matcher finds crossing orders
→ Relayer submits fill to blockchain
→ User receives UP tokens
→ Position appears in "Position Panel"
```

**Step 6: Wait for Market Resolution**
```
Market expires
→ MarketManager resolves market
→ Market shows winning outcome
→ Winning positions appear in "Redemption Panel"
```

**Step 7: Redeem Winnings**
```
User clicks "Redeem" for winning position
→ Call ctf.redeemPositions()
→ Receive USDC back to deposited balance
```

**Step 8: Withdraw**
```
User clicks "Withdraw All"
→ Call settlement.withdrawCollateral()
→ USDC appears in wallet balance
```

---

### 2. MetaMask Integration (Recommended for Production)

**Connect Wallet**:
```typescript
const connectWallet = async () => {
  if (typeof window.ethereum !== 'undefined') {
    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      // Check network
      const chainId = await window.ethereum.request({
        method: 'eth_chainId',
      });

      if (chainId !== '0x10F447') { // 1111111 in hex
        alert('Please switch to Socrates Testnet');
        return;
      }

      // Create provider and signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      setAccount({
        address: accounts[0],
        signer,
      });
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  } else {
    alert('Please install MetaMask');
  }
};
```

**Network Switching**:
```typescript
const switchToSocrates = async () => {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x10F447' }], // 1111111
    });
  } catch (switchError: any) {
    // Network not added, add it
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x10F447',
          chainName: 'Socrates Testnet',
          rpcUrls: ['https://rpc-testnet.socrateschain.org'],
          nativeCurrency: {
            name: 'SOCRATES',
            symbol: 'SOC',
            decimals: 18,
          },
          blockExplorerUrls: ['https://explorer-testnet.socrateschain.org'],
        }],
      });
    }
  }
};
```

---

## Styling

### Current Approach

The current implementation uses inline CSS. This is acceptable for prototyping but not recommended for production.

**Example**:
```tsx
<div style={{ padding: '20px', border: '2px solid #4CAF50', borderRadius: '8px' }}>
  <h3 style={{ margin: '0 0 15px 0', color: '#4CAF50' }}>BUY UP</h3>
  <input type="number" style={{ width: '100%', padding: '8px' }} />
</div>
```

### Recommended Approach

**Option 1: Tailwind CSS**
```bash
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

```tsx
<div className="p-5 border-2 border-green-500 rounded-lg">
  <h3 className="mb-4 text-green-500 font-bold">BUY UP</h3>
  <input type="number" className="w-full p-2 border rounded" />
</div>
```

**Option 2: Material-UI**
```bash
pnpm add @mui/material @emotion/react @emotion/styled
```

```tsx
import { Box, Typography, TextField } from '@mui/material';

<Box sx={{ p: 2, border: '2px solid green', borderRadius: 1 }}>
  <Typography variant="h6" color="green">BUY UP</Typography>
  <TextField fullWidth type="number" />
</Box>
```

---

## State Management

### Current Approach

The current implementation uses React's built-in `useState` and `useEffect` hooks. This works for small applications but becomes unwieldy as complexity grows.

### Recommended Approach

**Option 1: Zustand (Lightweight)**

```bash
pnpm add zustand
```

```typescript
// store.ts
import create from 'zustand';

interface AppState {
  account: Account | null;
  markets: Market[];
  orders: Order[];
  setAccount: (account: Account | null) => void;
  setMarkets: (markets: Market[]) => void;
  addOrder: (order: Order) => void;
}

export const useStore = create<AppState>((set) => ({
  account: null,
  markets: [],
  orders: [],
  setAccount: (account) => set({ account }),
  setMarkets: (markets) => set({ markets }),
  addOrder: (order) => set((state) => ({ orders: [...state.orders, order] })),
}));

// Usage in components
const { account, setAccount } = useStore();
```

**Option 2: Redux Toolkit (Full-featured)**

```bash
pnpm add @reduxjs/toolkit react-redux
```

---

## Real-time Updates

### Current Approach

Polling-based updates with `setInterval`:

```typescript
useEffect(() => {
  const interval = setInterval(loadOrderbook, 5000);
  return () => clearInterval(interval);
}, []);
```

### Recommended Approach

**WebSocket Integration** (requires backend WebSocket support):

```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function useOrderbook(marketId: string, outcome: number) {
  const [orderbook, setOrderbook] = useState({ bids: [], asks: [] });

  useEffect(() => {
    const socket = io('http://localhost:8080');

    // Subscribe to orderbook updates
    socket.emit('subscribe', { marketId, outcome });

    // Listen for updates
    socket.on('orderbook_update', (data) => {
      if (data.marketId === marketId && data.outcome === outcome) {
        setOrderbook(data.orderbook);
      }
    });

    return () => {
      socket.emit('unsubscribe', { marketId, outcome });
      socket.disconnect();
    };
  }, [marketId, outcome]);

  return orderbook;
}
```

---

## Error Handling

### Current Approach

Basic try-catch with status messages:

```typescript
try {
  const response = await fetch('/api/v1/orders', { ... });
  const data = await response.json();

  if (data.success) {
    setStatus('Success!');
  } else {
    setStatus(`Error: ${data.error}`);
  }
} catch (error: any) {
  setStatus(`Error: ${error.message}`);
}
```

### Recommended Approach

**Centralized Error Handler**:

```typescript
// lib/errors.ts
export class APIError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function handleError(error: any): string {
  if (error instanceof APIError) {
    switch (error.code) {
      case 'INVALID_SIGNATURE':
        return 'Order signature is invalid. Please try again.';
      case 'ORDER_EXPIRED':
        return 'Order has expired. Please create a new order.';
      case 'INSUFFICIENT_BALANCE':
        return 'Insufficient balance. Please deposit more collateral.';
      default:
        return error.message;
    }
  }

  if (error.code === 'NETWORK_ERROR') {
    return 'Network error. Please check your connection.';
  }

  return 'An unexpected error occurred.';
}

// Usage
try {
  await submitOrder(order);
} catch (error) {
  const message = handleError(error);
  toast.error(message); // Using toast library
}
```

---

## Testing

### Unit Tests

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom
```

```typescript
// TradeForm.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TradeForm from './TradeForm';

describe('TradeForm', () => {
  it('validates price input', () => {
    const { getByLabelText } = render(<TradeForm {...props} />);

    const priceInput = getByLabelText('Price');
    fireEvent.change(priceInput, { target: { value: '1.5' } });

    expect(screen.getByText('Price must be between 0 and 1')).toBeInTheDocument();
  });
});
```

---

## Performance Optimization

### Code Splitting

```typescript
// Lazy load components
import { lazy, Suspense } from 'react';

const TradeForm = lazy(() => import('./components/TradeForm'));
const OrderBook = lazy(() => import('./components/OrderBook'));

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TradeForm {...props} />
      <OrderBook {...props} />
    </Suspense>
  );
}
```

### Memoization

```typescript
import { memo, useMemo, useCallback } from 'react';

// Memoize expensive calculations
const OrderBook = memo(({ bids, asks }) => {
  const totalVolume = useMemo(() => {
    return bids.reduce((sum, bid) => sum + parseInt(bid.amount), 0);
  }, [bids]);

  return <div>Total Volume: {totalVolume}</div>;
});

// Memoize callbacks
const handleOrderSubmit = useCallback((order) => {
  submitOrder(order);
}, []);
```

---

## Deployment

### Build for Production

```bash
pnpm build
```

Outputs to `apps/web/dist/`.

### Environment Variables

Create `.env.production`:

```bash
VITE_API_URL=https://api.predictx.com
VITE_RPC_URL=https://rpc-testnet.socrateschain.org
VITE_CHAIN_ID=1111111
```

**Remove all demo private keys from production builds!**

### Hosting Options

**Option 1: Vercel**
```bash
pnpm add -g vercel
vercel --prod
```

**Option 2: Netlify**
```bash
pnpm add -g netlify-cli
netlify deploy --prod
```

**Option 3: Docker**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm add -g serve
CMD ["serve", "-s", "dist", "-l", "3000"]
```

---

## Future Enhancements

### High Priority

1. **Remove Demo Accounts**: Use MetaMask exclusively
2. **Add Loading States**: Skeleton screens, spinners
3. **Improve Error Handling**: Toast notifications, detailed messages
4. **Add WebSocket**: Real-time orderbook updates
5. **Responsive Design**: Mobile-friendly layout

### Medium Priority

6. **Advanced Trading UI**: TradingView charts, depth chart
7. **Position Management**: Detailed P&L, position history
8. **Trade History**: User's past orders and fills
9. **Market Analytics**: Volume charts, price history

### Low Priority

10. **Dark Mode**: Theme toggle
11. **Multi-language**: i18n support
12. **Notifications**: Browser notifications for fills/resolutions
13. **Portfolio Dashboard**: Overall portfolio performance

---

For backend API integration, see **BACKEND.md**.
For smart contract interaction, see **CONTRACTS.md**.
