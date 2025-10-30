# PredictX Web MVP 开发指南

> 目标：在 `apps/web` 中快速实现“入金 → 下单 → 撮合 → 撤单/结算 → 盈亏确认 → 出金”的完整测试流水，并提供一键创建 5 分钟市场的调试入口。以下内容仅适用于 Socrates Testnet，本地演示账号来自 `addresses.json`，请勿用于真实资金环境。

---

## 1. 总体结构建议

```
apps/web/src/
├── components/
│   ├── AccountPanel.tsx        # 账户切换、余额、入/出金
│   ├── MarketList.tsx          # 市场列表与状态
│   ├── OrderBook.tsx           # 买卖盘展示
│   ├── TradeForm.tsx           # 下单表单（签名 + 提交）
│   ├── MyOrders.tsx            # 我的订单与撤单
│   ├── MarketCreator.tsx       # 快速创建市场（测试）
│   └── StatsPanel.tsx          # 系统统计 & 倒计时
├── hooks/                      # 可选：封装余额/订单/市场查询
├── lib/ethers.ts               # provider、合约实例、签名工具
└── App.tsx                     # 页面布局与状态管理
```

布局建议：
- **左侧**：账户面板、入/出金、快速创建市场  
- **中间**：市场列表 → 订单簿 + 下单表单（选中市场时显示）  
- **右侧**：我的订单、系统统计（撮合/Relayer/MarketManager）  

---

## 2. 依赖配置

### 2.1 环境变量 (`apps/web/.env.development`)
```bash
VITE_API_URL=http://localhost:8080
VITE_RPC_URL=https://rpc-testnet.socrateschain.org
VITE_CHAIN_ID=1111111

# 内置测试账号（来自 addresses.json）— 仅限本地演示
VITE_DEMO_TRADER_ADDRESS=0xe40a34B77CBf15b49F6981e4236c76c2f096D261
VITE_DEMO_TRADER_PK=0x5cdd95739afcbbff215713d1f43bdda57805eca339f4025bff6f78109d766560
VITE_LIQUIDITY_PROVIDER_ADDRESS=0x44ffe865Ed0807D95be110E58B673111B702a122
VITE_LIQUIDITY_PROVIDER_PK=0xbdaf9384fcdbcfc432001bfec2713e81ffbae2cb617305a8d765f17bfb28ae1c
VITE_MARKET_CREATOR_PK=0xb304b6c6a8ed29942c2414d1dd2aaa9817aa5ff42f80e5634e2b1e1d8fc63f47 # 仅限本地
```

### 2.2 合约常量 (`lib/contracts.ts`)
```ts
export const USDC_ADDRESS = "0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce";
export const SETTLEMENT_ADDRESS = "0xc73967F29E6dB5b7b61a616d030a9180e8617464";
export const MARKET_REGISTRY_ADDRESS = "0xE108166156626bD94e5686847F7a29E044D2b73c";
export const ORACLE_ADAPTER_ADDRESS = "0xad3F4094cfA60d2503057e26EbeAf241AC7434E8";
export const CTF_ADDRESS = "0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665";
export const CHAIN_ID = 1111111;
```

---

## 3. 核心功能实现要点

### 3.1 账户与余额
- 使用演示钱包：`new ethers.Wallet(privateKey, provider)`  
- 显示信息：
  - `USDC balance`: `usdc.balanceOf(address)`
  - `Collateral balance`: `settlement.collateralBalances(address, USDC_ADDRESS)`
  - `CTF positions`: `ctf.balanceOf(address, positionId)`
- 支持 MetaMask 连接，允许用户切换到自有测试账号。

### 3.2 入金 / 出金
```ts
await usdc.connect(signer).approve(SETTLEMENT_ADDRESS, amount);
await settlement.connect(signer).depositCollateral(USDC_ADDRESS, amount);

await settlement.connect(signer).withdrawCollateral(USDC_ADDRESS, amount);
```
- UI 提供输入框 + “一键 50 USDC”按钮，操作前提示确认账户。

### 3.3 市场列表
- `GET /api/v1/markets` 获取全部市场  
- `GET /api/v1/markets/unresolved` 过滤进行中  
- 显示：`marketId`, `startTime`, `endTime`, `timeframe`, `resolved`, `winningOutcome`
- 选中后触发订单簿 & 下单表单刷新。

### 3.4 订单簿与下单
#### 订单簿
`GET /api/v1/orderbook/:marketId/:outcome`
- bids/asks 表格（价格、数量、挂单数）  
- 每 5 秒轮询或手动刷新。

