# PredictX V2 项目总结

## 项目概述

PredictX V2 是一个基于 CTF (Conditional Token Framework) 的高性能预测市场平台，采用链下订单簿 + 链上结算的混合架构，支持 BTC/ETH 价格短期预测（1分钟/3分钟/5分钟）。

**架构版本**: V2 (CTF + 链下撮合)
**部署网络**: Socrates Testnet (Chain ID: 1111111)
**预言机**: Pyth Oracle (整分钟价格)
**价格精度**: BPS (basis points, 0-10000)

## 核心技术栈

### 智能合约 V2 (Solidity 0.8.24)
- **ConditionalTokensV2**: CTF 主合约 (ERC1155 仓位代币)
- **SettlementV2**: 订单结算 + CTF 集成
- **MarketRegistryV2**: 市场管理 + Oracle 集成
- **PythOracleAdapter**: Oracle 价格适配器

### 后端服务 V2 (Node.js + TypeScript)
- **API Server**: REST API (订单提交/查询)
- **Matching Engine**: 价格-时间优先订单簿撮合
- **Relayer**: 批量链上结算服务
- **EIP-712**: 订单签名验证

### 前端 (React + Vite + TypeScript)
- **钱包集成**: ethers.js v6
- **市场展示**: 实时市场列表
- **订单簿**: 买卖订单展示
- **交易界面**: 简单的下单界面

## 已实现功能（V2 架构）

### ✅ 核心功能
1. **智能合约 V2**
   - ✅ CTF (ERC1155): split/merge/redeem/prepareCondition/reportPayouts
   - ✅ 市场创建: createMarket(collateral, oracle, startTime, kind, timeframe)
   - ✅ 市场类型: BTC_UPDOWN / ETH_UPDOWN
   - ✅ 时间框架: 1/3/5 分钟
   - ✅ Oracle 价格获取和结算
   - ✅ EIP-712 订单签名验证
   - ✅ 批量结算: batchFill()
   - ✅ 价格精度: BPS (0-10000)

2. **后端服务 V2**
   - ✅ REST API (订单/订单簿/统计)
   - ✅ 撮合引擎 (价格-时间优先)
   - ✅ 自动撮合 (每 5 秒)
   - ✅ Relayer 批量提交 (10笔/批)
   - ✅ Gas 价格监控
   - ✅ 自动重试机制
   - ✅ 完整 API 文档

3. **前端界面**
   - ✅ 钱包连接
   - ✅ 市场列表
   - ✅ 订单簿展示
   - ✅ 下单功能

### ⚠️ 生产环境增强建议

1. **订单存储**: 当前内存 → 建议 PostgreSQL + Redis
2. **WebSocket**: 当前 HTTP 轮询 → 建议实时推送
3. **授权方式**: 当前 ERC20 approve → 建议 Permit2
4. **完整测试**: 需要单元测试和集成测试
5. **监控告警**: 建议 Prometheus + Grafana
6. **合约审计**: 生产前需要专业审计

### 📋 可选功能（未实现）

1. **P2P 订单广播**: 可使用 0x Mesh 或 libp2p
2. **多链支持**: 部署到其他 EVM 链
3. **移动端应用**: React Native / Flutter
4. **更多市场类型**: 长期市场、事件市场等

## 文件结构

```
predictx/
├── README.md                      # 完整文档
├── QUICK_START.md                 # 5分钟快速开始
├── DEPLOYMENT_GUIDE.md            # 详细部署指南
├── PROJECT_SUMMARY.md             # 本文件
├── test-deployment.sh             # 自动化部署测试脚本
├── .env.example                   # 环境变量模板
├── package.json                   # Monorepo 根配置
├── pnpm-workspace.yaml            # Workspace 配置
│
├── chain/                         # 智能合约
│   ├── contracts/
│   │   ├── ctf/                  # CTF 核心
│   │   │   └── ConditionalTokensV2.sol  # CTF 主合约 (ERC1155)
│   │   ├── core/                 # 核心合约 V2
│   │   │   ├── SettlementV2.sol         # 订单结算 + CTF 集成
│   │   │   └── MarketRegistryV2.sol     # 市场管理 + Oracle
│   │   ├── oracle/               # Oracle 适配
│   │   │   ├── IPyth.sol
│   │   │   ├── IMinuteOracle.sol
│   │   │   └── PythOracleAdapter.sol
│   │   ├── libs/                 # 库
│   │   │   ├── Errors.sol
│   │   │   └── Types.sol
│   │   └── mocks/                # 测试合约
│   │       └── MockUSDC.sol
│   ├── deploy/                   # 部署脚本
│   │   └── 00_deploy_all.ts
│   ├── scripts/                  # 辅助脚本
│   │   ├── mintUSDC.ts
│   │   ├── createMarkets.ts
│   │   ├── resolveMarket.ts
│   │   ├── testOracle.ts
│   │   └── checkBalance.ts
│   ├── hardhat.config.ts         # Hardhat 配置
│   ├── addresses.json            # 部署地址（生成）
│   └── markets.json              # 市场信息（生成）
│
├── services/                     # 后端服务 V2
│   ├── api/                      # REST API 服务
│   │   ├── src/server.ts
│   │   └── README.md
│   ├── matcher/                  # 撮合引擎
│   │   ├── src/matcher.ts
│   │   ├── src/orderbook.ts
│   │   └── src/signature.ts
│   ├── relayer/                  # 中继服务
│   │   └── src/relayer.ts
│   ├── runner.ts                 # 统一服务启动
│   └── package.json
│
└── apps/
    └── web/                      # React 前端
        ├── src/
        │   ├── App.tsx           # 主应用
        │   ├── main.tsx          # 入口
        │   └── index.css         # 样式
        ├── index.html
        ├── vite.config.ts
        └── package.json
```

