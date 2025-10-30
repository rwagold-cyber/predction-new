# 后端服务文档

本文档描述了 PredictX 预测市场平台的后端架构、服务、API 参考和部署。

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                      后端服务                                │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │  API 服务器  │────────▶│      撮合引擎                │  │
│  │  (Express)   │         │    (内存订单簿)              │  │
│  └──────┬───────┘         └──────────────┬───────────────┘  │
│         │                                 │                  │
│         │                    成交记录      │                  │
│         ▼                                 ▼                  │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │   市场       │         │         中继器               │  │
│  │   管理器     │         │   (批量提交)                 │  │
│  └──────────────┘         └──────────────┬───────────────┘  │
└────────────────────────────────────────────┼──────────────────┘
                                             │
                                             │ batchFill()
                                             ▼
                                     智能合约
```

后端由四个主要服务组成:

1. **API 服务器**: 用于订单提交和查询的 REST API
2. **撮合引擎**: 链下订单簿和撮合逻辑
3. **中继器**: 将匹配的订单批量提交到区块链
4. **市场管理器**: 自动发现和解析市场

---

## 服务位置

```
services/
├── api/              # REST API 服务器
│   └── src/
│       └── server.ts
├── matcher/          # 撮合引擎
│   └── src/
│       ├── matcher.ts
│       ├── orderbook.ts
│       ├── signature.ts
│       └── types.ts
├── relayer/          # 链上提交
│   └── src/
│       └── relayer.ts
├── manager/          # 市场发现和解析
│   └── src/
│       └── manager.ts
└── runner.ts         # 统一服务启动器
```

---

## 配置

### 环境变量

**文件**: `services/.env`

```bash
# 区块链连接
RPC_URL=https://rpc-testnet.socrateschain.org
CHAIN_ID=1111111

# 私钥
RELAYER_PRIVATE_KEY=0x...         # 必需: 提交成交交易
MARKET_MANAGER_PRIVATE_KEY=0x...  # 推荐: 解析市场

# 合约地址
USDC_ADDRESS=0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce
CTF_ADDRESS=0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665
SETTLEMENT_ADDRESS=0xc73967F29E6dB5b7b61a616d030a9180e8617464
MARKET_REGISTRY_ADDRESS=0xE108166156626bD94e5686847F7a29E044D2b73c
ORACLE_ADAPTER_ADDRESS=0xad3F4094cfA60d2503057e26EbeAf241AC7434E8

# 中继器配置
BATCH_SIZE=10             # 每批次最大成交数
BATCH_DELAY_MS=2000       # 最大等待时间 (毫秒)
MAX_GAS_PRICE=100         # 最大 gas 价格 (gwei)
MAX_RETRIES=3             # 重试次数

# API 配置
API_PORT=8080             # API 服务器端口
CORS_ORIGIN=*             # CORS 允许的来源
```

### 账户要求

- **中继器账户**: ≥ 0.1 ETH (用于 gas 费用)
- **市场管理器账户**: ≥ 0.05 ETH (用于 gas 费用)

---

## API 服务器

**位置**: `services/api/src/server.ts`

基于 Express 的 REST API,提供订单提交、市场查询和系统统计功能。

### 启动

```bash
cd services
pnpm install
pnpm start
```

API 服务器将在 `http://localhost:8080` 启动(可通过 `API_PORT` 配置)。

---

## REST API 参考

### 基础 URL

```
http://localhost:8080
```

---

### 健康检查

**端点**: `GET /health`

**描述**: 检查服务健康状态

**响应**:
```json
{
  "status": "ok",
  "service": "PredictX API"
}
```

---

### 市场端点

#### 获取所有市场

**端点**: `GET /api/v1/markets`

**描述**: 检索所有市场

**响应**:
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

#### 获取未解析市场

**端点**: `GET /api/v1/markets/unresolved`

**描述**: 仅检索未解析的市场

**响应**: 与 `/api/v1/markets` 格式相同

---

#### 根据 ID 获取市场

**端点**: `GET /api/v1/markets/:marketId`

**描述**: 检索特定市场详情

**参数**:
- `marketId` (路径参数): 市场 ID

**响应**:
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

#### 获取市场统计

**端点**: `GET /api/v1/markets/stats/summary`

**描述**: 检索市场统计信息

**响应**:
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

### 订单端点

#### 提交订单

**端点**: `POST /api/v1/orders`

**描述**: 提交已签名的订单

**请求体**:
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

**响应** (成功):
```json
{
  "success": true,
  "orderId": "0x1234..."
}
```

**响应** (错误):
```json
{
  "success": false,
  "error": "Invalid signature"
}
```

**状态码**:
- `201`: 订单创建成功
- `400`: 请求无效 (缺少字段、签名无效、订单已过期)
- `503`: 服务不可用 (撮合引擎未运行)

