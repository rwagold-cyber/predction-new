# PredictX V2 部署报告

## 📊 基本信息

**部署时间**: 2025-10-29 23:02:53
**网络**: Socrates Testnet
**Chain ID**: 1111111
**RPC URL**: https://rpc-testnet.socrateschain.org
**区块浏览器**: https://explorer-testnet.socrateschain.org
**部署账户**: 0x770132b39E25582cddAa7721461cB82Fbbe69FE6
**账户余额**: 80.999999638880579566 ETH

---

## 📋 已部署合约

### 1️⃣ MockUSDC (测试稳定币)
- **合约地址**: `0x0395BB8A7e9C1c20cd44926e66c41708f5e44943`
- **部署Gas**: 640,866
- **交易哈希**: `0xc6e6f3ae707e4e0c279bded06de758fa65204d8f338a92e4f77d042e12ca4d3e`
- **构造参数**: 无
- **功能**: 用于测试的 USDC 稳定币，支持任意铸造

### 2️⃣ ConditionalTokensV2 (条件代币系统)
- **合约地址**: `0xe4d5CDD2F64f45C4975cb0f97b84584718281089`
- **部署Gas**: 1,935,186
- **交易哈希**: `0xfbf1907c8b7e81a91739203bdeb7c1ca5aac4fa4b7f0c734bbd5a7d207bcdaf1`
- **构造参数**: 无
- **功能**: ERC1155 条件代币系统，管理所有预测市场的仓位

### 3️⃣ SettlementV2 (结算合约)
- **合约地址**: `0xFb2Fbdc019359A60c1E466d36BFb9b56Ac97FA8b`
- **部署Gas**: 2,095,227
- **交易哈希**: `0x10809ba2f7dbe83d3c0591b81e3eb24f27a69ffd46a72e5e3d932e0e0b261d8c`
- **构造参数**:
  - `ctf`: 0xe4d5CDD2F64f45C4975cb0f97b84584718281089
- **功能**: 订单结算和撮合，管理抵押品托管
- **配置**: 已将 MockUSDC 添加为支持的抵押品

### 4️⃣ PythOracleAdapter (预言机适配器)
- **合约地址**: `0x9678B5E11f6a5f6611aFE852f9c1127647f77d83`
- **部署Gas**: 447,518
- **交易哈希**: `0xabc1ac828985a081bbdfff63f1d27a77bd4beb0bae9da681cd056a91dd03f192`
- **构造参数**:
  - `_pyth`: 0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd
  - `_feedId`: 0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de
  - `_coolDownPeriod`: 60
- **功能**: 适配 Pyth 预言机，提供分钟级 BTC 价格数据

### 5️⃣ MarketRegistryV2 (市场注册表)
- **合约地址**: `0xe90F91a507f49fa9DdD8a711051e756CAfaD49Fb`
- **部署Gas**: 1,183,351
- **交易哈希**: `0x767192d06574f4f2cea8ab3b485763856be12ee1f206b7bc5e668fc018588cc0`
- **构造参数**:
  - `ctf`: 0xe4d5CDD2F64f45C4975cb0f97b84584718281089
- **功能**: 管理市场创建、解析和生命周期

---

## 🔧 预言机配置

### Pyth Oracle 集成
- **Pyth合约地址**: `0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd`
- **BTC Feed ID**: `0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de`
- **价格精度**: -8 (8位小数)
- **冷却期**: 60秒
- **最新测试价格**: $111,862.67 (2025-10-29T15:46:00)

### 预言机功能
- ✅ `getLatestPrice()` - 获取最新分钟级价格
- ✅ `getPriceAt(uint64)` - 获取历史分钟级价格
- ✅ `getPriceAtZeroTimestamp()` - 使用自定义方法获取准确的历史价格
- ✅ 分钟对齐验证
- ✅ 价格时效性检查（最多5分钟）

---

## 📈 测试市场

已成功创建3个测试市场：

### Market #1: BTC UP/DOWN 1分钟
- **Market ID**: 1
- **Condition ID**: `0xe26c786cfd72b5a87c6b40480e4a52939d0434128bf30961fef823907c06e53a`
- **开始时间**: 1761752940
- **结束时间**: 1761753000
- **时间框架**: 1分钟
- **交易对**: BTC/USD
- **结果类型**: UP (涨) / DOWN (跌)

