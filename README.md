# PredictX - CTF-Based Prediction Market Platform

PredictX is a high-performance prediction market platform built on the Conditional Token Framework (CTF). It combines off-chain order matching with on-chain settlement to provide real-time BTC price prediction markets on Socrates Testnet.

## Architecture Overview

```
User Signs Orders (EIP-712)
        │
        ▼
API Server  ──▶  Matching Engine (In-Memory Orderbook)
        │                     │
        │                     ▼
        └──────▶  Relayer ─────────────▶ SettlementV2.batchFill()
                                   │
                                   ▼
                        ConditionalTokensV2 (ERC1155)
                                   │
                      MarketRegistryV2 + Pyth Oracle
                                   │
                                   ▼
                           Users Redeem Winning Positions
```

**On-chain**: CTF (ERC1155) manages positions, MarketRegistry resolves markets via Pyth Oracle
**Off-chain**: Matcher executes matching every second, Relayer batches on-chain submissions, MarketManager auto-discovers and resolves markets
**Interface**: REST API provides order submission, queries, market information

---

## Deployment (Socrates Testnet)

| Contract | Address |
|----------|---------|
| MockUSDC | `0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce` |
| ConditionalTokensV2 | `0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665` |
| SettlementV2 | `0xc73967F29E6dB5b7b61a616d030a9180e8617464` |
| MarketRegistryV2 | `0xE108166156626bD94e5686847F7a29E044D2b73c` |
| PythOracleAdapter | `0xad3F4094cfA60d2503057e26EbeAf241AC7434E8` |
| Pyth Oracle (read-only) | `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd` |
| BTC Feed ID | `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de` |

Complete addresses stored in `chain/addresses.json`.

---

## Quick Start

### 1. Install Dependencies
```bash
pnpm install          # Root directory
cd chain && pnpm compile   # Compile contracts
```

### 2. Configure Environment Variables

**Root `.env` (for Hardhat/scripts)**
```bash
CHAIN_ID=1111111
RPC_URL=https://rpc-testnet.socrateschain.org

USDC_ADDRESS=0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce
CTF_ADDRESS=0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665
SETTLEMENT_ADDRESS=0xc73967F29E6dB5b7b61a616d030a9180e8617464
MARKET_REGISTRY_ADDRESS=0xE108166156626bD94e5686847F7a29E044D2b73c
BTC_ORACLE_ADDRESS=0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd
BTC_FEED_ID=0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de
```

**Backend `services/.env` (for Runner)**
```bash
RPC_URL=https://rpc-testnet.socrateschain.org
CHAIN_ID=1111111

RELAYER_PRIVATE_KEY=0x...         # Required: Submit fill transactions
MARKET_MANAGER_PRIVATE_KEY=0x...  # Recommended: Resolve markets

USDC_ADDRESS=0x0CE3...
CTF_ADDRESS=0xBaA6...
SETTLEMENT_ADDRESS=0xc739...
MARKET_REGISTRY_ADDRESS=0xE108...
ORACLE_ADAPTER_ADDRESS=0xad3F...

BATCH_SIZE=10
BATCH_DELAY_MS=2000
MAX_GAS_PRICE=100
MAX_RETRIES=3
API_PORT=8080
```

### 3. Deploy & Initialize
```bash
cd chain
pnpm hardhat deploy --network soc_test       # Deploy contracts
npx hardhat run scripts/mintUSDC.ts --network soc_test   # Mint test USDC
npx hardhat run scripts/createMarkets.ts --network soc_test   # Create sample markets
```

### 4. Start Backend Services
```bash
cd services
pnpm install         # First time only
pnpm start           # Start API + Matcher + Relayer + MarketManager
```

Startup logs should include:
- `✅ Relayer started`
- `✅ Matching Engine started`
- `📡 启动 MarketCreated 事件监听...`

### 5. Access API / Frontend
- REST API listens on `http://localhost:8080`, see `BACKEND.md` for endpoints
- Frontend (example):
  ```bash
  cd apps/web
  pnpm install
  pnpm dev
  ```

---

## Core Components

