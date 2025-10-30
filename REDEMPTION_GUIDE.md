# Redemption Center 使用指南

## 功能概述

RedemptionPanel（赎回中心）是前端的新模块，显示所有可以赎回 USDC 的获胜持仓，并提供一键赎回按钮。

## 访问位置

打开前端后，在右侧面板顶部（Stats Panel 下方）即可看到 Redemption Center。

```
访问地址: http://localhost:5175/

右侧栏布局:
┌─────────────────────────┐
│ Stats Panel             │
├─────────────────────────┤
│ Redemption Center  ✨NEW│  ← 新增模块
├─────────────────────────┤
│ My Positions (CTF)      │
├─────────────────────────┤
│ My Orders               │
└─────────────────────────┘
```

## 赎回规则

### 什么情况下可以赎回？

只有同时满足以下条件的持仓才可赎回：

1. ✅ 市场已解析 (resolved = true)
2. ✅ 持有胜方代币 (outcome === winningOutcome)
3. ✅ 代币余额 > 0

### 赎回比例

**1:1 赎回比例**

```
10 个胜方 CTF 代币 = 10 USDC
```

败方代币无法赎回，价值为 0。

## 界面说明

### 总览卡片

```
╔═══════════════════════════════════╗
║   Total Redeemable                ║
║   250.00 USDC                     ║
╚═══════════════════════════════════╝
```

显示当前账户所有可赎回的总金额。

### 单个持仓卡片

```
╔═══════════════════════════════════╗
║ Market #13 - 5min          [UP] ✅ ║
║ Winning Balance: 10.0 tokens      ║
║ Redeemable: 10.0 USDC             ║
║                                   ║
║ [Redeem 10.0 USDC]  ← 赎回按钮    ║
╚═══════════════════════════════════╝
```

- **Market ID**: 市场编号和时间框架
- **Outcome Badge**: 胜出的结果（UP 或 DOWN）+ ✅
- **Winning Balance**: 持有的胜方代币数量
- **Redeemable**: 可赎回的 USDC 金额
- **Redeem Button**: 点击即可赎回到抵押品账户

## 赎回流程

### 步骤 1: 等待市场解析

市场必须过期并被 MarketManager 解析后才能赎回。

```bash
# 查看市场状态
curl http://localhost:8080/api/v1/markets | jq '.markets[] | select(.id=="13")'

{
  "id": "13",
  "resolved": true,       ← 必须为 true
  "winningOutcome": 1,    ← UP 胜出
  ...
}
```

### 步骤 2: 查看可赎回持仓

前端会自动加载并显示所有可赎回的持仓。

**自动刷新**: 每 10 秒自动更新一次

### 步骤 3: 点击赎回按钮

点击 `Redeem X.X USDC` 按钮后：

1. 前端调用 `ctf.redeemPositions()`
2. 链上执行赎回交易
3. 胜方代币被销毁
4. USDC 返回到 Settlement 抵押品账户
5. 交易确认后自动刷新列表

### 步骤 4: 验证赎回成功

赎回后该持仓会从列表中消失，并且：

**抵押品余额增加**:
```typescript
// 在 AccountPanel 中查看
Collateral Balance: 110.0 USDC  // 从 100 增加到 110
```

**链上验证**:
```bash
# 查询抵押品余额
cast call $SETTLEMENT \
  "collateralBalances(address,address)(uint256)" \
  $YOUR_ADDRESS \
  $USDC \
  --rpc-url $RPC_URL | \
  awk '{print $1 / 1000000 " USDC"}'
```

## 技术实现

### 核心合约调用

```typescript
const ctf = getCTFContract(wallet);

await ctf.redeemPositions(
  USDC_ADDRESS,           // 抵押品代币地址
  conditionId,            // 市场的 conditionId
  [1, 2]                  // indexSets: [1=DOWN, 2=UP]
);
```

**重要**: 必须同时赎回两个 indexSet ([1, 2])，即使只有一个胜出。CTF 合约会自动识别：
- 胜方代币: 1:1 换回 USDC
- 败方代币: 销毁，无价值

### 数据流程

```
RedemptionPanel
    ↓
加载所有市场 (GET /api/v1/markets)
    ↓
筛选 resolved 市场
    ↓
遍历每个市场
    ↓
查询 UP/DOWN 代币余额 (ctf.balanceOf)
    ↓
过滤: balance > 0 AND outcome === winningOutcome
    ↓
显示可赎回列表
    ↓
用户点击 Redeem
    ↓
ctf.redeemPositions(USDC, conditionId, [1,2])
    ↓
链上确认
    ↓
USDC 返回 Settlement 抵押品账户
    ↓
列表自动刷新
```

## 测试场景

### 场景 1: 完整赎回测试

```
准备:
1. Demo Trader 和 Liquidity Provider 各存入 50 USDC

下单:
2. Demo Trader: Buy UP @ 0.5, 10 USDC
3. Liquidity Provider: Sell UP @ 0.5, 10 USDC
4. 成交后:
   - Demo Trader 获得 10 个 UP 代币
   - Liquidity Provider 获得 10 个 DOWN 代币

等待市场解析:
5. 等待 5 分钟市场到期
6. MarketManager 自动解析
7. 假设 UP 胜出 (BTC 价格上涨)

赎回验证:
8. Demo Trader 在 Redemption Center 看到:
   Market #X - 5min [UP] ✅
   Redeemable: 10.0 USDC
9. 点击 Redeem 按钮
10. 交易确认后，抵押品余额从 45 USDC 增加到 55 USDC
11. Liquidity Provider 没有可赎回持仓（持有败方 DOWN 代币）
```

