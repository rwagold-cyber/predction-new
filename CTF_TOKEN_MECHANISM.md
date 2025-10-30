# PredictX CTF 代币机制详解

## 🎯 核心问题解答

### Q: Sell DOWN vs Buy DOWN 成交后，各自拥有什么代币？

**场景**: 
- 用户 A 挂单: Sell DOWN @ 0.5 price, 10 USDC
- 用户 B 挂单: Buy DOWN @ 0.5 price, 10 USDC

**成交结果**:

| 用户 | 操作 | 支付 | 获得代币 | 含义 |
|------|------|------|---------|------|
| A (Seller) | Sell DOWN | 锁定 5 USDC | **UP 代币** (10个) | 看涨 BTC，赌价格上涨 |
| B (Buyer) | Buy DOWN | 支付 5 USDC | **DOWN 代币** (10个) | 看跌 BTC，赌价格下跌 |

**为什么 Sell DOWN 获得 UP 代币？**

在 CTF 系统中，卖出一个结果的代币相当于买入另一个结果：
- Sell DOWN = 放弃 DOWN 赌注 = 持有 UP 赌注
- Buy DOWN = 获得 DOWN 赌注

## 📊 CTF 代币系统

### 代币结构

每个市场有 2 个条件代币 (Conditional Tokens):

```
Market (conditionId: 0x123...)
├── DOWN 代币 (outcome 0)
│   └── positionId = keccak256(abi.encode(conditionId, 1))
└── UP 代币 (outcome 1)
    └── positionId = keccak256(abi.encode(conditionId, 2))
```

### indexSet 映射

```solidity
outcome 0 (DOWN) → indexSet = 1 → positionId_DOWN
outcome 1 (UP)   → indexSet = 2 → positionId_UP
```

**为什么链上看到的是代码？**

CTF 使用 ERC1155 标准，tokenId 就是 positionId：
```
positionId = 82371046201838477239058478362892716450316715206418039137925152154835726158901
```

这是一个 256 位的哈希值，前端需要计算并映射回对应的市场和结果。

## 🔍 链上交易示例分析

### 交易详情
链接: https://explorer-testnet.socrateschain.org/tx/0x2a0b6d81d2b7252bd14ef51b15466727786bff17c9f1c1a74be081e1dd25602b

### 解析步骤

1. **查找 Transfer 事件**
```
ERC1155 Transfer Event:
  from: 0x0000000000000000000000000000000000000000
  to: 0xUserAddress
  id: 82371046201838477239058478362892716450316715206418039137925152154835726158901
  value: 10000000 (10 USDC with 6 decimals)
```

2. **计算 positionId**
```typescript
const conditionId = "0x..." // from market
const outcome = 1 // UP
const indexSet = 2 // for UP
const positionId = keccak256(abi.encode(conditionId, indexSet))
```

3. **验证映射**
```bash
# 使用 cast 计算
cast keccak $(cast abi-encode "f(bytes32,uint256)" $CONDITION_ID 2)
```

## 💰 价格和抵押品计算

### 示例订单

```
Market: BTC 5min UP/DOWN
Price: 0.5 (50%)
Amount: 10 USDC
```

### Sell DOWN @ 0.5

**卖方成本**:
```
抵押品锁定 = amount × (1 - price)
           = 10 × (1 - 0.5)
           = 5 USDC
```

**卖方获得**:
- 10 个 UP 代币
- 如果 BTC 价格上涨 (UP 胜出): 赎回 10 USDC，盈利 5 USDC
- 如果 BTC 价格下跌 (DOWN 胜出): 损失 5 USDC

### Buy DOWN @ 0.5

**买方成本**:
```
支付 = amount × price
     = 10 × 0.5
     = 5 USDC
```

**买方获得**:
- 10 个 DOWN 代币
- 如果 BTC 价格下跌 (DOWN 胜出): 赎回 10 USDC，盈利 5 USDC
- 如果 BTC 价格上涨 (UP 胜出): 损失 5 USDC

## 🎨 前端显示

### PositionPanel 组件

新增的 `PositionPanel` 组件会显示:

```
╔═══════════════════════════════════════╗
║  My Positions (CTF)                   ║
╠═══════════════════════════════════════╣
║  Market #13 - 5min          [DOWN]    ║
║  Balance: 10.0 tokens                 ║
║  Value: Pending                       ║
║  Position ID: 823710462018...         ║
╠═══════════════════════════════════════╣
║  Market #13 - 5min           [UP]     ║
║  Balance: 15.0 tokens                 ║
║  Value: 15 USDC (WINNER) ✅           ║
║  Position ID: 119384729473...         ║
╚═══════════════════════════════════════╝
```

### 功能特性

1. **自动加载市场数据**: 从后端 API 获取所有市场
2. **查询 CTF 余额**: 遍历所有市场，查询用户的 UP/DOWN 代币余额
3. **显示胜负状态**: 已解析市场会显示 WINNER/LOSER
4. **计算赎回价值**: 胜方代币可 1:1 赎回 USDC

## 🔄 完整交易流程

### 步骤 1: 下单
```typescript
// 前端签名 EIP-712
const order = {
  maker: userAddress,
  marketId: "13",
  conditionId: "0x...",
  outcome: 0, // DOWN
  pricePips: 5000, // 0.5
  amount: "10000000", // 10 USDC
  ...
};

const signature = await wallet.signTypedData(domain, types, order);
```

### 步骤 2: 提交到 Matcher
```
POST /api/v1/orders
{
  "order": {...},
  "signature": "0x...",
  "side": "buy"
}
```

### 步骤 3: 撮合引擎匹配
```
Matcher:
  Buy DOWN @ 0.5  <--match-->  Sell DOWN @ 0.5
         ↓
     生成 Fill
```