### Smart Contracts
- **ConditionalTokensV2**: ERC1155 position tokens, implements split/merge/redeem
- **SettlementV2**: Signature verification, collateral custody, batch settlement
- **MarketRegistryV2**: Create/resolve markets, calls Pyth Oracle
- **PythOracleAdapter**: Minute-aligned historical price query wrapper

### Backend Services
- **API Server**: Order submission & market/orderbook queries (Express)
- **Matching Engine**: In-memory orderbook, price-time priority matching, executes every second
- **Relayer**: Batch on-chain submission with non-retryable error detection and callbacks
- **MarketManager**: Listens to `MarketCreated` events, periodic scanning, auto-triggers `resolveMarket`
- **Runner**: Unified startup/monitoring for all services, outputs diagnostics every 30 seconds

---

## Documentation

- **CONTRACTS.md**: Smart contract architecture, interfaces, and mechanics
- **BACKEND.md**: Backend services, API reference, and deployment
- **FRONTEND.md**: Frontend architecture, components, and integration guide

---

## Testing & Operations

- **Contract Tests**: `pnpm hardhat test` (expand unit tests as needed)
- **End-to-End Scripts**: `chain/test/Backend.integration.test.ts` demonstrates complete lifecycle
- **Health Check**: `curl http://localhost:8080/health`
- **Log Monitoring**: Services output Matcher/Relayer/MarketManager stats every 30 seconds
- **Security Recommendations**: Professional audit before production, enable monitoring alerts, restrict API access

---

## Technical Highlights

- **CTF Architecture**: Single `reportPayouts` resolves entire market, scales to millions of users
- **Off-chain Matching, On-chain Settlement**: Balances performance with trustlessness, order signing uses EIP-712
- **Automated Backend**: Relayer zombie order protection, MarketManager auto-discovery and resolution
- **Pyth Minute-Aligned Prices**: Ensures prediction results based on unified timestamps, supports historical price retrieval
- **Complete Documentation**: Deployment, API, production testing checklist fully covered

---

## Current Status

### Completion Overview: 70%

```
Smart Contract Layer    ████████████████░░░░  80% (Core complete, optimization needed)
Backend Service Layer   ███████████████░░░░░  75% (Core services done, need persistence/push)
Frontend Interface      ████████░░░░░░░░░░░░  40% (Basic functional, features limited)
Test Coverage          ████░░░░░░░░░░░░░░░░  20% (Manual tests, lacks automation)
Documentation          ████████████████████ 100% (Complete)
Production Readiness   ██████████░░░░░░░░░░  55% (Testnet production rehearsal stage)
```

### Completed Features

#### Smart Contracts (V2 Architecture)
- ✅ ConditionalTokensV2: ERC1155, prepareCondition, reportPayouts, split/merge/redeem
- ✅ SettlementV2: EIP-712 verification, batchFill, nonce bitmap, collateral custody
- ✅ MarketRegistryV2: createMarket, resolveMarket, CTF integration, Oracle price fetch
- ✅ PythOracleAdapter: Minute-aligned price retrieval, historical price queries

#### Backend Services (V2 Architecture)
- ✅ API Server: REST endpoints, CORS support, error handling
- ✅ Matching Engine: Price-time priority orderbook, auto-matching (1s cycle), EIP-712 verification
- ✅ Relayer: Batch submission (10/batch), gas monitoring, auto-retry (3x)
- ✅ MarketManager: Event listening, periodic scanning, auto-resolution
- ✅ Runner: Unified service startup, stats output (30s)

#### Frontend Application
- ✅ Web App: Wallet connection (MetaMask), network detection, market list, orderbook display, simple trading interface

### Key Missing Features

#### High Priority (Blocking Production)
- ❌ Data Persistence: Orders stored in memory, lost on service restart
- ❌ Test Coverage: No unit/integration tests, manual testing only
- ❌ Security Audit: Unaudited contracts, not suitable for mainnet deployment
- ❌ Authorization Upgrade: Using ERC20 approve(), should integrate Permit2

#### Medium Priority (UX Enhancement)
- ⚠️ Real-time Communication: HTTP polling, should use WebSocket
- ⚠️ Error Handling: Basic error handling, needs unified error code system
- ⚠️ Matching Engine: Simplified algorithm, doesn't support complex order types
- ⚠️ Frontend Features: Limited functionality, lacks charts, trade history

