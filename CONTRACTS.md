# 智能合约文档

本文档详细介绍 PredictX 预测市场平台的智能合约架构、接口和机制。

## 架构总览

PredictX V2 平台包含四个主要智能合约：

```
┌─────────────────────────────────────────────────────────────┐
│                       智能合约层                              │
│  ┌──────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │ SettlementV2 │◀──▶│     CTF     │◀──▶│ MarketRegistry  │  │
│  │   (交易)     │    │   (仓位)    │    │  V2 (市场)      │  │
│  └──────────────┘    └─────────────┘    └────────┬────────┘  │
│                                                    │           │
│                                          ┌─────────▼────────┐ │
│                                          │ PythOracle       │ │
│                                          │   Adapter        │ │
│                                          └──────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## ConditionalTokensV2 (CTF)

**位置**: `chain/contracts/ConditionalTokensV2.sol`

ConditionalTokensV2 合约是基于 ERC1155 的实现，管理预测市场的结果代币。它是实现零和博弈条件代币机制的核心组件。

### 核心函数

#### prepareCondition
```solidity
function prepareCondition(
    address oracle,
    bytes32 questionId,
    uint256 outcomeSlotCount
) external
```

为交易准备新的条件（市场结果集）。

**参数**:
- `oracle`: 授权报告结果的地址（MarketRegistryV2）
- `questionId`: 条件的唯一标识符
- `outcomeSlotCount`: 可能的结果数量（UP/DOWN 市场始终为 2）

**返回值**: `conditionId` (bytes32) - 此条件的唯一标识符

**使用场景**: 由 `MarketRegistryV2.createMarket()` 自动调用

---

#### splitPosition
```solidity
function splitPosition(
    IERC20 collateralToken,
    bytes32 conditionId,
    uint256 amount
) external
```

将抵押品分割成完整的结果代币集。

**参数**:
- `collateralToken`: 抵押代币地址（USDC）
- `conditionId`: 要分割成的条件
- `amount`: 要分割的抵押品数量（USDC 为 6 位小数）

**行为**:
- 从用户转移 `amount` 数量的抵押品到 CTF 合约
- 为用户铸造每种结果代币各 `amount` 数量（DOWN 和 UP）
- 用户收到完整代币集，可随时合并回抵押品

**示例**:
```
输入：100 USDC
输出：100 DOWN 代币 + 100 UP 代币
```

---

#### mergePositions
```solidity
function mergePositions(
    IERC20 collateralToken,
    bytes32 conditionId,
    uint256 amount
) external
```

将完整的结果代币集合并回抵押品。

**参数**:
- `collateralToken`: 抵押代币地址（USDC）
- `conditionId`: 要合并的条件
- `amount`: 要合并的完整代币集数量

**行为**:
- 销毁用户的每种结果代币各 `amount` 数量（DOWN 和 UP）
- 转移 `amount` 数量的抵押品回用户
- 必须持有完整代币集（所有结果的相等数量）

**示例**:
```
输入：100 DOWN 代币 + 100 UP 代币
输出：100 USDC
```

---

#### reportPayouts
```solidity
function reportPayouts(
    bytes32 questionId,
    uint256[] calldata payouts
) external
```

报告条件的最终结果。

**参数**:
- `questionId`: 要解析的问题
- `payouts`: 支付向量（例如，`[0, 1]` 表示 UP 获胜，`[1, 0]` 表示 DOWN 获胜）

**访问控制**: 仅可由预言机地址（MarketRegistryV2）调用

**行为**:
- 永久记录此条件的支付向量
- 使用户能够赎回获胜的结果代币
- 不能对同一 questionId 调用两次

---

#### redeemPositions
```solidity
function redeemPositions(
    IERC20 collateralToken,
    bytes32 conditionId,
    uint256[] calldata indexSets
) external
```

在条件解析后赎回结果代币以换取抵押品。

**参数**:
- `collateralToken`: 抵押代币地址
- `conditionId`: 已解析的条件
- `indexSets`: 要赎回的索引集数组（例如，`[1]` 表示 DOWN，`[2]` 表示 UP）

**行为**:
- 根据报告的结果计算支付
- 销毁结果代币
- 转移按比例的抵押品给用户

**示例**（UP 获胜，支付 `[0, 1]`）:
```
用户持有：100 UP 代币
赎回：销毁 100 UP，收到 100 USDC

