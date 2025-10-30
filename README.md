# PredictX - 基于 CTF 的预测市场平台

PredictX 是一个基于条件代币框架（Conditional Token Framework, CTF）构建的高性能预测市场平台。它结合链下订单撮合与链上结算，在 Socrates 测试网上提供实时的 BTC 价格预测市场。

## 架构总览

```
用户签名订单 (EIP-712)
        │
        ▼
API Server  ──▶  撮合引擎 (内存订单簿)
        │                     │
        │                     ▼
        └──────▶  中继器 ─────────────▶ SettlementV2.batchFill()
                                   │
                                   ▼
                        ConditionalTokensV2 (ERC1155)
                                   │
                      MarketRegistryV2 + Pyth 预言机
                                   │
                                   ▼
                           用户赎回获胜仓位
```

**链上**: CTF (ERC1155) 管理仓位，MarketRegistry 通过 Pyth 预言机解析市场
**链下**: 撮合器每秒执行撮合，中继器批量提交链上交易，市场管理器自动发现并解析市场
**接口层**: REST API 提供订单提交、查询、市场信息等功能

---

## 部署信息 (Socrates 测试网)

| 合约 | 地址 |
|------|------|
| MockUSDC | `0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce` |
| ConditionalTokensV2 | `0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665` |
| SettlementV2 | `0xc73967F29E6dB5b7b61a616d030a9180e8617464` |
| MarketRegistryV2 | `0xE108166156626bD94e5686847F7a29E044D2b73c` |
| PythOracleAdapter | `0xad3F4094cfA60d2503057e26EbeAf241AC7434E8` |
| Pyth Oracle (只读) | `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd` |
| BTC Feed ID | `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de` |

完整地址保存在 `chain/addresses.json`。

---

## 快速开始

### 1. 安装依赖
```bash
pnpm install          # 根目录
cd chain && pnpm compile   # 编译合约
```

### 2. 配置环境变量

**根目录 `.env` (用于 Hardhat/脚本)**
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

**后端 `services/.env` (供 Runner 使用)**
```bash
RPC_URL=https://rpc-testnet.socrateschain.org
CHAIN_ID=1111111

RELAYER_PRIVATE_KEY=0x...         # 必填：提交填单交易
MARKET_MANAGER_PRIVATE_KEY=0x...  # 推荐：解析市场使用

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

### 3. 部署与初始化
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
pnpm start           # 启动 API + 撮合器 + 中继器 + 市场管理器
```

启动日志应包含：
- `✅ Relayer started`
- `✅ Matching Engine started`
- `📡 启动 MarketCreated 事件监听...`

### 5. 访问 API / 前端
- REST API 默认监听 `http://localhost:8080`，端点详见 `BACKEND.md`
- 前端（示例）：
  ```bash
  cd apps/web
  pnpm install
  pnpm dev
  ```

---

## 核心组件

### 智能合约
- **ConditionalTokensV2**: ERC1155 仓位代币，实现 split/merge/redeem
- **SettlementV2**: 签名验证、抵押品托管、批量结算
- **MarketRegistryV2**: 创建/解析市场，调用 Pyth 预言机
- **PythOracleAdapter**: 整分钟历史价格查询封装

### 后端服务
- **API Server**: 订单提交 & 市场/订单簿查询 (Express)
- **撮合引擎**: 内存订单簿，价格-时间优先撮合，每秒执行
- **中继器**: 批量链上提交，带不可重试错误识别与回调
- **市场管理器**: 监听 `MarketCreated` 事件、定期扫描，自动触发 `resolveMarket`
- **Runner**: 统一启动/监控所有服务，每 30 秒输出诊断信息

---

## 文档

- **CONTRACTS.md**: 智能合约架构、接口和机制
- **BACKEND.md**: 后端服务、API 参考和部署
- **FRONTEND.md**: 前端架构、组件和集成指南

---

## 测试与运维

- **合约测试**: `pnpm hardhat test` (根据需要补充单测)
- **端到端脚本**: `chain/test/Backend.integration.test.ts` 展示完整生命周期
- **健康检查**: `curl http://localhost:8080/health`
- **日志监控**: 服务每 30 秒输出撮合器/中继器/市场管理器统计
- **安全建议**: 生产前请执行专业审计、启用监控告警、限制 API 访问

---

## 技术亮点

- **CTF 架构**: 一次 `reportPayouts` 即可解决整个市场，扩展到百万用户
- **链下撮合、链上结算**: 兼顾性能与去信任性，订单签名采用 EIP-712
- **自动化后端**: 中继器僵尸订单防护、市场管理器自动发现并解析市场
- **Pyth 整分钟价格**: 确保预测结果基于统一时间戳，支持历史价格检索
- **文档齐全**: 部署、API、生产测试 checklist 完整覆盖

---

## 当前状态

### 完成度总览: 70%

```
智能合约层    ████████████████░░░░  80% (核心完成，待优化)
后端服务层    ███████████████░░░░░  75% (核心服务完成，待持久化/推送)
前端界面层    ████████░░░░░░░░░░░░  40% (基本可用，功能简陋)
测试覆盖      ████░░░░░░░░░░░░░░░░  20% (手动测试，缺自动化)
文档完善度    ████████████████████ 100% (完整)
生产就绪度    ██████████░░░░░░░░░░  55% (测试网生产演练阶段)
```

### 已完成功能

