# PredictX 部署指南

本文档提供详细的部署步骤和测试指南。

## 目录

- [准备工作](#准备工作)
- [部署步骤](#部署步骤)
- [测试流程](#测试流程)
- [常见问题](#常见问题)

## 准备工作

### 1. 环境要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- MetaMask 钱包

### 2. 获取测试代币

访问 Socrates Testnet 水龙头获取测试代币用于部署合约。

### 3. 配置私钥

⚠️ **安全提示**: 请勿在 .env 文件中使用真实资金的私钥！

```bash
# 从 MetaMask 导出私钥
# 设置 -> 账户详情 -> 导出私钥

# 编辑 .env 文件
DEPLOYER_PK=0xyour_private_key_here
```

## 部署步骤

### 步骤 1: 安装依赖

```bash
# 克隆或进入项目目录
cd predction-new

# 安装依赖
pnpm install

# 进入合约目录
cd chain
pnpm install
```

### 步骤 2: 编译合约

```bash
# 在 chain 目录下
pnpm build

# 验证编译成功
ls artifacts/contracts/
```

### 步骤 3: 检查账户余额

```bash
npx hardhat run scripts/checkBalance.ts --network soc_test
```

确保账户有足够的余额（建议至少 0.1 ETH 等值代币）。

### 步骤 4: 测试 Oracle 连接

```bash
npx hardhat run scripts/testOracle.ts --network soc_test
```

应该看到当前 BTC 价格和时间戳信息。

### 步骤 5: 部署合约

```bash
# 部署所有合约
pnpm deploy:soc

# 部署成功后会生成 addresses.json
cat addresses.json
```

**预期输出**:
```json
{
  "network": "soc_test",
  "chainId": "1111111",
  "usdc": "0x...",
  "ctf": "0x...",
  ...
}
```

### 步骤 6: 铸造测试 USDC

```bash
npx hardhat run scripts/mintUSDC.ts --network soc_test
```

### 步骤 7: 创建市场

```bash
npx hardhat run scripts/createMarkets.ts --network soc_test

# 查看创建的市场
cat markets.json
```

**市场信息示例**:
```json
[
  {
    "marketId": "1",
    "timeframe": 1,
    "startTime": 1234567890,
    "endTime": 1234567950
  },
  ...
]
```

## 测试流程

### 完整端到端测试

#### 1. 启动后端服务

```bash
# 新终端 1
cd services/api
pnpm install
pnpm dev

# 应该看到:
# API server running on http://localhost:8080
# Loaded 3 markets
```

#### 2. 启动前端

```bash
# 新终端 2
cd apps/web
pnpm install
pnpm dev

# 应该看到:
# Local: http://localhost:5173
```

#### 3. 测试前端功能

1. **连接钱包**
   - 打开 http://localhost:5173
   - 点击 "Connect Wallet"
   - MetaMask 会提示切换到 Socrates Testnet
   - 批准连接

2. **查看市场**
   - 应该能看到 3 个市场（1m, 3m, 5m）
   - 每个市场显示状态：pending（未开始）、active（进行中）、ended（已结束）

3. **下单测试**
   - 选择一个市场
   - 在订单簿中应该是空的（初始状态）
   - 尝试下一个买单：
     - Price: 0.5
     - Amount: 100
   - 点击 "Place BUY Order"
   - 应该收到确认弹窗

4. **查看订单簿**
   - 刷新页面
   - 应该能看到刚才下的买单
   - 尝试下一个卖单进行匹配

#### 4. 市场结算测试

等待市场结束时间到达（开始时间 + timeframe）后：

```bash
# 等待市场结束后至少 60 秒
# 然后执行结算

cd chain
npx hardhat run scripts/resolveMarket.ts --network soc_test

# 或指定市场 ID
MARKET_ID=1 npx hardhat run scripts/resolveMarket.ts --network soc_test
```

**预期输出**:
```
Market Resolved Successfully!
Winning Outcome: UP (或 DOWN/SAME)
```

## API 测试

### 使用 curl 测试 API

```bash
# 健康检查
curl http://localhost:8080/health

# 获取所有市场
curl http://localhost:8080/api/markets

# 获取特定市场
curl http://localhost:8080/api/markets/1

# 获取订单簿
curl http://localhost:8080/api/orderbook/1/1

# 提交订单
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "marketId": "1",
    "outcome": 1,
    "side": "BUY",
    "price": 0.5,
    "amount": 100,
    "maker": "0xYourAddress"
  }'
```

## 常见问题

### Q1: 部署失败 - Insufficient funds

**问题**: 账户余额不足

**解决方案**:
1. 检查账户余额: `npx hardhat run scripts/checkBalance.ts --network soc_test`
2. 从水龙头获取更多测试代币
3. 确认使用的是正确的账户

### Q2: Oracle 价格获取失败

**问题**: `Oracle_PriceNotAvailable` 错误

**解决方案**:
1. 检查 Oracle 连接: `npx hardhat run scripts/testOracle.ts --network soc_test`
2. 确认 Oracle 地址正确
3. 等待 Oracle 价格更新（每分钟更新一次）

### Q3: 市场无法结算

**问题**: `Market cannot be resolved yet`

**可能原因**:
1. 市场结束时间未到
2. Oracle 价格尚未可用（需要等待结束后 ~60 秒）
3. Oracle 时间戳不对齐

**解决方案**:
```bash
# 检查市场状态
npx hardhat run scripts/getMarketInfo.ts --network soc_test

# 等待足够时间后重试
```

### Q4: 前端无法连接钱包

**问题**: MetaMask 连接失败

**解决方案**:
1. 确保安装了 MetaMask
2. 检查浏览器控制台错误信息
3. 手动添加 Socrates Testnet:
   - Network Name: Socrates Testnet
   - RPC URL: https://rpc-testnet.socrateschain.org
   - Chain ID: 1111111

### Q5: 订单提交后看不到

**问题**: 订单簿中没有显示订单

**解决方案**:
1. 检查 API 服务是否运行
2. 检查浏览器控制台错误
3. 刷新页面重新加载订单簿
4. 当前订单存储在内存中，重启 API 会丢失

## 生产部署注意事项

### 1. 安全

- ✅ 使用硬件钱包或 KMS 管理私钥
- ✅ 启用合约验证和审计
- ✅ 实现 Permit2 授权
- ✅ 配置防火墙规则

### 2. 数据库

- ✅ 使用 PostgreSQL 存储订单
- ✅ Redis 缓存订单簿
- ✅ 定期备份数据

### 3. 监控

- ✅ 设置 Prometheus + Grafana
- ✅ 配置告警规则
- ✅ 日志聚合（ELK/Loki）

### 4. 性能优化

- ✅ 批量结算优化
- ✅ Gas 价格预估
- ✅ 订单簿快照机制
- ✅ WebSocket 实时推送

## 下一步

1. 实现持久化存储
2. 添加自动化测试
3. 部署 Relayer 服务
4. 实现 WebSocket 推送
5. 添加更多市场类型

## 支持

遇到问题请：
1. 查看日志文件
2. 检查网络连接
3. 提交 Issue 到 GitHub

---

**祝部署顺利！** 🚀