---

## Future Roadmap

### Phase 1: Production Ready (1-2 months) 🔴

**Goal**: Safe mainnet deployment

1. **Week 1-2: Data Persistence**
   - PostgreSQL database integration
   - Redis cache layer
   - Order history query API

2. **Week 3-4: Permit2 Integration**
   - Permit2 contract integration
   - Settlement contract adaptation
   - Frontend signature flow update

3. **Week 5-6: Test Coverage**
   - Smart contract unit tests (> 80%)
   - Backend service tests (> 70%)
   - End-to-end tests

4. **Week 7-8: Security Audit Prep**
   - Code review and fixes
   - Slither static analysis
   - Submit audit application

### Phase 2: UX Enhancement (2-3 months) 🟡

**Goal**: Improve user experience and feature completeness

1. **WebSocket Real-time Push**
   - WebSocket server
   - Orderbook real-time updates
   - Frontend WebSocket integration

2. **Frontend Feature Enhancement**
   - TradingView chart integration
   - Position management page
   - Trade history page
   - User center

3. **Error Handling Enhancement**
   - Unified error code system
   - Detailed error information
   - Log aggregation system

4. **Matching Engine Optimization**
   - Market order support
   - Stop loss/take profit orders
   - Performance optimization

### Phase 3: Scale Operations (3-6 months) 🟢

**Goal**: Support large-scale users and extended features

1. **Monitoring and Alerting**
   - Prometheus + Grafana
   - Custom monitoring dashboards
   - Alert system

2. **Gas Optimization and Incentives**
   - Order netting
   - Cross-market batch settlement
   - Liquidity incentive program

3. **Multi-chain Deployment**
   - Arbitrum deployment
   - Optimism deployment
   - Cross-chain liquidity

4. **Advanced Features**
   - Mobile app
   - More market types
   - API SDK release

### Phase 4: Decentralization (6+ months) 🔵

**Goal**: Project decentralization and community governance

- Governance token
- DAO governance system
- Privacy protection (order encryption, zkSNARK)
- Ecosystem development

---

## Known Issues and Risks

### Technical Risks

1. **Order Loss Risk** 🔴
   - Issue: In-memory storage, lost on service restart
   - Impact: User losses
   - Mitigation: Integrate database ASAP

2. **Contract Vulnerability Risk** 🔴
   - Issue: Unaudited
   - Impact: Fund security
   - Mitigation: Must audit before mainnet

3. **Performance Bottleneck Risk** 🟡
   - Issue: Single node, no horizontal scaling
   - Impact: Cannot support large user base
   - Mitigation: Architecture upgrade

4. **Oracle Failure Risk** 🟡
   - Issue: Single Oracle dependency
   - Impact: Markets cannot resolve
   - Mitigation: Multi-Oracle aggregation

### Business Risks

1. **Insufficient Liquidity** 🟡
   - Issue: May lack market makers initially
   - Impact: Orders cannot match
   - Mitigation: Liquidity incentive program

2. **Regulatory Risk** 🟢
   - Issue: Prediction markets may be regulated
   - Impact: Unavailable in some regions
   - Mitigation: Compliance consultation

---

## Production Readiness Checklist

1. Configure `.env` and `services/.env` with real contract addresses and private keys
2. Ensure Relayer and MarketManager accounts have sufficient testnet ETH
3. Start Runner, confirm logs show no errors and auto-sync markets
4. Verify full workflow: submit buy/sell orders → matching settlement → market expiry resolution → user redemption
5. Monitor `permanentlyFailedFills`, `marketDiscoveries` stats to ensure healthy operation

---

**Project Current Status**: ✅ MVP complete, entering production readiness stage
**Next Milestone**: Data persistence + Permit2 integration + test coverage
**Expected Mainnet Launch**: 2-3 months after security audit completion

PredictX V2 is ready for production rehearsal on Socrates Testnet. Welcome to integrate more markets and frontend experiences. If you find issues or have new requirements, please document them and continue development. 🚀
