# PredictX API Reference

适用于 Socrates Testnet (Chain ID `1111111`)

## 1. 合约调用（On-chain）

- **RPC**: `https://rpc-testnet.socrateschain.org`
- **USDC**: `0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce`
- **ConditionalTokensV2**: `0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665`
- **SettlementV2**: `0xc73967F29E6dB5b7b61a616d030a9180e8617464`
- **MarketRegistryV2**: `0xE108166156626bD94e5686847F7a29E044D2b73c`
- **PythOracleAdapter**: `0xad3F4094cfA60d2503057e26EbeAf241AC7434E8`
- **Pyth Oracle (read-only)**: `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd`
- **BTC Feed ID**: `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de`

### 1.1 存入 / 提取抵押品 (SettlementV2)

```solidity
function depositCollateral(address token, uint256 amount) external;
function withdrawCollateral(address token, uint256 amount) external;
function withdrawFees(address token, uint256 amount, address to) external;
```

1. `ERC20.approve(SETTLEMENT_ADDRESS, amount)`
2. 调用 `depositCollateral(USDC, amount)`  
3. 提现时调用 `withdrawCollateral`

### 1.2 提交撮合成交 (Relayer/SettlementV2)

```solidity
function batchFill(Types.FillV2[] calldata fills) external;
```

- `Types.OrderV2` 结构必须与签名数据一致（见 `chain/contracts/libs/Types.sol`）
- 需提供 `fillAmount`、`taker`、`signature`

### 1.3 市场管理 (MarketRegistryV2)

```solidity
function createMarket(
    address collateral,
    address oracle,
    uint256 startTime,
    Types.MarketKind kind,
    uint8 timeframe
) external onlyOwner returns (uint256 marketId, bytes32 conditionId);

function resolveMarket(uint256 marketId) external;
function canResolve(uint256 marketId) external view returns (bool);
function getMarket(uint256 marketId) external view returns (Types.Market memory);
```

- `startTime` 必须整分 (timestamp % 60 == 0) 且晚于当前时间  
- `timeframe` 支持 `1/3/5` 分钟  
- 解析前需等待市场结束 + 60 秒冷却 (`resolveBuffer`)

### 1.4 条件代币 (ConditionalTokensV2)

常用函数:

```solidity
function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) public pure returns (bytes32);
function getCollectionId(bytes32 conditionId, uint256 indexSet) public pure returns (bytes32);
function getPositionId(IERC20 collateral, bytes32 collectionId) public pure returns (uint256);

function redeemPositions(
    IERC20 collateral,
    bytes32 conditionId,
    uint256[] calldata indexSets
) external;
```

- `indexSet`：Outcome0 = 1、Outcome1 = 2（按位）  
- 赎回需等待 `MarketRegistryV2.resolveMarket` 完成

### 1.5 Pyth Oracle 历史价格 (PythOracleAdapter)

```solidity
function getPriceAt(uint64 minuteTs) external view returns (int256 price, bool valid);
function getLatestPrice() external view returns (int256 price, uint256 timestamp, bool valid);
```

- 仅返回整分钟价格，内部调用 Pyth `getPriceAtZeroTimestamp`
- 建议在结算时加 60 秒冷却后调用

---

## 2. 后端 REST API

- **Base URL**: `http://localhost:8080`（默认）或 `API_PORT` 对应的地址

> 启动服务：  
> ```
> cd services
> pnpm start
> ```

### 2.1 健康检查

`GET /health`

```json
{ "status": "ok", "service": "PredictX API" }
```

### 2.2 市场接口

| Endpoint | Method | 描述 |
|----------|--------|------|
| `/api/v1/markets` | GET | 全部市场列表 |
| `/api/v1/markets/unresolved` | GET | 未解析市场 |
| `/api/v1/markets/:marketId` | GET | 指定市场详情 |
| `/api/v1/markets/stats/summary` | GET | 市场统计 |

返回示例：

```json
{
  "success": true,
  "count": 3,
  "markets": [
    {
      "id": "12",
      "conditionId": "0x…",
      "startTime": 1761771180,
      "endTime": 1761771240,
      "resolved": false,
      "collateral": "0x0CE3…",
      "oracle": "0xad3F…",
      "kind": 0,
      "timeframe": 1
    }
  ]
}
```

### 2.3 订单接口

| Endpoint | Method | 描述 |
|----------|--------|------|
| `/api/v1/orders` | POST | 提交签名订单（BUY/SELL） |
| `/api/v1/orders/:orderId` | GET | 查询订单状态 |
| `/api/v1/orders/:orderId` | DELETE | 取消订单（需提供 `marketId`, `outcome` 查询参数） |

提交订单示例：

```http
POST /api/v1/orders
Content-Type: application/json

{
  "order": {
    "maker": "0x…",
    "marketId": "12",
    "conditionId": "0x…",
    "outcome": 1,
    "collateral": "0x0CE3…",
    "pricePips": "5000",
    "amount": "50000000",
    "makerFeeBps": 30,
    "takerFeeBps": 30,
    "expiry": 1761772000,
    "salt": "0x…",
    "nonce": 1,
    "mintOnFill": true,
    "allowedTaker": "0x0000000000000000000000000000000000000000",
    "chainId": 1111111,
    "verifyingContract": "0xc73967F29E6dB5b7b61a616d030a9180e8617464"
  },
  "signature": "0x…",
  "side": "buy"
}
```

### 2.4 订单簿与统计

| Endpoint | Method | 描述 |
|----------|--------|------|
| `/api/v1/orderbook/:marketId/:outcome` | GET | 订单簿快照 |
| `/api/v1/stats` | GET | Matcher 统计数据 |

订单簿响应示例：

```json
{
  "marketId": "12",
  "outcome": 1,
  "bids": [
    { "price": "5000", "amount": "80000000", "orderCount": 3 }
  ],
  "asks": [
    { "price": "5500", "amount": "60000000", "orderCount": 2 }
  ]
}
```

### 2.5 错误返回格式

```json
{ "success": false, "error": "Invalid signature" }
```

HTTP 状态码：
- `201` 创建成功
- `200` 查询成功 / 取消成功
- `400` 参数错误
- `404` 未找到订单或市场
- `503` 服务不可用（matcher/manager 未注入）

---

## 3. 启动与监控要点

1. **私钥配置**：`RELAYER_PRIVATE_KEY` 必填，建议配置 `MARKET_MANAGER_PRIVATE_KEY`
2. **账户余额**：Relayer ≥ 0.1 ETH、MarketManager ≥ 0.05 ETH（用于 gas）
3. **日志观察**：启动时应看到：
   - `✅ Relayer started`
   - `✅ Matching Engine started`
   - `📡 启动 MarketCreated 事件监听...`
4. **健康检查**：`curl http://localhost:8080/health`
5. **定期监控**：查看 `services/runner` 的 30 秒统计输出，确保撮合、Relayer、MarketManager 状态正常

---

如需进一步扩展（WebSocket 推送、订单历史持久化等），可以在现有 API 基础上增加新端点或独立数据服务。祝测试顺利！
