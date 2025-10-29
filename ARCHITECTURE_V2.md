# PredictX V2 Architecture

## 概述 / Overview

PredictX V2 是一个基于 CTF (Conditional Token Framework) 的高性能预测市场平台。采用链下订单簿 + 链上结算的混合架构，实现了高吞吐量和低延迟的交易体验。

PredictX V2 is a high-performance prediction market platform based on CTF (Conditional Token Framework). It uses a hybrid architecture of off-chain order book + on-chain settlement to achieve high throughput and low-latency trading.

## 核心架构 / Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│                   (React + ethers.js)                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ├─────────── User Sign Orders (EIP-712)
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                      Backend Services                        │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │   Matcher    │────────▶│         Relayer              │  │
│  │  (OrderBook) │  Fills  │   (Batch Submission)         │  │
│  └──────────────┘         └──────────────┬───────────────┘  │
└────────────────────────────────────────────┼──────────────────┘
                                             │
                                             │ batchFill()
                                             │
┌────────────────────────────────────────────▼──────────────────┐
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

## 关键改进 / Key Improvements

### 1. CTF 集成 / CTF Integration

**V1 问题 / V1 Problem:**
- 内部追踪所有用户持仓
- 无法扩展到数千用户（Gas 爆炸）
- 结算时需要迭代所有地址

**V2 解决方案 / V2 Solution:**
- 使用 CTF (ERC1155) 管理持仓
- 一次交易解决整个市场（`reportPayouts`）
- 用户自行赎回奖金（无需迭代）
- 支持数百万用户

### 2. 真实撮合引擎 / Real Matching Engine

**V1 问题 / V1 Problem:**
- 订单仅存储在内存中
- 没有实际撮合逻辑
- 订单永远不会执行

**V2 解决方案 / V2 Solution:**
- 完整的价格-时间优先撮合引擎
- 支持部分成交
- EIP-712 签名验证
- 持久化订单簿

### 3. 自动中继服务 / Automated Relayer

**V1 问题 / V1 Problem:**
- 没有 Relayer
- 订单无法上链

**V2 解决方案 / V2 Solution:**
- 自动批量提交成交记录
- Gas 价格监控
- 失败重试机制
- 统计和监控

## 合约架构 / Contract Architecture

### ConditionalTokensV2 (CTF)

```solidity
// 核心功能 / Core Functions
prepareCondition(questionId, outcomeSlotCount)  // 准备条件
splitPosition(collateral, conditionId, amount)   // 分割持仓
mergePositions(collateral, conditionId, amount)  // 合并持仓
reportPayouts(questionId, payouts[])             // 报告结果
redeemPositions(collateral, conditionId)         // 赎回奖金
```

**职责 / Responsibilities:**
- 管理所有条件代币（ERC1155）
- 处理持仓分割和合并
- 存储支付向量
- 处理奖金赎回

### SettlementV2

```solidity
// 核心功能 / Core Functions
depositCollateral(collateral, amount)            // 存入抵押品
withdrawCollateral(collateral, amount)           // 取出抵押品
fill(order, signature, fillAmount, taker)        // 单笔成交
batchFill(fills[])                               // 批量成交
```

**职责 / Responsibilities:**
- 验证订单签名（EIP-712）
- 管理抵押品托管
- 执行交易逻辑
- 与 CTF 交互铸造/转移代币
- 收取交易手续费

### MarketRegistryV2

```solidity
// 核心功能 / Core Functions
createMarket(
    address collateral,      // 抵押品代币地址 (e.g., USDC)
    address oracle,          // 预言机地址
    uint256 startTime,       // 市场开始时间
    MarketKind kind,         // 市场类型 (BTC_UPDOWN=0, ETH_UPDOWN=1)
    uint8 timeframe          // 时间框架 (1/3/5 分钟)
)
resolveMarket(marketId)      // 解决市场（获取价格并报告结果）
getMarket(marketId)          // 查询市场信息
```

**职责 / Responsibilities:**
- 创建预测市场（BTC/ETH UP/DOWN 1/3/5分钟）
- 在 CTF 中准备条件（prepareCondition）
- 市场到期时从预言机获取价格
- 报告支付向量到 CTF（reportPayouts）
- 管理市场状态和元数据

**注意 / Notes:**
- 市场不存储 name/description（节省 gas）
- 使用 kind + timeframe 确定市场类型
- endTime = startTime + timeframe * 60
- 结果由价格涨跌决定（不再使用 targetPrice）

### PythOracleAdapter

```solidity
// 核心功能 / Core Functions
getPriceAt(timestamp)                            // 获取历史价格
```

**职责 / Responsibilities:**
- 适配 Pyth Oracle 接口
- 提供分钟对齐的历史价格
- 防止频繁查询（冷却期）

## 后端服务 / Backend Services

### Matcher (撮合引擎)

**功能 / Features:**
- 价格-时间优先撮合算法
- 支持部分成交
- EIP-712 签名验证
- 多市场订单簿管理

**流程 / Flow:**
1. 接收签名订单
2. 验证签名和基本参数
3. 添加到相应订单簿
4. 每 5 秒运行撮合
5. 生成 Fill 结构
6. 发送到 Relayer