## 使用流程

### 开发者视角

1. **部署**: `./test-deployment.sh` - 一键部署所有合约
2. **启动**: 启动 API 和前端服务
3. **测试**: 连接钱包并下单测试

### 用户视角

1. **连接**: 连接 MetaMask 到 Socrates Testnet
2. **选择**: 选择一个预测市场（1m/3m/5m）
3. **交易**: 下买单或卖单
4. **等待**: 等待市场结算
5. **赎回**: 赢家赎回 USDC

## 技术亮点

### 1. 条件代币框架（CTF）
- 完整实现 Gnosis CTF 协议
- 支持 split/merge/redeem 操作
- ERC1155 到 ERC20 包装

### 2. 链下订单簿 + 链上结算
- 订单在链下匹配（低延迟）
- 结算在链上执行（高安全）
- EIP-712 签名验证

### 3. Oracle 整分价格
- 使用 Pyth Oracle
- 整分钟时间戳对齐
- 历史价格查询支持

### 4. 模块化设计
- 合约职责清晰
- 易于扩展和维护
- Monorepo 管理

## 测试指南

### 自动化测试

```bash
# 运行完整部署测试
./test-deployment.sh
```

### 手动测试步骤

1. **合约部署**
   ```bash
   cd chain
   pnpm deploy:soc
   ```

2. **铸造 USDC**
   ```bash
   npx hardhat run scripts/mintUSDC.ts --network soc_test
   ```

3. **创建市场**
   ```bash
   npx hardhat run scripts/createMarkets.ts --network soc_test
   ```

4. **测试 Oracle**
   ```bash
   npx hardhat run scripts/testOracle.ts --network soc_test
   ```

5. **启动服务**
   ```bash
   # 终端 1
   cd services/api && pnpm dev

   # 终端 2
   cd apps/web && pnpm dev
   ```

6. **前端测试**
   - 访问 http://localhost:5173
   - 连接钱包
   - 下单测试

7. **市场结算**
   ```bash
   # 等待市场结束后
   npx hardhat run scripts/resolveMarket.ts --network soc_test
   ```

## 生产化建议

### 高优先级
1. **数据持久化**: 使用 PostgreSQL + Redis
2. **Permit2 集成**: 替换 approve 授权
3. **批量结算优化**: 净额化 + Gas 优化
4. **完整测试**: 单元测试 + 集成测试
5. **错误处理**: 完善错误处理和重试机制

### 中优先级
6. **WebSocket**: 实时订单簿推送
7. **撮合引擎**: 专业的链下撮合
8. **监控告警**: 系统健康监控
9. **审计**: 智能合约安全审计
10. **文档**: API 文档和用户指南

### 低优先级
11. **P2P 网络**: 订单广播
12. **多链支持**: 跨链部署
13. **更多市场**: ETH、其他资产
14. **移动端**: 移动应用

## 性能指标（预期）

### 合约 Gas 消耗
- 部署全套合约: ~8,000,000 gas
- 创建市场: ~200,000 gas
- Split position: ~150,000 gas
- 单笔结算: ~100,000 gas
- 批量结算（10笔）: ~600,000 gas

### 后端性能
- API 响应时间: < 100ms
- 订单簿查询: < 50ms
- 并发支持: ~1000 req/s

## 安全考虑

### 已实现
- ✅ EIP-712 签名验证
- ✅ Nonce 防重放
- ✅ 订单过期检查
- ✅ Oracle 价格验证

### 需增强
- ⚠️ 合约审计
- ⚠️ Permit2 授权
- ⚠️ MEV 保护
- ⚠️ Rate limiting
- ⚠️ DDoS 防护

## 已知问题和限制

1. **订单存储**: 当前在内存中，重启丢失
2. **撮合算法**: 简化版，不支持部分成交
3. **Gas 优化**: 未做批量优化
4. **错误处理**: 基础实现，需要增强
5. **测试覆盖**: 缺少自动化测试

## 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 项目
2. 创建特性分支: `git checkout -b feature/AmazingFeature`
3. 提交更改: `git commit -m 'Add some AmazingFeature'`
4. 推送分支: `git push origin feature/AmazingFeature`
5. 提交 Pull Request

## 许可证

MIT License

## 联系方式

如有问题或建议，请提交 Issue。

---

**感谢使用 PredictX!** 🎉