---

#### 获取订单状态

**端点**: `GET /api/v1/orders/:orderId`

**描述**: 根据订单 ID 查询订单状态

**参数**:
- `orderId` (路径参数): 订单哈希

**响应**:
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

**订单状态值**:
- `active`: 订单在订单簿中,部分/未成交
- `filled`: 订单完全成交
- `cancelled`: 订单被用户取消
- `not_found`: 订单未找到

---

#### 取消订单

**端点**: `DELETE /api/v1/orders/:orderId`

**描述**: 取消活跃订单

**参数**:
- `orderId` (路径参数): 订单哈希
- `marketId` (查询参数): 市场 ID
- `outcome` (查询参数): 结果 (0 或 1)

**示例**:
```
DELETE /api/v1/orders/0x1234...?marketId=12&outcome=1
```

**响应** (成功):
```json
{
  "success": true,
  "message": "Order cancelled"
}
```

**响应** (错误):
```json
{
  "success": false,
  "error": "Order not found"
}
```

**状态码**:
- `200`: 订单取消成功
- `404`: 订单未找到
- `400`: 缺少必需的查询参数

---

### 订单簿端点

#### 获取订单簿

**端点**: `GET /api/v1/orderbook/:marketId/:outcome`

**描述**: 获取当前订单簿快照

**参数**:
- `marketId` (路径参数): 市场 ID
- `outcome` (路径参数): 结果 (0 或 1)

**响应**:
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

**注意**:
- `price`: 以 BPS 为单位的价格 (例如,"5000" = 50%)
- `amount`: 该价格水平的总金额 (6 位小数)
- `orderCount`: 该价格水平的订单数量

---

### 统计端点

#### 获取系统统计

**端点**: `GET /api/v1/stats`

**描述**: 获取撮合引擎统计信息

**响应**:
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

## 撮合引擎

**位置**: `services/matcher/src/matcher.ts`

撮合引擎维护内存中的订单簿并执行价格-时间优先撮合。

### 架构

```typescript
 MatchingEngine
├── orderBooks: Map<string, OrderBook>  // marketId-outcome → OrderBook
├── filledAmounts: Map<string, bigint>  // orderId → 已成交金额
└── 方法:
    ├── addOrder()         // 将已验证的订单添加到订单簿
    ├── cancelOrder()      // 从订单簿中移除订单
    ├── matchMarket()      // 撮合特定市场的订单
    ├── matchAll()         // 撮合所有市场
    └── matchesToFills()   // 将撮合结果转换为成交结构
```

### 订单簿实现

**位置**: `services/matcher/src/orderbook.ts`

**关键特性**:
- 价格-时间优先撮合
- 支持部分成交
- 高效的价格水平聚合
- O(log n) 订单插入/删除

**撮合算法**:
```typescript
// 对于每个市场 + 结果:
1. 按价格降序、时间戳升序排序买单
2. 按价格升序、时间戳升序排序卖单
3. 当 (最佳买价 >= 最佳卖价) 时:
   a. 撮合订单
   b. 生成成交记录
   c. 更新剩余金额
   d. 移除完全成交的订单
```

### 订单验证

订单在添加到订单簿之前会进行验证:

```typescript
// 基本验证
- amount > 0
- expiry > now
- outcome ∈ {0, 1}

// 签名验证
- 验证 EIP-712 签名
- 检查签名者 === order.maker

// 重复检查
- 计算订单哈希
- 检查是否已完全成交
```

### 撮合频率

撮合引擎每 **1 秒** 运行一次(可配置):

```typescript
setInterval(async () => {
  const matches = engine.matchAll();
  // 将撮合结果发送到中继器
}, 1000);
```

### 单向成交系统

**关键**: 系统使用单向成交方式来防止重复铸造:

```typescript
matchesToFills(matches: Match[]): Fill[] {
  const fills: Fill[] = [];

  for (const match of matches) {
    // 每次撮合只创建一个成交记录
    // sellOrder 是 maker, buyOrder.maker 是 taker
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

**为什么使用单向成交?**
- 防止代币的双重铸造
- 卖方锁定抵押品,铸造完整代币组
- 卖方将结果代币转移给买方
- 卖方保留相反的结果代币

---

## 中继器

**位置**: `services/relayer/src/relayer.ts`

中继器将匹配的订单批量处理并通过 `SettlementV2.batchFill()` 提交到区块链。

### 功能特性

1. **批量处理**: 将多个成交记录组合到单个交易中
2. **Gas 监控**: 提交前检查 gas 价格
3. **重试逻辑**: 临时失败时自动重试
4. **失败检测**: 识别永久性失败与临时性失败
5. **统计跟踪**: 监控提交成功率

### 配置

```typescript
const config = {
  batchSize: 10,           // 每批次最大成交数
  batchDelayMs: 2000,      // 最大等待时间 (2 秒)
  maxGasPrice: 100,        // 最大 gas 价格 (gwei)
  maxRetries: 3,           // 重试次数
};
```

### 提交流程

```typescript
1. 从撮合器接收成交记录
2. 添加到待处理队列
3. 当队列达到 batchSize 或超时时:
   a. 检查当前 gas 价格
   b. 如果 gasPrice > maxGasPrice: 等待并重试
   c. 估算批次所需 gas
   d. 调用 settlement.batchFill(fills)
   e. 等待确认
   f. 成功时: 清空队列
   g. 失败时: 重试或标记为永久失败