**关键文件 / Key Files:**
- `services/matcher/src/orderbook.ts` - 订单簿实现
- `services/matcher/src/signature.ts` - EIP-712 验证
- `services/matcher/src/matcher.ts` - 主引擎

### Relayer (中继服务)

**功能 / Features:**
- 批量提交优化
- Gas 价格监控
- 自动重试机制
- 统计和监控

**流程 / Flow:**
1. 从 Matcher 接收 Fills
2. 加入待处理队列
3. 达到批次大小或超时触发提交
4. 检查 Gas 价格
5. 估算 Gas 用量
6. 调用 `batchFill()` 上链
7. 失败时重试

**配置 / Configuration:**
```env
BATCH_SIZE=10           # 每批最多 10 笔成交
BATCH_DELAY_MS=2000     # 最多等待 2 秒
MAX_GAS_PRICE=100       # 最高 100 gwei
MAX_RETRIES=3           # 最多重试 3 次
```

**关键文件 / Key Files:**
- `services/relayer/src/relayer.ts` - 主服务

## 订单流程 / Order Flow

### 1. 用户创建订单 / User Creates Order

```typescript
const order = {
  maker: "0x...",
  marketId: "1",
  conditionId: "0x...",
  outcome: 1,              // 1=UP, 0=DOWN
  collateral: usdcAddress,
  pricePips: "5500",       // 55% in BPS (basis points, 0-10000)
  amount: "100000000",     // 100 USDC (6 decimals)
  makerFeeBps: 30,         // 0.3%
  takerFeeBps: 30,         // 0.3%
  expiry: 1234567890,      // Unix timestamp
  salt: "0x...",
  nonce: 1,
  mintOnFill: true,        // Mint new positions via CTF
  allowedTaker: ZERO_ADDRESS,
};
```

### 2. 签名订单 / Sign Order (EIP-712)

```typescript
const domain = {
  name: "PredictXSettlementV2",
  version: "1",
  chainId: 1111111,
  verifyingContract: settlementAddress,
};

const signature = await signer.signTypedData(domain, types, order);
```

### 3. 提交到 Matcher / Submit to Matcher

```typescript
// 通过 API 或直接调用
await matchingEngine.addOrder(order, signature, "BUY");
```

### 4. 撮合 / Matching

```typescript
// Matcher 每 5 秒运行
const matches = matchingEngine.matchAll();

// 转换为 Fills
const fills = matchingEngine.matchesToFills(matches);

// 发送到 Relayer
await relayer.submitFills(fills);
```

### 5. 上链结算 / On-Chain Settlement

```typescript
// Relayer 批量提交
await settlement.batchFill(fills);

// SettlementV2 执行:
// 1. 验证签名
// 2. 检查余额
// 3. 如果 mintOnFill=true:
//    - 调用 CTF.splitPosition()
//    - 转移结果代币到双方
// 4. 否则:
//    - 直接转移现有持仓
// 5. 收取手续费
```

### 6. 市场结算 / Market Resolution

```typescript
// 管理员或定时任务
await marketRegistry.resolveMarket(marketId);

// MarketRegistryV2 执行:
// 1. 检查市场已过期
// 2. 从 Oracle 获取价格
// 3. 确定胜出结果
// 4. 调用 CTF.reportPayouts([winnerPayout, loserPayout])
// 5. 标记市场已解决
```

### 7. 用户赎回 / User Redemption

```typescript
// 用户自行赎回奖金
await ctf.redeemPositions(
  collateral,
  conditionId,
  indexSets  // [1] for YES or [2] for NO
);

// CTF 执行:
// 1. 检查条件已解决
// 2. 计算赎回金额
// 3. 销毁代币
// 4. 转移抵押品给用户
```

## 部署流程 / Deployment Process

### 1. 编译合约 / Compile Contracts

```bash
cd chain
pnpm install
pnpm compile
```

### 2. 配置环境 / Configure Environment

```bash
# chain/.env
PRIVATE_KEY=your_private_key
RPC_URL=https://rpc-testnet.socrateschain.org
BTC_ORACLE_ADDRESS=0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd
BTC_FEED_ID=0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de
```

### 3. 部署合约 / Deploy Contracts

```bash
# 部署 V2 架构
pnpm deploy --network soc_test --tags v2

# 生成 addresses.json:
# {
#   "chainId": "1111111",
#   "usdc": "0x...",
#   "ctf": "0x...",
#   "settlementV2": "0x...",
#   "marketRegistryV2": "0x...",
#   "oracleAdapter": "0x..."
# }
```

### 4. 创建测试市场 / Create Test Markets

```bash
pnpm run script scripts/createMarkets.ts --network soc_test

# 生成 test-markets.json:
# [
#   {
#     "id": "1",
#     "conditionId": "0x...",
#     "description": "BTC UP/DOWN 1min",
#     "startTime": 1234567890,
#     "endTime": 1234567950,
#     "timeframe": 1
#   }
# ]
```

### 5. 启动后端服务 / Start Backend Services