用户持有：100 DOWN 代币
赎回：销毁 100 DOWN，收到 0 USDC
```

---

### 辅助函数

#### getConditionId
```solidity
function getConditionId(
    address oracle,
    bytes32 questionId,
    uint256 outcomeSlotCount
) public pure returns (bytes32)
```

计算给定参数的条件 ID。

**返回值**: `keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount))`

---

#### getCollectionId
```solidity
function getCollectionId(
    bytes32 conditionId,
    uint256 indexSet
) public pure returns (bytes32)
```

计算某个结果的集合 ID。

**参数**:
- `conditionId`: 条件标识符
- `indexSet`: 结果索引集（1 表示结果 0，2 表示结果 1，3 表示完整集）

---

#### getPositionId
```solidity
function getPositionId(
    IERC20 collateralToken,
    bytes32 collectionId
) public pure returns (uint256)
```

计算仓位的 ERC1155 代币 ID。

**返回值**: `uint256(keccak256(abi.encodePacked(collateralToken, collectionId)))`

**注意**: 这是用于 `balanceOf()` 和 `safeTransferFrom()` 调用的代币 ID。

---

## SettlementV2

**位置**: `chain/contracts/SettlementV2.sol`

SettlementV2 合约处理订单验证、签名验证和交易执行。

### 核心函数

#### depositCollateral
```solidity
function depositCollateral(address token, uint256 amount) external
```

将抵押品存入 Settlement 合约以进行交易。

**前提条件**: 用户必须授权 Settlement 合约花费 USDC

**示例**:
```solidity
await usdc.approve(settlementAddress, amount);
await settlement.depositCollateral(usdcAddress, amount);
```

---

#### withdrawCollateral
```solidity
function withdrawCollateral(address token, uint256 amount) external
```

从 Settlement 合约提取已存入的抵押品。

**要求**:
- 用户有足够的已存入余额
- 数量 > 0

---

#### fill
```solidity
function fill(
    Types.OrderV2 calldata order,
    bytes calldata signature,
    uint256 fillAmount,
    address taker
) external
```

执行单个订单填充（由 batchFill 内部使用）。

**参数**:
- `order`: 订单结构（见下文 OrderV2）
- `signature`: 来自订单创建者的 EIP-712 签名
- `fillAmount`: 要填充的数量（USDC 为 6 位小数）
- `taker`: 接受者地址

**验证**:
- 签名验证（EIP-712）
- 订单未过期
- 订单未超额填充
- 余额充足
- Nonce 有效

---

#### batchFill
```solidity
function batchFill(Types.FillV2[] calldata fills) external
```

在单笔交易中执行多个订单填充。

**参数**:
- `fills`: 填充结构数组

**行为**:
- 验证每个订单签名
- 检查余额和 nonce
- 如果 `mintOnFill = true`: 调用 CTF.splitPosition() 铸造结果代币
- 在创建者和接受者之间转移结果代币
- 扣除手续费
- 更新已填充数量
- 发出 `OrderFilled` 事件

**Gas 优化**: 批处理显著降低交易开销

---

### OrderV2 结构

```solidity
struct OrderV2 {
    address maker;              // 订单创建者
    string marketId;            // 市场标识符
    bytes32 conditionId;        // CTF 条件 ID
    uint8 outcome;              // 0=DOWN, 1=UP
    address collateral;         // 抵押代币（USDC）
    string pricePips;           // BPS 价格（0-10000，例如 "5000" = 50%）
    string amount;              // 订单大小（抵押品单位，6 位小数）
    uint16 makerFeeBps;         // 创建者手续费 BPS（例如 30 = 0.3%）
    uint16 takerFeeBps;         // 接受者手续费 BPS
    uint256 expiry;             // Unix 时间戳过期时间
    string salt;                // 唯一性随机盐
    uint256 nonce;              // 订单 nonce
    bool mintOnFill;            // 是否在填充时铸造代币
    address allowedTaker;       // 特定接受者（0x0 = 任何人）
    uint256 chainId;            // 链 ID（Socrates 为 1111111）
    address verifyingContract;  // Settlement 合约地址
}
```

---

### EIP-712 签名

订单使用 EIP-712 类型化数据签名：

**域**:
```typescript
{
  name: "PredictXSettlementV2",
  version: "1",
  chainId: 1111111,
  verifyingContract: settlementAddress
}
```

**类型定义**:
```typescript
const ORDER_TYPES = {
  OrderV2: [
    { name: "maker", type: "address" },
    { name: "marketId", type: "string" },
    { name: "conditionId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "collateral", type: "address" },
    { name: "pricePips", type: "string" },
    { name: "amount", type: "string" },
    { name: "makerFeeBps", type: "uint16" },
    { name: "takerFeeBps", type: "uint16" },
    { name: "expiry", type: "uint256" },
    { name: "salt", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "mintOnFill", type: "bool" },
    { name: "allowedTaker", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
};
```

**前端签名示例**:
```typescript
const signature = await signer.signTypedData(domain, ORDER_TYPES, order);
```

---

## MarketRegistryV2

**位置**: `chain/contracts/MarketRegistryV2.sol`

MarketRegistryV2 合约管理市场创建和解析。

### 核心函数

#### createMarket
```solidity
function createMarket(
    address collateral,
    address oracle,
    uint256 startTime,
    Types.MarketKind kind,
    uint8 timeframe
) external onlyOwner returns (uint256 marketId, bytes32 conditionId)
```

创建新的预测市场。

**参数**:
- `collateral`: 抵押代币地址（USDC）
- `oracle`: 预言机适配器地址（PythOracleAdapter）
- `startTime`: 市场开始时间戳（必须是整分钟对齐：`timestamp % 60 == 0`）
- `kind`: 市场类型（`BTC_UPDOWN = 0`, `ETH_UPDOWN = 1`）
- `timeframe`: 持续时间（分钟）（`1`、`3` 或 `5`）

**返回值**:
- `marketId`: 数字市场标识符
- `conditionId`: 此市场的 CTF 条件 ID

**行为**:
- 验证 `startTime` 是未来时间且整分钟对齐
- 计算 `endTime = startTime + timeframe * 60`
- 生成唯一的 `questionId`
- 调用 `CTF.prepareCondition()`
- 存储市场元数据
- 发出 `MarketCreated` 事件

**示例**:
```solidity
// 创建一个在下一分钟开始的 5 分钟 BTC 市场
uint256 nextMinute = ((block.timestamp / 60) + 1) * 60;
(uint256 marketId, bytes32 conditionId) = registry.createMarket(
    usdcAddress,
    oracleAdapterAddress,
    nextMinute,
    Types.MarketKind.BTC_UPDOWN,
    5
);
```

---

#### resolveMarket
```solidity
function resolveMarket(uint256 marketId) external
```

使用预言机价格数据解析市场。

**要求**:
- 市场必须已结束：`block.timestamp >= market.endTime`
- 解析缓冲期已过：`block.timestamp >= market.endTime + resolveBuffer`（60秒）
- 市场尚未解析

**行为**:
1. 从预言机获取 `market.startTime` 的开始价格
2. 从预言机获取 `market.endTime` 的结束价格
3. 确定获胜结果：`endPrice > startPrice ? UP : DOWN`
4. 用支付向量调用 `CTF.reportPayouts()`
5. 存储解析数据
6. 发出 `MarketResolved` 事件

**支付逻辑**:
```solidity
if (endPrice > startPrice) {
    payouts = [0, 1];  // UP 获胜
} else {
    payouts = [1, 0];  // DOWN 获胜
}
```

---

#### getMarket
```solidity
function getMarket(uint256 marketId) external view returns (Types.Market memory)
```

检索市场信息。

**返回值**: 市场结构，包含：
- `id`: 市场 ID
- `collateral`: 抵押代币地址
- `oracle`: 预言机地址
- `conditionId`: CTF 条件 ID
- `startTime`: 市场开始时间戳
- `endTime`: 市场结束时间戳
- `kind`: 市场类型
- `timeframe`: 持续时间（分钟）
- `resolved`: 解析状态
- `winningOutcome`: 获胜结果（0=DOWN, 1=UP，仅在已解析时）
- `startPrice`: 开始价格（仅在已解析时）
- `endPrice`: 结束价格（仅在已解析时）

---

#### canResolve
```solidity
function canResolve(uint256 marketId) external view returns (bool)
```

检查市场是否可以解析。

**返回值**: 如果以下条件都满足则为 `true`：
- 市场存在
- 市场尚未解析
- 当前时间 >= endTime + resolveBuffer

---

### Market 结构

```solidity
struct Market {
    uint256 id;
    address collateral;
    address oracle;
    bytes32 conditionId;
    uint256 startTime;
    uint256 endTime;
    MarketKind kind;
    uint8 timeframe;
    bool resolved;
    uint8 winningOutcome;
    int256 startPrice;
    int256 endPrice;
}
```

---

## PythOracleAdapter

**位置**: `chain/contracts/oracle/PythOracleAdapter.sol`

PythOracleAdapter 为 BTC 和 ETH 提供整分钟对齐的历史价格查询。

### 核心函数

#### getPriceAt
```solidity
function getPriceAt(uint64 minuteTs) external view returns (int256 price, bool valid)
```

检索特定整分钟时间戳的历史价格。

**参数**:
- `minuteTs`: Unix 时间戳（必须是整分钟对齐：`minuteTs % 60 == 0`）

**返回值**:
- `price`: 8 位小数的价格（例如，`6500000000000` = $65,000）
- `valid`: 价格数据是否有效

**要求**:
- `minuteTs` 必须是整分钟对齐
- 预言机必须有该时间戳的价格数据

**内部实现**: 调用 Pyth 的 `getPriceAtZeroTimestamp(feedId, minuteTs)`

---

#### getLatestPrice
```solidity
function getLatestPrice() external view returns (int256 price, uint256 timestamp, bool valid)
```

从 Pyth 预言机检索最新价格。

**返回值**:
- `price`: 当前价格
- `timestamp`: 价格时间戳
- `valid`: 有效性标志

---

### Pyth Oracle 集成

PythOracleAdapter 集成了 Pyth Network 的价格源：

**BTC Feed ID**: `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de`
**Pyth 合约**: `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd`（Socrates 测试网）

**价格格式**:
- 指数：-8（8 位小数）
- 示例：`6500000000000` 代表 $65,000.00

---

## 完整交易生命周期

### 1. 市场创建

```solidity
// 所有者创建市场
registry.createMarket(
    usdcAddress,
    oracleAdapter,
    startTime,
    MarketKind.BTC_UPDOWN,
    5  // 5 分钟
);
// → 发出 MarketCreated(marketId, conditionId)
// → 调用 CTF.prepareCondition()
```

### 2. 用户存入抵押品

```solidity
// 用户授权并存入 USDC
usdc.approve(settlementAddress, 1000e6);
settlement.depositCollateral(usdcAddress, 1000e6);
```

### 3. 订单创建和签名

```typescript
// 前端：用户创建并签名订单
const order = {
    maker: userAddress,
    marketId: "1",
    conditionId: "0x...",
    outcome: 1,  // UP
    collateral: usdcAddress,
    pricePips: "5500",  // 55%
    amount: "100000000",  // 100 USDC
    makerFeeBps: 30,
    takerFeeBps: 30,
    expiry: Math.floor(Date.now() / 1000) + 86400,
    salt: randomSalt,
    nonce: userNonce,
    mintOnFill: true,
    allowedTaker: ZERO_ADDRESS,
    chainId: 1111111,
    verifyingContract: settlementAddress
};

const signature = await signer.signTypedData(domain, types, order);

// 提交到 API
await fetch('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({ order, signature, side: 'buy' })
});
```

### 4. 链下撮合

```typescript
// 撮合器找到交叉订单并生成填充
const fills = [{
    order: sellOrder,
    signature: sellSignature,
    fillAmount: "100000000",
    taker: buyOrder.maker
}];
```

### 5. 链上结算

```solidity
// 中继器提交批次
settlement.batchFill(fills);

// 对于每个 mintOnFill=true 的填充：
// 1. 验证签名
// 2. 检查余额
// 3. CTF.splitPosition() - 铸造结果代币
// 4. 将结果代币转移给接受者
// 5. 将相反结果转移给创建者
// 6. 扣除手续费
```

### 6. 市场解析

```solidity
// 市场到期后（endTime + 60秒缓冲期）
registry.resolveMarket(marketId);

// → 从预言机获取开始和结束价格
// → 确定获胜结果
// → 如果 UP 获胜，调用 CTF.reportPayouts([0, 1])
// → 发出 MarketResolved 事件
```

### 7. 用户赎回

```solidity
// 用户赎回获胜仓位
uint256[] indexSets = [2];  // 索引 2 = UP 结果
ctf.redeemPositions(usdcAddress, conditionId, indexSets);

// → 销毁结果代币
// → 转移按比例的抵押品给用户
```

### 8. 提取抵押品

```solidity
// 用户将抵押品提取回钱包
settlement.withdrawCollateral(usdcAddress, amount);
```

---

## 仓位 ID 计算

仓位 ID 是用于标识特定结果代币的 ERC1155 代币 ID：

```solidity
// 步骤 1：获取条件 ID
bytes32 conditionId = ctf.getConditionId(oracle, questionId, 2);

// 步骤 2：获取结果的集合 ID
// indexSet: 1 表示结果 0 (DOWN)，2 表示结果 1 (UP)
bytes32 collectionId = ctf.getCollectionId(conditionId, indexSet);

// 步骤 3：获取仓位 ID
uint256 positionId = ctf.getPositionId(collateralToken, collectionId);

// 检查余额
uint256 balance = ctf.balanceOf(userAddress, positionId);
```

**替代计算方法（使用 solidityPackedKeccak256）**:
```typescript
import { solidityPackedKeccak256 } from 'ethers';

const conditionId = solidityPackedKeccak256(
    ['address', 'bytes32', 'uint256'],
    [oracleAddress, questionId, 2]
);

const collectionId = solidityPackedKeccak256(
    ['bytes32', 'uint256'],
    [conditionId, indexSet]
);

const positionId = solidityPackedKeccak256(
    ['address', 'bytes32'],
    [collateralAddress, collectionId]
);
```

---

## Gas 优化

### 批处理

SettlementV2 支持批量填充以降低 gas 成本：

```solidity
// 替代 10 次单独的 fill() 调用：
// Gas: ~150k * 10 = 1,500,000

// 使用 batchFill()：
// Gas: ~850k（10 次填充）
// 节省：~43%
```

### CTF 优势

ConditionalTokensV2 实现高效的市场解析：

**没有 CTF**（迭代所有用户）:
```
Gas: 每个用户约 50k
1000 个用户 = 50M gas（会失败）
```

**有 CTF**（单次 reportPayouts）:
```
Gas: 总共约 50k
用户独立赎回
可扩展到数百万用户
```

---

## 安全特性

### 1. 签名验证

- EIP-712 类型化数据签名防止重放攻击
- 签名包含 chainId 和 verifyingContract
- Nonce bitmap 防止双花

### 2. 抵押品安全

- 仅白名单抵押代币
- Settlement 合约持有托管
- 执行前余额检查
- ReentrancyGuard 保护

### 3. 市场安全

- 仅所有者可创建市场
- 带冷却期的预言机验证
- 创建后市场参数不可变
- CTF 确保正确支付

### 4. 访问控制

- 管理功能的 Ownable 模式
- 仅预言机可 reportPayouts
- 仅中继器提交填充（在生产设置中）

---

## 错误处理

### 常见错误

**InsufficientBalance()**
- 用户没有足够的已存入抵押品
- 解决方案：存入更多抵押品

**InvalidSignature()**
- 订单签名验证失败
- 解决方案：使用正确参数重新签名订单

**OrderExpired()**
- 订单过期时间戳已过
- 解决方案：创建带未来过期时间的新订单

**Overfill()**
- 尝试填充超过订单数量
- 解决方案：减少填充数量

**UnsupportedCollateral()**
- 抵押代币未列入白名单
- 解决方案：使用 USDC

**InvalidOutcome()**
- 结果必须是 0 或 1
- 解决方案：使用有效的结果值

---

## 测试

### 合约测试

运行完整测试套件：
```bash
cd chain
pnpm hardhat test
```

### 手动测试脚本

**铸造 USDC**:
```bash
npx hardhat run scripts/mintUSDC.ts --network soc_test
```

**创建市场**:
```bash
npx hardhat run scripts/createMarkets.ts --network soc_test
```

**解析市场**:
```bash
npx hardhat run scripts/resolveMarket.ts --network soc_test
```

**检查余额**:
```bash
npx hardhat run scripts/checkBalance.ts --network soc_test
```

---

## 部署

### 完整部署

```bash
cd chain
pnpm hardhat deploy --network soc_test
```

按顺序部署：
1. MockUSDC
2. ConditionalTokensV2
3. SettlementV2
4. PythOracleAdapter
5. MarketRegistryV2

生成带已部署地址的 `chain/addresses.json`。

### 验证

在区块浏览器上验证合约：
```bash
npx hardhat verify --network soc_test <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## 参考资料

- [CTF 规范](https://docs.gnosis.io/conditionaltokens/)
- [EIP-712: 类型化数据签名](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-1155: 多代币标准](https://eips.ethereum.org/EIPS/eip-1155)
- [Pyth Network 文档](https://docs.pyth.network/)
- [Socrates 测试网浏览器](https://explorer-testnet.socrateschain.org/)

---

后端集成和 API 使用详见 **BACKEND.md**。
前端开发详见 **FRONTEND.md**。