### 场景 2: 多市场同时赎回

```
假设用户参与了 3 个市场，都已解析:
- Market #10: 持有 20 个 UP (胜出)
- Market #11: 持有 15 个 DOWN (胜出)
- Market #12: 持有 10 个 UP (失败)

Redemption Center 显示:
┌────────────────────────────────┐
│ Total Redeemable: 35.00 USDC   │
├────────────────────────────────┤
│ Market #10 - 5min [UP] ✅      │
│ Redeemable: 20.0 USDC          │
│ [Redeem 20.0 USDC]             │
├────────────────────────────────┤
│ Market #11 - 15min [DOWN] ✅   │
│ Redeemable: 15.0 USDC          │
│ [Redeem 15.0 USDC]             │
└────────────────────────────────┘

Market #12 不显示（败方代币）
```

### 场景 3: 部分代币已赎回

```
如果用户已经手动赎回了部分代币:

链上调用:
await ctf.redeemPositions(USDC, conditionId_10, [1,2])

结果:
- Market #10 从列表中消失
- Total Redeemable 更新为 15.0 USDC
- 只显示 Market #11
```

## 常见问题

### Q: 为什么我看不到任何可赎回的持仓？

A: 可能的原因：
1. 还没有市场解析完成（需要等待市场到期）
2. 持有的都是败方代币
3. 已经赎回过了

### Q: 赎回按钮点击后没反应？

A: 检查：
1. 浏览器控制台是否有错误
2. 账户私钥是否正确
3. RPC 连接是否正常
4. 链上交易是否被确认

查看链上交易:
```
https://explorer-testnet.socrateschain.org/address/YOUR_ADDRESS
```

### Q: 赎回后 USDC 在哪里？

A: 赎回后 USDC 会返回到 **Settlement 合约的抵押品账户**，而不是钱包余额。

查看位置:
- 前端: AccountPanel → Collateral Balance
- 链上: `Settlement.collateralBalances(user, USDC)`

如需提取到钱包，还需调用 `Settlement.withdraw()`。

### Q: 可以只赎回胜方代币吗？

A: CTF 合约要求同时提交 `[1, 2]` 两个 indexSet，但会自动处理：
- 胜方代币: 1:1 换回 USDC
- 败方代币: 自动销毁

所以即使提交两个 indexSet，也不会影响赎回金额。

### Q: 赎回有手续费吗？

A: 赎回操作只需支付 gas 费，没有额外的平台手续费。

## 错误处理

### 错误 1: "Redemption failed: execution reverted"

原因: 可能是合约调用失败

解决:
```bash
# 1. 检查市场是否已解析
curl http://localhost:8080/api/v1/markets | jq '.markets[] | select(.id=="13")'

# 2. 检查代币余额
cast call $CTF \
  "balanceOf(address,uint256)(uint256)" \
  $YOUR_ADDRESS $POSITION_ID \
  --rpc-url $RPC_URL

# 3. 检查 conditionId 是否正确
# 应该与市场的 conditionId 一致
```

### 错误 2: "Transaction timeout"

原因: 链上交易超时

解决:
1. 增加 gas limit
2. 检查 RPC 节点状态
3. 重试赎回操作

### 错误 3: "No positions ready for redemption"

原因: 没有可赎回的持仓

检查:
1. 是否有已解析的市场？
2. 是否持有胜方代币？
3. 代币余额是否 > 0？

## 界面截图说明

### 无持仓状态
```
╔═══════════════════════════════════╗
║    Redemption Center      🔄      ║
╠═══════════════════════════════════╣
║ No positions ready for redemption ║
╚═══════════════════════════════════╝
```

### 有持仓状态
```
╔═══════════════════════════════════╗
║    Redemption Center      🔄      ║
╠═══════════════════════════════════╣
║   Total Redeemable                ║
║   35.00 USDC                      ║
╠═══════════════════════════════════╣
║ Market #13 - 5min       [UP] ✅   ║
║ Winning Balance: 10.0 tokens      ║
║ Redeemable: 10.0 USDC             ║
║ [Redeem 10.0 USDC]                ║
╠═══════════════════════════════════╣
║ Market #14 - 15min     [DOWN] ✅  ║
║ Winning Balance: 25.0 tokens      ║
║ Redeemable: 25.0 USDC             ║
║ [Redeem 25.0 USDC]                ║
╚═══════════════════════════════════╝
```

### 赎回中状态
```
╔═══════════════════════════════════╗
║ Market #13 - 5min       [UP] ✅   ║
║ Winning Balance: 10.0 tokens      ║
║ Redeemable: 10.0 USDC             ║
║ [Redeeming...]  ⏳                ║
╚═══════════════════════════════════╝
```

## 相关文档

- **CTF 代币机制**: `CTF_TOKEN_MECHANISM.md`
- **快速参考**: `QUICK_REFERENCE.md`
- **前端使用指南**: `FRONTEND_MVP_README.md`

## 总结

✅ Redemption Center 自动显示所有可赎回持仓
✅ 一键赎回到抵押品账户
✅ 实时显示总可赎回金额
✅ 每 10 秒自动刷新
✅ 清晰的胜负标识
✅ 赎回后自动更新列表

现在访问 http://localhost:5175/ 即可使用完整的赎回功能！🎉
