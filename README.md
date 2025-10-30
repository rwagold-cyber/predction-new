# PredictX – CTF-Based Prediction Market (V2)

PredictX 是基于 **Conditional Token Framework (CTF)** 的短周期预测市场平台，结合链下撮合与链上结算，为 Socrates Testnet 提供实时的 BTC 涨跌市场。

---

## 🏗️ 架构总览

```
用户签名订单 (EIP-712)
        │
        ▼
API Server  ──▶  Matching Engine (内存订单簿)
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
                           用户自主赎回获胜仓位
```

- **On-chain**：CTF (ERC1155) 管理仓位、MarketRegistry 调用 Pyth Oracle 解析市场  
- **Off-chain**：Matcher 每秒撮合、Relayer 批量上链、MarketManager 自动发现与解析市场  
- **接口层**：REST API 提供下单、查询、市场信息等能力

---

## 📍 最新部署 (Socrates Testnet)

| 合约 | 地址 |
|------|------|
| MockUSDC | `0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce` |
| ConditionalTokensV2 | `0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665` |
| SettlementV2 | `0xc73967F29E6dB5b7b61a616d030a9180e8617464` |
| MarketRegistryV2 | `0xE108166156626bD94e5686847F7a29E044D2b73c` |
| PythOracleAdapter | `0xad3F4094cfA60d2503057e26EbeAf241AC7434E8` |
| Pyth Oracle (只读) | `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd` |
| BTC Feed Id | `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de` |

完整地址列表保存在 `chain/addresses.json`。

---

## 🚀 快速开始

### 1. 安装依赖
```bash
pnpm install        # 根目录
cd chain && pnpm compile   # 编译合约
```

### 2. 配置环境变量

*根目录 `.env`（用于 Hardhat / 脚本）*
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

*后端 `services/.env`（供 Runner 使用）*
```bash
RPC_URL=https://rpc-testnet.socrateschain.org
CHAIN_ID=1111111

RELAYER_PRIVATE_KEY=0x...         # 必填：提交填单交易
MARKET_MANAGER_PRIVATE_KEY=0x...  # 推荐：解析市场使用的运营私钥

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

### 3. 部署 & 初始化
```bash
cd chain
pnpm hardhat deploy --network soc_test       # 部署合约
npx hardhat run scripts/mintUSDC.ts --network soc_test   # 铸造测试 USDC
npx hardhat run scripts/createMarkets.ts --network soc_test   # 创建示例市场
```

### 4. 启动后端服务
```bash
cd services
pnpm install         # 首次运行需要
pnpm start           # 启动 API + Matcher + Relayer + MarketManager
```

启动日志应包含：
- `✅ Relayer started`
- `✅ Matching Engine started`
- `📡 启动 MarketCreated 事件监听...`

### 5. 访问 API / 前端
- REST API 默认监听 `http://localhost:8080`，端点详见 [`API_REFERENCE.md`](./API_REFERENCE.md)
- 前端（示例）：
  ```bash
  cd apps/web
  pnpm install
  pnpm dev
  ```

---

## 🧩 核心组件

### 智能合约
- **ConditionalTokensV2**：ERC1155 仓位代币，实现 split / merge / redeem
- **SettlementV2**：验签、托管抵押品、批量结算
- **MarketRegistryV2**：创建/解析市场，调用 Pyth Oracle
- **PythOracleAdapter**：整分钟历史价格查询封装

### 后端服务
- **API Server**：订单提交 & 市场/订单簿查询 (Express)
- **Matching Engine**：内存订单簿，价格-时间优先撮合，每秒执行
- **Relayer**：批量链上提交，带不可重试识别与回调
- **MarketManager**：监听 `MarketCreated` 事件、定期扫描，自动触发 `resolveMarket`
- **Runner**：统一启动/监控所有服务，30 秒输出诊断信息

---

## 📚 关键文档

- [`API_REFERENCE.md`](./API_REFERENCE.md)：合约调用 & REST API 速查表  
- [`services/PRODUCTION_READINESS_CHECKLIST.md`](./services/PRODUCTION_READINESS_CHECKLIST.md)：生产测试检查清单  
- [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)：详细部署流程  
- [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md)：项目概述与技术亮点  
- [`PROJECT_STATUS.md`](./PROJECT_STATUS.md)：里程碑完成情况  
- [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md)：后续规划

---

## 🛠️ 测试与运维

- **合约测试**：`pnpm hardhat test`（请根据需要补充单测）  
- **端到端脚本**：`chain/test/Backend.integration.test.ts` 展示完整生命周期  
- **健康检查**：`curl http://localhost:8080/health`  
- **日志监控**：服务每 30 秒输出撮合/Relayer/MarketManager 统计  
- **安全建议**：生产前请执行专业审计、启用监控告警、限制 API 访问

---

## ✨ 技术亮点

- **CTF 架构**：一次 `reportPayouts` 即可解决整个市场，扩展到百万用户  
- **链下撮合、链上结算**：兼顾性能与去信任性，订单签名采用 EIP-712  
- **自动化后端**：Relayer 僵尸订单防护、MarketManager 自动发现并解析市场  
- **Pyth 整分钟价格**：确保预测结果基于统一时间戳，支持历史价格检索  
- **文档齐全**：部署、API、生产测试 checklist 完整覆盖

---

## ✅ 生产测试清单 (节选)

1. `.env` / `services/.env` 配置真实合约地址与私钥  
2. Relayer 与 MarketManager 账户确保有足够测试网 ETH  
3. 启动 Runner，确认日志无报错并自动同步市场  
4. 提交买卖单、撮合结算、市场到期解析、用户赎回全流程验证  
5. 监控 `permanentlyFailedFills`、`marketDiscoveries` 等统计确保运行健康

详见 [`services/PRODUCTION_READINESS_CHECKLIST.md`](./services/PRODUCTION_READINESS_CHECKLIST.md)。

---

PredictX V2 已具备在 Socrates Testnet 进行生产演练的能力，欢迎接入更多市场与前端体验。如果发现问题或有新的需求，欢迎在项目文档中记录并继续推进。🚀
