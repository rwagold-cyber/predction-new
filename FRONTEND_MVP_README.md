# PredictX Frontend MVP - 使用说明

## 访问地址

前端应用: **http://localhost:5175/**  
后端 API: **http://localhost:8080/**

## 功能概览

### 1. 账户管理 (左侧面板)
- **选择账户**: 下拉选择 Demo Trader 或 Liquidity Provider
- **查看余额**: 
  - USDC Balance: 钱包中的 USDC 余额
  - Collateral Balance: 已存入合约的抵押品余额
- **入金 (Deposit)**:
  - 输入金额或点击快捷按钮 (50/100 USDC)
  - 自动授权 (approve) + 存入抵押品
  - 需要 2 笔链上交易
- **出金 (Withdraw)**:
  - 从抵押品余额提现到钱包
  - 1 笔链上交易

### 2. 市场创建器 (左侧面板下方)
- **快速创建测试市场**:
  - 选择时间框架 (1/3/5/10/15 分钟)
  - 点击 "Create Market"
  - 市场将在下一个整分钟 + 60秒后开始
  - MarketManager 会自动发现并跟踪新市场

### 3. 市场列表 (中间面板)
- **过滤器**: All / Active / Resolved
- **市场信息**:
  - Market ID 和时间框架
  - 状态: PENDING / ACTIVE / RESOLVED
  - 倒计时: 显示距离开始或结束的时间
  - 胜方结果 (已解析市场)
- **选择市场**: 点击市场卡片查看详情

### 4. 订单簿 (中间面板 - 选中市场后)
- **切换结果**: DOWN / UP 按钮
- **买卖盘**:
  - Asks (卖单): 红色显示
  - Bids (买单): 绿色显示
  - 显示价格、数量和订单数
- **自动刷新**: 每 3 秒

### 5. 下单表单 (中间面板 - 订单簿下方)
- **左侧: 买单 (BUY)** | **右侧: 卖单 (SELL)**
- **输入参数**:
  - Price: 0-1 之间 (0.5 = 50% 概率)
  - Amount: USDC 数量
- **预估信息**:
  - Cost: 成本
  - Potential profit: 潜在收益
  - Fee: 0.6% (0.3% maker + 0.3% taker)
- **签名提交**:
  - 使用 EIP-712 签名
  - 无需链上交易，直接提交到 API
  - 订单立即进入撮合引擎

### 6. 系统统计 (右侧面板上方)
- **Matching Engine**:
  - Total Orders: 活跃订单总数
  - Active Order Books: 活跃订单簿数量
- **Market Manager**:
  - Total Markets: 总市场数
  - Active Markets: 活跃市场
  - Unresolved: 未解析市场
  - Resolved: 已解析市场
  - Discoveries: 自动发现的市场数

### 7. 我的订单 (右侧面板下方)
- **订单列表**:
  - 显示所有提交的订单
  - 状态: ACTIVE / FILLED / CANCELLED
  - 显示已成交和剩余数量
- **撤单**: 点击 "Cancel Order" 按钮

## 完整测试流程

### 步骤 1: 准备账户
1. 选择账户: Demo Trader
2. 存入 50 USDC
3. 等待交易确认 (~5-10秒)
4. 确认 Collateral Balance 显示 50 USDC

### 步骤 2: 创建测试市场
1. 在 Market Creator 中选择 "5 minutes"
2. 点击 "Create Market"
3. 等待交易确认
4. 记录返回的 Market ID
5. 刷新 Market List，新市场应该出现

### 步骤 3: 下买单
1. 选中刚创建的市场
2. 选择 UP 或 DOWN
3. 在左侧 BUY 表单中:
   - Price: 0.5
   - Amount: 10
4. 点击 "BUY ORDER"
5. 等待签名和提交 (~1-2秒)
6. 订单出现在 Order Book 和 My Orders

### 步骤 4: 用另一个账户下卖单 (撮合)
1. 切换到 Liquidity Provider 账户
2. 先存入 50 USDC
3. 选择同一个市场和结果
4. 在右侧 SELL 表单中:
   - Price: 0.5
   - Amount: 10
5. 点击 "SELL ORDER"
6. 等待撮合 (~1秒)
7. Relayer 会将撮合结果提交到链上 (~10-20秒)

