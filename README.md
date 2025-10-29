# PredictX - BTC Prediction Market

基于 CTF (Conditional Token Framework) 的高性能去中心化预测市场平台。

## 架构概述

PredictX 采用 **链下订单簿 + 链上结算** 的混合架构：

- **链上**: CTF (ERC1155) 管理持仓，支持数百万用户
- **链下**: 价格-时间优先撮合引擎，高吞吐低延迟
- **中继**: 自动批量提交成交记录到区块链

```
用户签名订单(EIP-712) → Matcher撮合 → Relayer批量上链 → CTF铸造持仓 → 用户自行赎回
```

## 核心组件

### 智能合约 (`chain/contracts`)

- **ConditionalTokensV2**: ERC1155 条件代币框架，单次交易结算整个市场
- **SettlementV2**: 交易结算合约，验证签名并调用 CTF 铸造/转移持仓
- **MarketRegistryV2**: 市场管理合约，集成 Pyth Oracle 自动解决市场
- **PythOracleAdapter**: 整分钟对齐的历史价格查询接口

### 后端服务 (`services/`)

- **Matcher**: 完整的价格-时间优先撮合引擎（每 5 秒自动撮合）
- **Relayer**: 自动批量提交服务（Gas 优化、失败重试）
- **Runner**: 统一服务入口，协调 Matcher 和 Relayer 工作

## 快速开始

### 1. 安装依赖

```bash
# 从项目根目录
pnpm install

# 编译合约
cd chain
pnpm compile
```

### 2. 配置环境变量

#### 合约部署 (`chain/.env`)

```bash
PRIVATE_KEY=your_deployer_private_key
RPC_URL=https://rpc-testnet.socrateschain.org
BTC_ORACLE_ADDRESS=0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd
BTC_FEED_ID=0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de
```

#### 后端服务 (`services/.env`)

```bash
RPC_URL=https://rpc-testnet.socrateschain.org
RELAYER_PRIVATE_KEY=your_relayer_private_key
BATCH_SIZE=10
BATCH_DELAY_MS=2000
MAX_GAS_PRICE=100
MAX_RETRIES=3
```

### 3. 部署合约

```bash
cd chain

# 部署所有合约（CTF + Settlement + MarketRegistry + Oracle）
npx hardhat deploy --network soc_test

# 查看部署结果
cat addresses.json
```

生成的 `addresses.json`:
```json
{
  "chainId": "1111111",
  "ctf": "0x...",
  "settlementV2": "0x...",
  "marketRegistryV2": "0x...",
  "usdc": "0x...",
  "oracleAdapter": "0x..."
}
```

### 4. 初始化测试数据

```bash
# 铸造测试 USDC
npx hardhat run scripts/mintUSDC.ts --network soc_test

# 创建测试市场（3 个短期 BTC 预测市场）
npx hardhat run scripts/createMarkets.ts --network soc_test
```

### 5. 测试订单流程（可选）

```bash
# 完整端到端测试：签名 → 撮合 → 结算 → 验证持仓
npx hardhat run scripts/testOrderFlow.ts --network soc_test
```

这个脚本会：
- ✅ 铸造测试 USDC
- ✅ 存入抵押品到 Settlement
- ✅ 使用 EIP-712 签名订单
- ✅ 模拟撮合
- ✅ 提交到链上结算
- ✅ 验证 CTF 持仓已铸造

### 6. 启动后端服务

```bash
cd services

# 安装依赖
pnpm install

# 启动 Matcher + Relayer
pnpm start
```

服务启动后：
- Matcher 每 5 秒自动撮合所有市场
- Relayer 自动批量提交成交记录到链上
- 每 30 秒输出统计信息

### 7. 解决市场

等待市场到期后：

```bash
cd chain

# 解决市场（从 Oracle 获取价格并报告到 CTF）
npx hardhat run scripts/resolveMarket.ts --network soc_test -- <marketId>

# 用户可以调用 ctf.redeemPositions() 赎回奖金
```

## 关键特性

### 1. 无限扩展性（CTF）

- 使用 ERC1155 管理所有持仓
- 一次 `reportPayouts` 交易解决整个市场
- 用户自行赎回，无需迭代地址
- 支持数百万用户

### 2. 高性能撮合

- 内存订单簿，微秒级撮合
- 价格-时间优先算法
- 支持部分成交
- 多市场并行处理

### 3. 安全性

- EIP-712 签名防重放
- Nonce bitmap 高效取消
- 白名单抵押品
- ReentrancyGuard 重入保护

### 4. Gas 优化

- 批量提交减少交易数
- CTF 单次结算所有用户
- Gas 价格监控和重试
- 估算失败自动跳过

## 订单流程

### 创建和签名订单

```typescript
import { ethers } from "ethers";

// 1. 创建订单
const order = {
  maker: wallet.address,
  marketId: "1",
  conditionId: "0x...", // 从 market.conditionId 获取
  outcome: 1, // 1=UP, 0=DOWN
  collateral: usdcAddress,
  pricePips: "5500", // 55% in BPS (basis points, 0-10000)
  amount: "100000000", // 100 USDC (6 decimals)
  makerFeeBps: 30, // 0.3%
  takerFeeBps: 30,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  salt: ethers.hexlify(ethers.randomBytes(32)),
  nonce: 1,
  mintOnFill: true,
  allowedTaker: ethers.ZeroAddress,
};

// 2. EIP-712 签名
const domain = {
  name: "PredictXSettlementV2",
  version: "1",
  chainId: 1111111,
  verifyingContract: settlementAddress,
};

const types = { Order: [...] };
const signature = await wallet.signTypedData(domain, types, order);

// 3. 提交到 Matcher
await matchingEngine.addOrder(order, signature, "BUY");
```

