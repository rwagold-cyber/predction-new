# PredictX 快速参考指南

## 📋 订单成交后的代币持有情况

### 简单记忆法

```
Sell DOWN @ price → 获得 UP 代币
Buy DOWN @ price → 获得 DOWN 代币

Sell UP @ price → 获得 DOWN 代币  
Buy UP @ price → 获得 UP 代币
```

**核心原则**: 卖掉一个结果 = 持有另一个结果

### 实例说明

#### 场景: Sell DOWN vs Buy DOWN @ 0.5

| 角色 | 操作 | 支付/锁定 | 获得代币 | 含义 |
|------|------|---------|---------|------|
| Alice | Sell DOWN | 锁定 5 USDC | 10 个 **UP** | 看涨 BTC |
| Bob | Buy DOWN | 支付 5 USDC | 10 个 **DOWN** | 看跌 BTC |

**为什么Alice获得UP代币？**
- 卖出 DOWN = 不看好 DOWN = 看好 UP
- 本质上是在做空 DOWN，做多 UP

## 🎨 前端新功能

访问 http://localhost:5175/ 后，在右侧面板可以看到：

### Redemption Center (赎回中心) ✨新增

```
╔═════════════════════════════════════╗
║    Redemption Center        🔄      ║
╠═════════════════════════════════════╣
║   Total Redeemable: 35.00 USDC      ║
╠═════════════════════════════════════╣
║  Market #13 - 5min       [UP] ✅    ║
║  Winning Balance: 10.0 tokens       ║
║  Redeemable: 10.0 USDC              ║
║  [Redeem 10.0 USDC]                 ║
╠═════════════════════════════════════╣
║  Market #14 - 15min     [DOWN] ✅   ║
║  Winning Balance: 25.0 tokens       ║
║  Redeemable: 25.0 USDC              ║
║  [Redeem 25.0 USDC]                 ║
╚═════════════════════════════════════╝
```

**功能特性**:
- ✅ 只显示已解析市场的获胜持仓
- ✅ 显示总可赎回金额
- ✅ 一键赎回到抵押品账户
- ✅ 赎回后自动刷新列表
- ✅ 每 10 秒自动更新

### My Positions (持仓面板)

```
╔═════════════════════════════════════╗
║     My Positions (CTF)              ║
╠═════════════════════════════════════╣
║  Market #13 - 5min       [DOWN] ⬇️   ║
║  Balance: 10.0 tokens               ║
║  Value: Pending                     ║
╠═════════════════════════════════════╣
║  Market #13 - 5min        [UP] ⬆️    ║
║  Balance: 10.0 tokens               ║
║  Value: 10 USDC (WINNER) ✅         ║
╚═════════════════════════════════════╝
```

**功能特性**:
- ✅ 自动显示所有市场的持仓
- ✅ 区分 UP 和 DOWN 代币
- ✅ 显示代币余额
- ✅ 已解析市场显示胜负
- ✅ 计算赎回价值
- ✅ 每 10 秒自动刷新

## 🔍 链上代币查询

### CTF Position ID 计算

```typescript
// 每个市场有 2 个 positionId

// DOWN (outcome 0)
indexSet = 1
positionId_DOWN = keccak256(abi.encode(conditionId, 1))

// UP (outcome 1)
indexSet = 2
positionId_UP = keccak256(abi.encode(conditionId, 2))
```

### 手动查询余额

```bash
# 1. 获取市场信息
MARKET_ID=13
CONDITION_ID=$(cast call $MARKET_REGISTRY \
  "getMarket(uint256)" $MARKET_ID \
  --rpc-url $RPC_URL | head -1)

# 2. 计算 positionId
# DOWN (indexSet = 1)
POS_ID_DOWN=$(cast keccak $(cast abi-encode \
  "f(bytes32,uint256)" $CONDITION_ID 1))

# UP (indexSet = 2)
POS_ID_UP=$(cast keccak $(cast abi-encode \
  "f(bytes32,uint256)" $CONDITION_ID 2))

# 3. 查询余额
cast call $CTF_ADDRESS \
  "balanceOf(address,uint256)(uint256)" \
  $YOUR_ADDRESS $POS_ID_DOWN \
  --rpc-url $RPC_URL

cast call $CTF_ADDRESS \
  "balanceOf(address,uint256)(uint256)" \
  $YOUR_ADDRESS $POS_ID_UP \
  --rpc-url $RPC_URL
```

## 💰 成本和收益计算

### Sell DOWN @ 0.5 (10 USDC)

```
成本 = amount × (1 - price)
     = 10 × (1 - 0.5)
     = 5 USDC (锁定抵押品)

获得: 10 个 UP 代币

如果 UP 胜出:
  赎回 10 USDC
  盈利 = 10 - 5 = 5 USDC ✅

如果 DOWN 胜出:
  UP 代币归零
  亏损 = 5 USDC ❌
```

### Buy DOWN @ 0.5 (10 USDC)