```

### 错误处理

**临时性失败** (重试):
- 网络超时
- Gas 价格过高
- Nonce 过低
- 交易定价过低

**永久性失败** (不重试):
- 签名无效
- 订单已过期
- 余额不足
- 订单超量成交

### 统计信息

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

## 市场管理器

**位置**: `services/manager/src/manager.ts`

市场管理器自动发现新市场并解析已过期的市场。

### 功能特性

1. **事件监听**: 监控 MarketRegistryV2 的 `MarketCreated` 事件
2. **定期扫描**: 每 30 秒检查可解析的市场
3. **自动解析**: 准备就绪时调用 `MarketRegistryV2.resolveMarket()`
4. **市场缓存**: 维护从区块链同步的市场本地缓存

### 市场发现

**基于事件**:
```typescript
// 监听 MarketCreated 事件
marketRegistry.on("MarketCreated", async (marketId, conditionId, event) => {
  console.log(`📡 发现新市场: ${marketId}`);
  await syncMarket(marketId);
});
```

**定期扫描**:
```typescript
setInterval(async () => {
  // 获取总市场数量
  const latestId = await marketRegistry.latestMarketId();

  // 同步任何缺失的市场
  for (let id = 1; id <= latestId; id++) {
    if (!markets.has(id.toString())) {
      await syncMarket(id.toString());
    }
  }
}, 60000); // 每 60 秒
```

### 市场解析

**解析条件**:
```typescript
canResolve = (
  market.resolved === false &&
  block.timestamp >= market.endTime &&
  block.timestamp >= market.endTime + resolveBuffer
);
```

**解析流程**:
```typescript
1. 查找所有未解析的市场
2. 对于每个 canResolve == true 的市场:
   a. 调用 marketRegistry.resolveMarket(marketId)
   b. 等待确认
   c. 更新本地缓存
   d. 记录解析详情
```

**解析缓冲期**: 市场结束时间后 60 秒,以确保价格数据可用

### 统计信息

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

## 运行器

**位置**: `services/runner.ts`

运行器是启动和监控所有后端服务的统一服务启动器。

### 启动的服务

```typescript
1. API 服务器 (Express)
2. 撮合引擎
3. 中继器
4. 市场管理器
```

### 监控

运行器每 **30 秒** 输出合并的统计信息:

```
=== PredictX 后端统计 ===

撮合器:
  总订单数: 150
  活跃订单簿: 4
  总撮合数: 45

中继器:
  总提交数: 25
  总成交数: 180
  待处理成交: 8
  失败提交: 2

市场管理器:
  总市场数: 15
  未解析: 3
  已解析: 12

API 服务器:
  端口: 8080
  状态: 运行中

==============================
```

### 启动

```bash
cd services
pnpm start
```

预期输出:
```
启动 PredictX 后端服务...
✅ 撮合引擎已启动
✅ 中继器已启动
✅ 市场管理器已启动
📡 启动 MarketCreated 事件监听...
🚀 API 服务器正在监听 http://localhost:8080
```

---

## 部署

### 本地开发

```bash
# 安装依赖
cd services
pnpm install

# 配置环境
cp .env.example .env
# 使用你的私钥编辑 .env

# 启动所有服务
pnpm start
```

### Docker 部署

**构建镜像**:
```bash
docker build -f docker/Dockerfile.backend -t predictx-backend .
```

**运行容器**:
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

### 生产环境检查清单

- [ ] 配置 `RELAYER_PRIVATE_KEY` 和 `MARKET_MANAGER_PRIVATE_KEY`
- [ ] 确保账户有足够的 ETH 用于 gas 费用
- [ ] 将 `CORS_ORIGIN` 设置为前端域名
- [ ] 适当配置 `MAX_GAS_PRICE`
- [ ] 设置监控和告警
- [ ] 配置日志聚合 (ELK/Loki)
- [ ] 为 API 服务器设置负载均衡器
- [ ] 启用速率限制
- [ ] 实现数据库持久化 (PostgreSQL)

---

## 监控与调试

### 健康检查

```bash
curl http://localhost:8080/health
```

### 查看日志

**Docker**:
```bash
docker logs -f predictx-backend
```

**本地**:
```bash
cd services
pnpm start | tee backend.log
```

### 调试订单提交

```bash
# 提交测试订单
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Content-Type: application/json" \
  -d @test-order.json