### Market #2: BTC UP/DOWN 3分钟
- **Market ID**: 2
- **Condition ID**: `0xee218fa58b5663a17e5ace1b964ef7e51f62017c084b6c52a7728d66963c3cfd`
- **开始时间**: 1761752940
- **结束时间**: 1761753120
- **时间框架**: 3分钟

### Market #3: BTC UP/DOWN 5分钟
- **Market ID**: 3
- **Condition ID**: `0xd65210758c3a4842af4fe477007a0da311ff5ed345f2aa65abcc71568162e05d`
- **开始时间**: 1761752940
- **结束时间**: 1761753240
- **时间框架**: 5分钟

---

## 💰 测试账户配置

### 部署账户 (Deployer)
- **地址**: 0x770132b39E25582cddAa7721461cB82Fbbe69FE6
- **私钥**: 0xb304b6c6a8ed29942c2414d1dd2aaa9817aa5ff42f80e5634e2b1e1d8fc63f47
- **余额**: 80.99 ETH
- **USDC余额**: 100,000 USDC

### 中继器账户 (Relayer)
- **地址**: 0xe1B829BB4E1143e8FCEffA525caD374837Ec32ba
- **私钥**: 0xf681c8c714ab3a7f1f0e0eab9431d0a82587d7053c9778ecc3fb2eb5eacbb839
- **功能**: 批量提交结算交易

### 更多测试账户
详见 `/addresses.json` 文件，包含：
- Faucet账户
- Matcher操作员
- Demo交易者
- 流动性提供者
- 10+个测试用户

---

## ✅ 测试结果

### 已通过的测试
1. ✅ **依赖安装** - 629个npm包成功安装
2. ✅ **合约编译** - 43个Solidity文件成功编译
3. ✅ **合约部署** - 所有5个核心合约成功部署
4. ✅ **预言机连接** - 成功连接Pyth预言机并读取价格
5. ✅ **USDC铸造** - 成功铸造100,000 USDC
6. ✅ **市场创建** - 成功创建3个测试市场
7. ✅ **余额查询** - 账户余额查询正常

### 待完成的测试
- ⏳ **订单流程测试** - 存款环节遇到revert（待修复）
- ⏳ **市场解析测试** - 待测试
- ⏳ **仓位赎回测试** - 待测试
- ⏳ **完整交易流程** - 待测试

---

## 🔍 已知问题

### Issue #1: 订单测试存款失败
- **错误**: ProviderError: execution reverted
- **位置**: `testOrderFlow.ts` 存款阶段
- **可能原因**:
  - USDC approve 未正确调用
  - SettlementV2 存款条件检查失败
- **状态**: 待修复

---

## 📁 生成的文件

| 文件 | 路径 | 用途 |
|------|------|------|
| addresses.json | /chain/addresses.json | 已部署合约地址 |
| test-markets.json | /chain/test-markets.json | 测试市场配置 |
| .env | /chain/.env | 环境变量配置 |
| typechain-types | /chain/typechain-types | TypeScript类型定义 |

---

## 📊 Gas 使用统计

| 操作 | Gas Used | 占比 |
|------|----------|------|
| MockUSDC部署 | 640,866 | 10.4% |
| CTF部署 | 1,935,186 | 31.4% |
| SettlementV2部署 | 2,095,227 | 34.0% |
| PythOracleAdapter部署 | 447,518 | 7.3% |
| MarketRegistryV2部署 | 1,183,351 | 19.2% |
| 抵押品白名单 | 47,621 | 0.8% |
| **总计** | **6,349,769** | **100%** |

---

## 🔐 安全提示

⚠️ **重要**: 所有私钥仅用于测试环境
- 请勿在主网使用这些私钥
- 请勿向这些地址发送真实资产
- 测试完成后建议轮换私钥

---

## 📝 下一步操作

### 立即执行
1. ✅ 验证所有已部署的合约到区块浏览器
2. 🔧 修复订单流程测试中的存款问题
3. ✅ 完成全功能测试套件

### 后续优化
1. 优化Gas使用
2. 添加更多市场类型
3. 集成前端界面
4. 部署后端服务（matcher、relayer）

---

## 📞 支持信息

- **项目仓库**: https://github.com/rwagold-cyber/predction-new
- **Socrates测试网**: https://rpc-testnet.socrateschain.org
- **区块浏览器**: https://explorer-testnet.socrateschain.org

---

*报告生成时间: 2025-10-29 23:02:53*
*由 Claude Code 自动生成*