```
成本 = amount × price
     = 10 × 0.5
     = 5 USDC (支付)

获得: 10 个 DOWN 代币

如果 DOWN 胜出:
  赎回 10 USDC
  盈利 = 10 - 5 = 5 USDC ✅

如果 UP 胜出:
  DOWN 代币归零
  亏损 = 5 USDC ❌
```

## 🔄 完整交易时间线

```
[1] 下单 (前端签名)                    ~1 秒
      ↓
[2] 提交到 Matcher                     ~1 秒
      ↓
[3] 撮合匹配                           ~1 秒
      ↓
[4] Relayer 打包                       ~2 秒
      ↓
[5] 提交到链上                         ~10-20 秒
      ↓
[6] 交易确认                           ~5 秒
      ↓
[7] PositionPanel 显示                 ~10 秒 (下次刷新)
      ↓
[8] 等待市场到期                       ~5-15 分钟 (取决于 timeframe)
      ↓
[9] MarketManager 自动解析             ~30 秒
      ↓
[10] RedemptionPanel 显示可赎回        ~10 秒 (下次刷新)
      ↓
[11] 点击 Redeem 赎回 USDC             ~10-20 秒
      ↓
[12] 抵押品余额更新                    立即
      ↓
总计: 约 20-40 秒可在前端看到持仓
       市场解析后可在 Redemption Center 赎回
```

## 🎯 测试流程

### 1. 双账户对赌测试（完整流程）

```
准备:
1. Demo Trader 存入 50 USDC
2. Liquidity Provider 存入 50 USDC

下单:
3. Demo Trader: Buy DOWN @ 0.5, 10 USDC
4. Liquidity Provider: Sell DOWN @ 0.5, 10 USDC

验证持仓:
5. 等待 30 秒
6. 刷新 PositionPanel
7. Demo Trader 应看到 10 个 DOWN 代币
8. Liquidity Provider 应看到 10 个 UP 代币

市场解析:
9. 等待市场到期 (5 分钟)
10. MarketManager 自动解析
11. 查看胜方和赎回价值

赎回收益:
12. 刷新 RedemptionPanel
13. 胜方在 Redemption Center 看到可赎回金额
14. 点击 Redeem 按钮
15. 等待链上确认 (~20 秒)
16. 验证抵押品余额增加
17. 该持仓从 Redemption Center 消失
```

### 2. 链上验证

```bash
# 查看链上交易
https://explorer-testnet.socrateschain.org/address/YOUR_ADDRESS

# 查看 ERC1155 Transfer 事件
# 找到 tokenId (positionId)
# 对比前端显示的 Position ID
```

## 📊 持仓显示规则

### 未解析市场
```
Market #13 - 5min          [DOWN]
Balance: 10.0 tokens
Value: Pending
```

### 已解析 - 胜方
```
Market #13 - 5min          [UP]
Balance: 10.0 tokens
Value: 10 USDC (WINNER) ✅
```

### 已解析 - 败方
```
Market #13 - 5min          [DOWN]
Balance: 10.0 tokens
Value: 0 USDC (LOSER)
```

## 🛠️ 常用命令

### 查看合约地址
```bash
cat chain/addresses.json
```

### 查看测试账户余额
```bash
# USDC
cast call $USDC \
  "balanceOf(address)(uint256)" \
  0xe40a34B77CBf15b49F6981e4236c76c2f096D261 \
  --rpc-url $RPC_URL | \
  awk '{print $1 / 1000000 " USDC"}'

# Collateral
cast call $SETTLEMENT \
  "collateralBalances(address,address)(uint256)" \
  0xe40a34B77CBf15b49F6981e4236c76c2f096D261 \
  $USDC \
  --rpc-url $RPC_URL | \
  awk '{print $1 / 1000000 " USDC"}'
```

### 重启服务
```bash
# 重启后端
cd /home/jason/文档/mygits/predction-new
docker-compose -f docker-compose.backend.yml restart

# 前端会自动热更新，无需重启
```

## 📚 相关文档

- **完整 CTF 机制说明**: `CTF_TOKEN_MECHANISM.md`
- **赎回功能使用指南**: `REDEMPTION_GUIDE.md` ✨新增
- **前端使用指南**: `FRONTEND_MVP_README.md`
- **问题修复记录**: `FIXES_APPLIED.md`

## 🎉 总结

- **Sell DOWN** → 获得 **UP 代币** (看涨)
- **Buy DOWN** → 获得 **DOWN 代币** (看跌)
- 链上代币是 **ERC1155**，tokenId 是 **positionId**
- 前端 **PositionPanel** 自动计算并显示持仓
- 前端 **RedemptionPanel** 显示可赎回持仓并提供一键赎回 ✨新增
- 成交后 **20-40 秒** 可在前端看到
- 胜方代币 **1:1 赎回** USDC，败方归零
- 赎回后 USDC 返回 **Settlement 抵押品账户**

现在访问 http://localhost:5175/ 即可完成完整交易流程：存入 → 交易 → 持仓 → 赎回 → 提取！