```bash
cd services

# 配置环境
cp .env.example .env
# 编辑 .env 设置 RELAYER_PRIVATE_KEY

# 安装依赖
pnpm install

# 启动服务 (Matcher + Relayer)
pnpm start
```

### 6. 测试订单流程 / Test Order Flow

```bash
cd chain
pnpm run script scripts/testOrderFlow.ts --network soc_test

# 测试流程:
# 1. ✅ 铸造测试 USDC
# 2. ✅ 存入抵押品
# 3. ✅ 签名订单 (EIP-712)
# 4. ✅ 撮合订单
# 5. ✅ 上链结算
# 6. ✅ 验证 CTF 持仓
```

## 性能优化 / Performance Optimizations

### 1. Gas 优化 / Gas Optimization

- **批量处理**: `batchFill()` 一次处理多笔成交
- **CTF 扩展**: ERC1155 一次转移多种代币
- **Bitmap Nonce**: 高效的订单取消
- **延迟结算**: 用户自行赎回，不迭代地址

### 2. 吞吐量优化 / Throughput Optimization

- **链下撮合**: 高频撮合不消耗 Gas
- **批量提交**: 减少链上交易数量
- **异步处理**: Matcher 和 Relayer 独立运行
- **并行处理**: 多市场同时撮合

### 3. 延迟优化 / Latency Optimization

- **内存订单簿**: 微秒级撮合
- **批次延迟**: 2 秒快速提交
- **Gas 预估**: 避免失败交易
- **重试机制**: 自动恢复失败

## 安全特性 / Security Features

### 1. 订单验证 / Order Validation

- **EIP-712 签名**: 防止重放攻击
- **Nonce 管理**: 防止重复执行
- **过期时间**: 自动过期保护
- **允许的接受者**: 可选的白名单

### 2. 抵押品安全 / Collateral Security

- **白名单机制**: 仅支持已批准的代币
- **托管模式**: Settlement 持有抵押品
- **余额检查**: 执行前验证余额
- **重入保护**: ReentrancyGuard

### 3. 市场安全 / Market Security

- **权限控制**: Ownable + 角色管理
- **预言机验证**: 冷却期防止操纵
- **时间锁**: 市场创建后不可修改
- **分段结算**: CTF 确保奖金正确

## 监控和统计 / Monitoring & Statistics

### Matcher 统计 / Matcher Stats

```typescript
{
  totalOrders: 150,
  totalBooks: 6,
  activeBooks: 4,
  books: [
    { market: "1-1", orders: 45 },
    { market: "2-1", orders: 38 },
    ...
  ]
}
```

### Relayer 统计 / Relayer Stats

```typescript
{
  totalSubmissions: 25,
  totalFills: 180,
  pendingFills: 8,
  failedSubmissions: 2,
  averageGasPerSubmission: 850000n,
  averageFillsPerBatch: 7.2
}
```

## 故障排查 / Troubleshooting

### 问题: 订单未撮合 / Orders Not Matching

**可能原因 / Possible Causes:**
1. 价格不交叉 (买价 < 卖价)
2. 订单簿不同 (marketId 或 outcome 不同)
3. 订单已过期
4. 订单已完全成交

**解决方案 / Solutions:**
- 检查订单价格和参数
- 查看 Matcher 日志
- 验证订单未过期

### 问题: 成交记录未上链 / Fills Not Submitted

**可能原因 / Possible Causes:**
1. Relayer 未运行
2. Gas 价格过高
3. 余额不足
4. 网络连接问题

**解决方案 / Solutions:**
- 检查 Relayer 进程
- 调整 MAX_GAS_PRICE
- 确保 Relayer 账户有足够 ETH
- 检查 RPC 连接

### 问题: 签名验证失败 / Signature Verification Failed

**可能原因 / Possible Causes:**
1. 错误的 chainId
2. 错误的 verifyingContract
3. 订单参数不匹配
4. 签名损坏

**解决方案 / Solutions:**
- 确认 chainId 正确
- 确认使用正确的 Settlement 地址
- 验证订单结构完全匹配
- 重新签名订单

## 未来改进 / Future Improvements

1. **持久化存储**: Redis/PostgreSQL 替代内存订单簿
2. **WebSocket 推送**: 实时订单簿更新
3. **高级订单类型**: 限价单、止损单、市价单
4. **流动性激励**: 做市商奖励
5. **跨链支持**: 多链部署
6. **去中心化撮合**: P2P 订单传播
7. **隐私保护**: zk-SNARK 隐藏订单细节
8. **MEV 保护**: 批量拍卖机制

## 参考资料 / References

- [CTF Specification](https://docs.gnosis.io/conditionaltokens/)
- [EIP-712: Typed Data Signing](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-1155: Multi Token Standard](https://eips.ethereum.org/EIPS/eip-1155)
- [Pyth Network](https://pyth.network/)
- [Socrates Testnet](https://testnet.socrateschain.org/)

## 联系方式 / Contact

- GitHub Issues: Report bugs and feature requests
- Documentation: See `/docs` for detailed API specs
- Examples: See `/examples` for integration samples