### 步骤 4: Relayer 提交链上
```solidity
function batchFill(Fill[] fills) {
  for (fill in fills) {
    // 验证签名
    verifySignature(fill.order, fill.signature);
    
    // 转移抵押品
    transferCollateral(taker, maker, amount);
    
    // Mint CTF 代币
    ctf.mint(buyer, positionId_DOWN, amount);
    ctf.mint(seller, positionId_UP, amount);
  }
}
```

### 步骤 5: 查看持仓
```typescript
// 前端自动刷新
const downPositionId = getPositionId(conditionId, 0);
const upPositionId = getPositionId(conditionId, 1);

const downBalance = await ctf.balanceOf(userAddress, downPositionId);
const upBalance = await ctf.balanceOf(userAddress, upPositionId);
```

### 步骤 6: 市场解析
```
MarketManager:
  监控市场到期 → 调用 Oracle → 解析结果
  
Market #13: 
  startPrice: $95,234
  endPrice: $96,100
  result: UP (价格上涨)
  winningOutcome: 1
```

### 步骤 7: 赎回收益
```typescript
// 用户手动赎回（前端可添加按钮）
await ctf.redeemPositions(
  USDC_ADDRESS,
  conditionId,
  [1, 2] // 赎回 UP 和 DOWN
);

// 胜方代币: 1:1 换回 USDC
// 败方代币: 销毁，无价值
```

## 📈 实际案例

### 案例 1: 双方对赌

**初始状态**:
- Alice: 100 USDC 抵押品
- Bob: 100 USDC 抵押品
- Market: BTC 5min UP/DOWN

**下单**:
- Alice: Sell DOWN @ 0.6, 20 USDC
- Bob: Buy DOWN @ 0.6, 20 USDC

**成交后持仓**:
```
Alice:
  - 抵押品: 100 - 8 = 92 USDC (锁定 20×(1-0.6)=8 USDC)
  - UP 代币: 20 个
  - 赌注: BTC 价格上涨

Bob:
  - 抵押品: 100 - 12 = 88 USDC (支付 20×0.6=12 USDC)
  - DOWN 代币: 20 个
  - 赌注: BTC 价格下跌
```

**市场解析 (UP 胜出)**:
```
Alice 赎回:
  - DOWN: 0 个 → 0 USDC
  - UP: 20 个 → 20 USDC
  - 盈利: 20 - 8 = 12 USDC

Bob 赎回:
  - DOWN: 20 个 → 0 USDC (败方)
  - UP: 0 个 → 0 USDC
  - 亏损: 12 USDC
```

### 案例 2: 链上验证

**查询用户持仓**:
```bash
# DOWN 代币余额
cast call $CTF_ADDRESS "balanceOf(address,uint256)(uint256)" \
  $USER_ADDRESS $POSITION_ID_DOWN \
  --rpc-url $RPC_URL

# UP 代币余额
cast call $CTF_ADDRESS "balanceOf(address,uint256)(uint256)" \
  $USER_ADDRESS $POSITION_ID_UP \
  --rpc-url $RPC_URL
```

**计算 positionId**:
```bash
# 方法 1: 使用 ethers.js
const positionId = getPositionId(conditionId, outcome);

# 方法 2: 使用 cast
POSITION_ID=$(cast keccak $(cast abi-encode "f(bytes32,uint256)" $CONDITION_ID $INDEX_SET))
```

## 🛠️ 前端集成

### 使用 PositionPanel

```typescript
// App.tsx
import PositionPanel from './components/PositionPanel';

<PositionPanel account={selectedAccount} />
```

### 功能

1. ✅ 自动加载所有市场
2. ✅ 查询用户在每个市场的 UP/DOWN 代币余额
3. ✅ 显示市场状态 (Active/Resolved)
4. ✅ 计算赎回价值 (已解析市场)
5. ✅ 显示胜负状态
6. ✅ 每 10 秒自动刷新

### 数据流

```
PositionPanel
    ↓
加载市场列表 (GET /api/v1/markets)
    ↓
遍历每个市场
    ↓
计算 positionId (DOWN & UP)
    ↓
查询 CTF 余额 (ctf.balanceOf)
    ↓
显示持仓信息
```

## 🔐 安全考虑

1. **Private Key 管理**: 测试环境使用明文私钥，生产必须使用钱包
2. **签名验证**: 后端验证 EIP-712 签名防止伪造订单
3. **余额检查**: Settlement 合约验证抵押品充足
4. **溢出保护**: 使用 SafeMath 防止数值溢出

## 📚 参考资料

- **CTF 规范**: https://docs.gnosis.io/conditionaltokens/
- **ERC1155 标准**: https://eips.ethereum.org/EIPS/eip-1155
- **EIP-712 签名**: https://eips.ethereum.org/EIPS/eip-712
- **链上浏览器**: https://explorer-testnet.socrateschain.org/

## 💡 常见问题

### Q: 为什么我看不到我的代币？

A: CTF 代币是 ERC1155，需要使用 `positionId` 查询。前端 PositionPanel 会自动计算并显示。

### Q: 订单成交后什么时候能看到代币？

A: 
1. Matcher 撮合: ~1秒
2. Relayer 提交链上: ~10-20秒
3. 交易确认: ~5秒
4. PositionPanel 刷新: 每 10秒

总计约 20-35 秒后可在前端看到。

### Q: 如何手动赎回代币？

A: 使用合约直接调用:
```typescript
await ctf.redeemPositions(
  collateralAddress,
  conditionId,
  [1, 2] // indexSets
);
```

未来会在前端添加 "Redeem" 按钮。

### Q: 败方代币有价值吗？

A: 没有。市场解析后，只有胜方代币可以 1:1 赎回 USDC，败方代币归零。

---

现在您可以在前端看到完整的持仓信息了！🎉