# 检查订单状态
curl http://localhost:8080/api/v1/orders/0x1234...
```

### 监控撮合

```bash
# 获取订单簿快照
curl http://localhost:8080/api/v1/orderbook/12/1

# 获取统计信息
curl http://localhost:8080/api/v1/stats
```

---

## 性能指标

### API 响应时间

- 健康检查: < 5ms
- 市场列表: < 20ms
- 订单簿查询: < 15ms
- 订单提交: < 100ms (包括签名验证)

### 撮合性能

- 撮合频率: 1 秒
- 每个订单簿订单数: 100-1000
- 撮合延迟: 每个市场 < 10ms
- 内存使用: 10,000 个订单约 50MB

### 中继器性能

- 批量大小: 10 个成交
- 批量延迟: 2 秒
- 每批次平均 gas: 约 850k
- 交易确认: 约 2-5 秒 (Socrates 测试网)

---

## 错误码

### API 错误

| 代码 | 消息 | 描述 |
|------|---------|-------------|
| 400 | Invalid amount | 订单金额 <= 0 |
| 400 | Order expired | 订单过期时间 < 当前时间 |
| 400 | Invalid outcome | 结果不是 0 或 1 |
| 400 | Invalid signature | EIP-712 签名验证失败 |
| 400 | Order already filled | 订单无剩余金额 |
| 404 | Order not found | 订单 ID 不在任何订单簿中 |
| 404 | Market not found | 市场 ID 不存在 |
| 503 | Service unavailable | 撮合引擎未初始化 |

### 合约错误

| 选择器 | 错误 | 描述 |
|----------|-------|-------------|
| 0x... | InsufficientBalance() | 存入的抵押品不足 |
| 0x... | InvalidSignature() | 订单签名无效 |
| 0x... | OrderExpired() | 订单已过期 |
| 0x... | Overfill() | 尝试成交超过订单金额 |
| 0x... | UnsupportedCollateral() | 抵押品代币未列入白名单 |

---

## 未来增强功能

### 高优先级

1. **数据库持久化**
   - PostgreSQL 用于订单/成交/市场存储
   - Redis 用于订单簿缓存
   - 防止重启时数据丢失

2. **WebSocket 支持**
   - 实时订单簿更新
   - 订单状态通知
   - 市场解析事件

3. **速率限制**
   - 按 IP 的请求限制
   - 反垃圾邮件保护
   - DDoS 缓解

### 中优先级

4. **订单历史 API**
   - 查询用户的历史订单
   - 查询市场交易历史
   - 分析端点

5. **高级撮合**
   - 市价单
   - 止损/止盈
   - 全部成交或取消、立即成交或取消

6. **监控与告警**
   - Prometheus 指标
   - Grafana 仪表板
   - Telegram/邮件告警

### 低优先级

7. **横向扩展**
   - 多个 API 服务器实例
   - 负载均衡
   - 分布式订单簿

8. **GraphQL API**
   - 灵活的查询接口
   - 订阅支持
   - 更好的开发者体验

---

## API 客户端示例

### JavaScript/TypeScript

```typescript
import { ethers } from 'ethers';

const API_URL = 'http://localhost:8080';

// 提交订单
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

// 获取订单簿
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

# 获取市场
def get_markets():
    response = requests.get(f'{API_URL}/api/v1/markets')
    return response.json()

# 获取订单簿
def get_orderbook(market_id, outcome):
    response = requests.get(
        f'{API_URL}/api/v1/orderbook/{market_id}/{outcome}'
    )
    return response.json()
```

---

## 故障排查

### 订单不撮合

**可能原因**:
1. 价格未交叉 (买价 < 卖价)
2. 不同的订单簿 (不同的 marketId 或 outcome)
3. 订单已过期
4. 订单已成交

**解决方案**:
- 检查订单价格和参数
- 查看撮合器日志了解撮合活动
- 验证订单未过期

### 成交未提交

**可能原因**:
1. 中继器未运行
2. Gas 价格过高
3. ETH 余额不足
4. 网络连接问题

**解决方案**:
- 检查中继器进程是否运行
- 增加 `MAX_GAS_PRICE`
- 确保中继器账户有足够的 ETH
- 检查 RPC 连接

### 市场未自动解析

**可能原因**:
1. 市场管理器未运行
2. ETH 余额不足
3. 预言机价格不可用
4. 解析缓冲期未过

**解决方案**:
- 检查市场管理器进程
- 确保市场管理器账户有 ETH
- 在市场 endTime 后等待 60 秒
- 检查预言机适配器是否有价格数据

---

有关智能合约详情,请参阅 **CONTRACTS.md**。
有关前端集成,请参阅 **FRONTEND.md**。