#### 下单流程
1. 生成 `OrderV2`（参考 `services/matcher/src/types.ts`）
2. `ethers.Wallet.signTypedData(domain, ORDER_TYPES, orderData)`  
   - `domain` 与 `hashOrder` 同步，`chainId`=1111111，`verifyingContract`=Settlement
3. POST `/api/v1/orders`  
   ```json
   {
     "order": { ... }, "signature": "0x...", "side": "buy" // or "sell"
   }
   ```
4. 提示提交成功后存入本地 state（便于“我的订单”展示）

### 3.5 我的订单 / 撤单
- 本地维护已提交订单列表（可存 `orderId`, `marketId`, `outcome`）  
- 状态查询：`GET /api/v1/orders/:orderId`  
- 撤单：`DELETE /api/v1/orders/:orderId?marketId=...&outcome=...`  
- 撤单后刷新订单簿与状态。

### 3.6 系统统计与撮合监控
- `GET /api/v1/stats` → 显示 `totalOrders`, `totalMatches` 等  
- 可选：展示 Relayer 待提交数、永久失败笔数（未来对接后端统计）
- 更新频次：30 秒

### 3.7 结算与盈亏确认
- 倒计时：`endTime + resolveBuffer - now`  
- 在 MarketManager 解析后，刷新市场详情，显示 `winningOutcome`、`startPrice`、`endPrice`
- 查询个人仓位（CTF `balanceOf`），提示“赎回”按钮：
  ```ts
  await ctf.connect(signer).redeemPositions(USDC_ADDRESS, conditionId, [1, 2]);
  ```
- 赎回完成后更新 USDC/Collateral 余额。

### 3.8 快速创建市场（测试功能）
> 仅在开发模式启用，UI 显著标注“仅测试账号使用”。

```ts
const creator = new ethers.Wallet(import.meta.env.VITE_MARKET_CREATOR_PK, provider);
const registry = new ethers.Contract(MARKET_REGISTRY_ADDRESS, abi, creator);

const now = Math.floor(Date.now() / 1000);
const nextMinute = Math.ceil((now + 60) / 60) * 60; // 下个整分 + 60s 缓冲
await registry.createMarket(
  USDC_ADDRESS,
  ORACLE_ADAPTER_ADDRESS,
  nextMinute,
  0, // BTC_UPDOWN
  5  // 5 分钟
);
```
- 成功后弹出 `marketId`, `startTime`，并提示“MarketManager 将自动跟踪解析”。

---

## 4. UI 流程范例

1. **选择账户**：默认加载测试钱包，显示余额与仓位。  
2. **入金**：点击“存入 50 USDC”，等待交易完成。  
3. **选择市场**：在列表中选择一个即将开始/进行中的市场，查看倒计时。  
4. **下单**：输入价格、数量 → 签名提交 → “我的订单”显示 `active` 状态。  
5. **撮合观察**：匹配出现后，在订单簿/统计面板看到变化。  
6. **等待结算**：市场到期后自动解析 → UI 显示 `UP/DOWN` 胜方。  
7. **赎回/出金**：点击赎回，再点击提现抵押，确认最终 USDC 余额变化。  
8. **创建新市场（可选）**：在顶部点击“创建 5 分钟市场”，验证自动发现流程。

---

## 5. 技术提示与安全注意

- **演示私钥仅限本地调试**：上线前必须移除，改用用户钱包或受控后端。
- **市场创建需权限**：务必标明仅限运营测试账号使用，避免误操作。
- **签名结构严格对齐**：`OrderV2` 字段与后端/合约必须一致，特别是 `pricePips`/`amount` 类型。
- **错误处理**：在每个链上交互周围添加 `try/catch` 与提示，避免 UI “卡住”。
- **依赖注入**：建议集中管理合约实例，随时可切换 provider（e.g. `ethers.JsonRpcProvider` 与 MetaMask provider）。

---

## 6. 后续优化方向（可选）

- 引入 Zustand/Redux 管理全局状态（订单列表、市场缓存）。
- 订单簿 WebSocket 推送（待后端支持）。
- 模拟对手方下单按钮，帮助快速撮合测试。
- 盈亏可视化：记录每笔交易与最终收益。
- 测试工具栏：暴露 `resolveMarket`、`redeemPositions` 快捷按钮，方便 QA。

---

使用以上指南，可快速构建一个覆盖核心生命周期的 `apps/web` 演示界面，配合现有后端服务完成测试与生产演练。若需要进一步迭代，可在此基础上扩展实时推送、订单历史持久化、移动端等高级功能。祝开发顺利！🚀