#### 智能合约 (V2 架构)
- ✅ ConditionalTokensV2: ERC1155、prepareCondition、reportPayouts、split/merge/redeem
- ✅ SettlementV2: EIP-712 验证、batchFill、nonce bitmap、抵押品托管
- ✅ MarketRegistryV2: createMarket、resolveMarket、CTF 集成、预言机价格获取
- ✅ PythOracleAdapter: 整分钟价格获取、历史价格查询

#### 后端服务 (V2 架构)
- ✅ API Server: REST 端点、CORS 支持、错误处理
- ✅ 撮合引擎: 价格-时间优先订单簿、自动撮合（1秒周期）、EIP-712 验证
- ✅ 中继器: 批量提交（10笔/批）、gas 监控、自动重试（3次）
- ✅ 市场管理器: 事件监听、定期扫描、自动解析
- ✅ Runner: 统一服务启动、统计输出（30秒）

#### 前端应用
- ✅ Web App: 钱包连接（MetaMask）、网络检测、市场列表、订单簿展示、简单交易界面

### 关键缺失功能

#### 高优先级（阻碍生产）
- ❌ 数据持久化：订单存储在内存中，服务重启后丢失
- ❌ 测试覆盖：无单元/集成测试，仅手动测试
- ❌ 安全审计：合约未经审计，不适合主网部署
- ❌ 授权升级：使用 ERC20 approve()，应集成 Permit2

#### 中优先级（用户体验提升）
- ⚠️ 实时通信：HTTP 轮询，应使用 WebSocket
- ⚠️ 错误处理：基础错误处理，需要统一错误码系统
- ⚠️ 撮合引擎：简化算法，不支持复杂订单类型
- ⚠️ 前端功能：功能有限，缺少图表、交易历史

---

## 未来路线图

### 第一阶段：生产就绪 (1-2 个月) 🔴

**目标**: 安全上线主网

1. **第 1-2 周：数据持久化**
   - PostgreSQL 数据库集成
   - Redis 缓存层
   - 订单历史查询 API

2. **第 3-4 周：Permit2 集成**
   - Permit2 合约集成
   - Settlement 合约适配
   - 前端签名流程更新

3. **第 5-6 周：测试覆盖**
   - 智能合约单元测试 (> 80%)
   - 后端服务测试 (> 70%)
   - 端到端测试

4. **第 7-8 周：安全审计准备**
   - 代码审查和修复
   - Slither 静态分析
   - 提交审计申请

### 第二阶段：用户体验提升 (2-3 个月) 🟡

**目标**: 提升用户体验和功能完整性

1. **WebSocket 实时推送**
   - WebSocket 服务器
   - 订单簿实时更新
   - 前端 WebSocket 集成

2. **前端功能增强**
   - TradingView 图表集成
   - 持仓管理页面
   - 交易历史页面
   - 个人中心

3. **错误处理增强**
   - 统一错误码系统
   - 详细错误信息
   - 日志聚合系统

4. **撮合引擎优化**
   - 市价单支持
   - 止损/止盈单
   - 性能优化

### 第三阶段：规模化运营 (3-6 个月) 🟢

**目标**: 支持大规模用户和扩展功能

1. **监控和告警**
   - Prometheus + Grafana
   - 自定义监控面板
   - 告警系统

2. **Gas 优化和激励**
   - 订单净额化
   - 跨市场批量结算
   - 流动性激励计划

3. **多链部署**
   - Arbitrum 部署
   - Optimism 部署
   - 跨链流动性

4. **高级功能**
   - 移动端 App
   - 更多市场类型
   - API SDK 发布

### 第四阶段：去中心化 (6+ 个月) 🔵

**目标**: 项目去中心化和社区治理

- 治理代币
- DAO 治理系统
- 隐私保护（订单加密、zkSNARK）
- 生态建设

---

## 已知问题和风险

### 技术风险

1. **订单丢失风险** 🔴
   - 问题：内存存储，服务重启后丢失
   - 影响：用户损失
   - 缓解：尽快集成数据库

2. **合约漏洞风险** 🔴
   - 问题：未经审计
   - 影响：资金安全
   - 缓解：主网前必须审计

3. **性能瓶颈风险** 🟡
   - 问题：单节点，无水平扩展
   - 影响：无法支撑大量用户
   - 缓解：架构升级

4. **预言机故障风险** 🟡
   - 问题：单一预言机依赖
   - 影响：市场无法解决
   - 缓解：多预言机聚合

### 业务风险

1. **流动性不足** 🟡
   - 问题：初期可能无做市商
   - 影响：订单无法成交
   - 缓解：流动性激励计划

2. **监管风险** 🟢
   - 问题：预测市场可能受监管
   - 影响：部分地区无法使用
   - 缓解：合规咨询

---

## 生产就绪检查清单

1. 配置 `.env` 和 `services/.env`，填入真实合约地址和私钥
2. 确保中继器和市场管理器账户有足够的测试网 ETH
3. 启动 Runner，确认日志无报错并自动同步市场
4. 验证完整工作流：提交买卖单 → 撮合结算 → 市场到期解析 → 用户赎回
5. 监控 `permanentlyFailedFills`、`marketDiscoveries` 等统计确保运行健康

---

**项目当前状态**: ✅ MVP 完成，进入生产就绪阶段
**下一里程碑**: 数据持久化 + Permit2 集成 + 测试覆盖
**预计主网上线**: 安全审计完成后 2-3 个月

PredictX V2 已具备在 Socrates 测试网进行生产演练的能力。欢迎接入更多市场与前端体验。如果发现问题或有新的需求，欢迎在项目文档中记录并继续推进。🚀