### 撮合和结算

```
1. Matcher 每 5 秒运行 matchOrders()
2. 生成 Fill[] 结构
3. 发送到 Relayer
4. Relayer 批量调用 settlement.batchFill()
5. Settlement 验证签名并调用 CTF
6. CTF 铸造/转移持仓（ERC1155）
```

## 项目结构

```
predction-new/
├── chain/
│   ├── contracts/
│   │   ├── core/
│   │   │   ├── SettlementV2.sol         # 交易结算
│   │   │   └── MarketRegistryV2.sol     # 市场管理
│   │   ├── ctf/
│   │   │   └── ConditionalTokensV2.sol  # 条件代币
│   │   ├── oracle/
│   │   │   └── PythOracleAdapter.sol    # 价格预言机
│   ├── deploy/
│   │   └── 00_deploy_all.ts             # 部署脚本
│   └── scripts/
│       ├── createMarkets.ts
│       ├── resolveMarket.ts
│       └── testOrderFlow.ts
├── services/
│   ├── matcher/
│   │   └── src/
│   │       ├── matcher.ts               # 主引擎
│   │       ├── orderbook.ts             # 订单簿
│   │       └── signature.ts             # 签名验证
│   ├── relayer/
│   │   └── src/
│   │       └── relayer.ts               # 中继服务
│   └── runner.ts                        # 统一入口
└── ARCHITECTURE_V2.md                   # 详细架构文档
```

## 故障排查

### 问题: 合约部署失败

**可能原因**: 账户余额不足、RPC 连接失败

**解决方案**:
```bash
# 检查余额
npx hardhat run scripts/checkBalance.ts --network soc_test

# 重新部署
rm -rf deployments/soc_test
npx hardhat deploy --network soc_test
```

### 问题: 订单未撮合

**可能原因**: 价格不交叉、订单簿不同、订单过期

**解决方案**:
- 查看 Matcher 日志确认订单已添加
- 确认价格和 marketId/outcome 正确
- 验证订单未过期

### 问题: 成交记录未上链

**可能原因**: Relayer 未运行、Gas 价格过高、余额不足

**解决方案**:
```bash
# 检查进程
ps aux | grep runner

# 调整 Gas 限制
# 编辑 services/.env
MAX_GAS_PRICE=200

# 给 Relayer 账户充值
```

### 问题: 签名验证失败

**可能原因**: chainId 错误、合约地址错误、订单结构不匹配

**解决方案**:
```typescript
// 确认配置
console.log("ChainId:", await provider.getNetwork().chainId);
console.log("Settlement:", settlementAddress);

// 确保订单结构完全匹配 contracts/libs/Types.sol 中的 OrderV2
```

## 性能指标

- **撮合延迟**: < 5 秒（可配置）
- **批量大小**: 10 笔/批（可配置）
- **Gas 成本**: ~150k per fill (批量优化后)
- **扩展性**: 支持数百万用户（CTF）

## 与传统方案对比

| 特性 | 传统方案 | PredictX |
|------|---------|----------|
| 持仓管理 | 内部映射 | CTF (ERC1155) |
| 结算复杂度 | O(n) 迭代 | O(1) 报告 |
| 撮合位置 | 链上 | 链下 |
| 签名标准 | 无 | EIP-712 |
| 支持用户数 | 数百 | 数百万 |
| Gas 成本 | 高 | 优化 |

## 未来改进

### 短期（1-3 个月）
- [ ] 持久化订单存储（PostgreSQL/Redis）
- [ ] WebSocket 实时推送
- [ ] 前端更新支持 V2
- [ ] 完整测试套件

### 中期（3-6 个月）
- [ ] 高级订单类型（市价单、止损单）
- [ ] 流动性激励
- [ ] MEV 保护
- [ ] 多链部署

### 长期（6+ 个月）
- [ ] zkSNARK 隐私订单
- [ ] 跨链流动性
- [ ] DAO 治理
- [ ] 移动端应用

## 技术栈

- **智能合约**: Solidity 0.8.24, Hardhat, OpenZeppelin
- **后端**: TypeScript, ethers.js v6
- **CTF**: ERC1155 Multi-Token Standard
- **签名**: EIP-712 Typed Data
- **预言机**: Pyth Network
- **区块链**: Socrates Testnet (Chain ID: 1111111)

## 相关资源

- **详细架构**: [ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md)
- **CTF 规范**: [Gnosis CTF Docs](https://docs.gnosis.io/conditionaltokens/)
- **EIP-712**: [Ethereum Improvement Proposal](https://eips.ethereum.org/EIPS/eip-712)
- **Pyth Oracle**: [Pyth Network](https://pyth.network/)

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**注意**: 这是一个实验性项目。请勿在主网使用未经审计的智能合约。