### 步骤 5: 等待市场解析
1. 观察倒计时，等待市场到期
2. MarketManager 会自动解析市场
3. Market 状态变为 RESOLVED
4. 显示 Winner: UP 或 DOWN

### 步骤 6: 赎回收益
**注意**: 赎回功能需要直接调用合约，前端暂未实现 UI 按钮。
可通过以下方式赎回:

```typescript
// 使用 ethers.js
const ctf = getCTFContract(wallet);
await ctf.redeemPositions(
  USDC_ADDRESS,
  market.conditionId,
  [1, 2] // Both outcomes
);
```

### 步骤 7: 出金
1. 确认 Collateral Balance 增加
2. 输入提现金额
3. 点击 "Withdraw"
4. 确认 USDC Balance 增加

## 技术细节

### 签名机制
- 使用 EIP-712 typed data 签名
- Domain: PredictX Settlement v2
- ChainId: 1111111
- Verifying Contract: Settlement 合约地址

### 价格表示
- 链上使用 pips: 1 pip = 0.0001
- 前端显示: 0.0-1.0
- 转换: price_pips = price * 10000

### 金额精度
- USDC: 6 decimals
- 前端输入: 10 USDC
- 链上: 10000000 (10 * 10^6)

### 订单状态流转
1. **submitted** → 签名并提交到 API
2. **active** → 进入订单簿等待撮合
3. **filled** → 完全成交
4. **cancelled** → 用户取消

## 测试账户

### Demo Trader
- 地址: `0xe40a34B77CBf15b49F6981e4236c76c2f096D261`
- 私钥: 已配置在 .env.development

### Liquidity Provider
- 地址: `0x44ffe865Ed0807D95be110E58B673111B702a122`
- 私钥: 已配置在 .env.development

## 链上验证

查询账户状态:
```bash
# USDC 余额
cast call $USDC_ADDRESS "balanceOf(address)(uint256)" $YOUR_ADDRESS --rpc-url $RPC_URL

# 抵押品余额
cast call $SETTLEMENT_ADDRESS "collateralBalances(address,address)(uint256)" $YOUR_ADDRESS $USDC_ADDRESS --rpc-url $RPC_URL

# CTF 仓位
cast call $CTF_ADDRESS "balanceOf(address,uint256)(uint256)" $YOUR_ADDRESS $POSITION_ID --rpc-url $RPC_URL
```

查询市场状态:
```bash
cast call $MARKET_REGISTRY_ADDRESS "getMarket(uint256)" $MARKET_ID --rpc-url $RPC_URL
```

## 常见问题

### Q: 订单提交后没有出现在订单簿?
A: 检查:
1. 签名是否成功 (浏览器控制台)
2. API 返回的错误信息
3. 后端日志 `docker logs predictx-backend`

### Q: 撮合后没有上链?
A: 检查:
1. Relayer 日志
2. Gas price 是否过高
3. Relayer 账户是否有 gas

### Q: 市场没有自动解析?
A: 检查:
1. MarketManager 是否运行
2. 是否已过冷却期 (endTime + 5 minutes)
3. Oracle 价格是否可用

### Q: 余额没有更新?
A: 
1. 等待 5 秒自动刷新
2. 手动刷新页面
3. 检查链上实际余额

## 开发工具

### 浏览器控制台
打开 F12 开发者工具，查看:
- 网络请求 (API calls)
- 签名过程
- 错误日志

### 后端日志
```bash
# Docker 容器日志
docker logs -f predictx-backend

# 查看最近 100 行
docker logs --tail 100 predictx-backend
```

### 链上浏览器
Socrates Testnet Explorer:
https://explorer-testnet.socrateschain.org/

## 下一步优化

1. 添加赎回按钮 (Redeem Positions)
2. 显示 CTF 仓位余额
3. 订单历史持久化 (localStorage)
4. WebSocket 实时推送
5. 移动端适配
6. 性能监控和错误追踪

## 安全提示

⚠️ **警告**: 
- 前端直接使用私钥签名，仅适合测试环境
- 生产环境必须使用 MetaMask 或其他钱包
- 不要将测试私钥用于主网
- Market Creator 功能需要特殊权限，生产环境应移除或限制访问

祝测试顺利！🚀
