# 前端文档

本文档描述了 PredictX 预言市场平台的前端架构、组件和集成指南。

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                         前端                                 │
│                   (React + ethers.js)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   账户       │  │   市场       │  │    交易      │      │
│  │   面板       │  │   列表       │  │    表单      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  订单簿      │  │  我的订单    │  │  持仓        │      │
│  │  显示        │  │  面板        │  │  面板        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────┬─────────────────────────────────────┬──────────┘
             │                                     │
             ▼                                     ▼
      REST API 服务器                         智能合约
    (订单提交)                              (钱包交互)
```

---

## 技术栈

- **框架**: React 18 + Vite
- **语言**: TypeScript
- **区块链**: ethers.js v6
- **样式**: 内联 CSS (当前), 建议迁移到 Tailwind/MUI
- **状态管理**: React useState/useEffect (建议迁移到 Zustand/Redux)

---

## 项目结构

```
apps/web/
├── src/
│   ├── components/
│   │   ├── AccountPanel.tsx      # 账户选择、余额、存取款
│   │   ├── MarketCreator.tsx     # 快速创建市场 (仅测试用)
│   │   ├── TradeForm.tsx         # 买卖订单提交
│   │   ├── OrderBook.tsx         # 订单簿显示
│   │   ├── MyOrders.tsx          # 用户活跃订单
│   │   ├── PositionPanel.tsx     # 用户 CTF 持仓
│   │   ├── RedemptionPanel.tsx   # 赎回获胜持仓
│   │   └── AllPositionsPanel.tsx # 所有市场的持仓
│   ├── lib/
│   │   ├── contracts.ts          # 合约地址和 ABI
│   │   └── ethers.ts             # ethers.js 工具函数和辅助函数
│   ├── App.tsx                   # 主应用组件
│   └── main.tsx                  # 应用入口点
├── .env.development              # 开发环境变量
└── package.json
```

---

## 安装与配置

### 前置条件

- Node.js >= 18
- pnpm >= 8

### 安装依赖

```bash
cd apps/web
pnpm install
```

### 配置环境

**文件**: `apps/web/.env.development`

```bash
# API 配置
VITE_API_URL=http://localhost:8080

# 区块链配置
VITE_RPC_URL=https://rpc-testnet.socrateschain.org
VITE_CHAIN_ID=1111111

# 演示账户 (仅供测试 - 生产环境中请勿使用)
VITE_DEMO_TRADER_ADDRESS=0xe40a34B77CBf15b49F6981e4236c76c2f096D261
VITE_DEMO_TRADER_PK=0x5cdd95739afcbbff215713d1f43bdda57805eca339f4025bff6f78109d766560

VITE_LIQUIDITY_PROVIDER_ADDRESS=0x44ffe865Ed0807D95be110E58B673111B702a122
VITE_LIQUIDITY_PROVIDER_PK=0xbdaf9384fcdbcfc432001bfec2713e81ffbae2cb617305a8d765f17bfb28ae1c

VITE_MARKET_CREATOR_PK=0xb304b6c6a8ed29942c2414d1dd2aaa9817aa5ff42f80e5634e2b1e1d8fc63f47
```

**警告**: 演示私钥仅供本地测试使用。生产部署前请删除。

### 启动开发服务器

```bash
pnpm dev
```

应用将在 `http://localhost:5173` (或下一个可用端口) 上运行。

---

## 核心组件

### AccountPanel.tsx

**用途**: 管理用户账户、显示余额、存取抵押品

**主要功能**:
- 在演示账户之间切换或连接 MetaMask
- 显示 USDC 余额、已存入抵押品和 CTF 持仓
- 向 Settlement 合约存入/提取 USDC

**用法**:
```tsx
<AccountPanel
  account={selectedAccount}
  onAccountChange={setSelectedAccount}
/>
```

**关键函数**:

```typescript
// 加载余额
const loadBalances = async () => {
  const usdcBalance = await usdc.balanceOf(account.address);
  const collateralBalance = await settlement.collateralBalances(
    account.address,
    USDC_ADDRESS
  );
};

// 存入抵押品
const handleDeposit = async (amount: string) => {
  const wallet = createWallet(account.privateKey);
  const usdc = getUSDC(wallet);
  const settlement = getSettlement(wallet);

  await usdc.approve(SETTLEMENT_ADDRESS, parseUSDC(amount));
  await settlement.depositCollateral(USDC_ADDRESS, parseUSDC(amount));
};

// 提取抵押品
const handleWithdraw = async (amount: string) => {
  const wallet = createWallet(account.privateKey);
  const settlement = getSettlement(wallet);

  await settlement.withdrawCollateral(USDC_ADDRESS, parseUSDC(amount));
};
```

---

### MarketCreator.tsx

**用途**: 快速创建市场用于测试 (仅管理员/测试使用)

**主要功能**:
- 创建自定义时间范围的 BTC 涨跌市场
- 自动计算下一个分钟对齐的开始时间
- 显示已创建的市场详情

**用法**:
```tsx
<MarketCreator onMarketCreated={refreshMarkets} />
```

**关键函数**:

```typescript
const handleCreateMarket = async (timeframe: number) => {
  const wallet = createWallet(import.meta.env.VITE_MARKET_CREATOR_PK);
  const registry = getMarketRegistry(wallet);

  // 计算下一个分钟对齐的时间戳 + 缓冲
  const now = Math.floor(Date.now() / 1000);
  const nextMinute = Math.ceil((now + 60) / 60) * 60;

  const tx = await registry.createMarket(
    USDC_ADDRESS,
    ORACLE_ADAPTER_ADDRESS,
    nextMinute,
    0, // BTC_UPDOWN
    timeframe
  );

  const receipt = await tx.wait();
  // 解析 MarketCreated 事件获取 marketId
};
```

**警告**: 此组件应仅在开发模式下对授权账户可见。

---

### TradeForm.tsx

**用途**: 为特定市场结果提交买卖订单

**主要功能**:
- 提交买入或卖出订单
- 价格输入 (0-1 范围, 转换为 BPS)
- 金额输入及快速选择按钮
- 成本/利润计算预览
- EIP-712 订单签名

**用法**:
```tsx
<TradeForm
  market={selectedMarket}
  account={currentAccount}
  outcome={1} // 0=跌, 1=涨
  side="buy" // 或 "sell"
  onOrderSubmitted={handleOrderSubmitted}
/>
```

**订单提交流程**:

```typescript
const handleSubmit = async () => {
  // 1. 从私钥创建钱包
  const wallet = createWallet(account.privateKey);

  // 2. 准备订单
  const order: OrderV2 = {
    maker: account.address,
    marketId: market.id,
    conditionId: market.conditionId,
    outcome: outcome, // 0=跌, 1=涨
    collateral: USDC_ADDRESS,
    pricePips: parsePriceToPips(price), // 将 0.55 → "5500"
    amount: parseUSDC(amount).toString(), // 将 100 → "100000000"
    makerFeeBps: 30, // 0.3%
    takerFeeBps: 30, // 0.3%
    expiry: Math.floor(Date.now() / 1000) + 86400, // 24小时
    salt: ethers.hexlify(ethers.randomBytes(16)),
    nonce: Math.floor(Date.now() / 1000),
    mintOnFill: true, // V2 中始终为 true
    allowedTaker: '0x0000000000000000000000000000000000000000',
    chainId: CHAIN_ID,
    verifyingContract: SETTLEMENT_ADDRESS,
  };

  // 3. 使用 EIP-712 签名订单
  const signature = await signOrder(wallet, order);

  // 4. 提交到 API
  const response = await fetch(`${API_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order, signature, side }),
  });

  const data = await response.json();

  if (data.success) {
    onOrderSubmitted({
      orderId: data.orderId,
      marketId: market.id,
      outcome,
      side,
      pricePips: order.pricePips,
      amount: order.amount,
      timestamp: Date.now(),
    });
  }
};
```

**价格转换**:
```typescript
// 用户输入: 0.55 (55%)
// 转换为 BPS: 5500
function parsePriceToPips(price: string): string {
  return Math.round(parseFloat(price) * 10000).toString();
}

// 将 BPS 显示为百分比
function formatPrice(pricePips: string): string {
  return (parseInt(pricePips) / 100).toFixed(2) + '%';
}
```

---

### OrderBook.tsx

**用途**: 显示市场结果的当前订单簿 (买单和卖单)

**主要功能**:
- 实时订单簿显示 (每 5 秒轮询)
- 价格级别聚合
- 每个价格级别的订单数量
- 每个级别的总交易量

**用法**:
```tsx
<OrderBook
  marketId={market.id}
  outcome={1}
/>
```

**数据获取**:

```typescript
const loadOrderbook = async () => {
  const response = await fetch(
    `${API_URL}/api/v1/orderbook/${marketId}/${outcome}`
  );
  const data = await response.json();

  setBids(data.bids); // [{ price, amount, orderCount }]
  setAsks(data.asks);
};

// 每 5 秒自动刷新
useEffect(() => {
  loadOrderbook();
  const interval = setInterval(loadOrderbook, 5000);
  return () => clearInterval(interval);
}, [marketId, outcome]);
```

---

### MyOrders.tsx

**用途**: 显示用户的活跃订单及取消功能

**主要功能**:
- 显示当前账户提交的所有订单
- 显示订单状态 (活跃/已成交/已取消)
- 取消活跃订单
- 按市场/结果筛选

**用法**:
```tsx
<MyOrders
  account={currentAccount}
  orders={submittedOrders}
  onOrderCancelled={refreshOrders}
/>
```

**订单取消**:

```typescript
const handleCancelOrder = async (order) => {
  const response = await fetch(
    `${API_URL}/api/v1/orders/${order.orderId}?marketId=${order.marketId}&outcome=${order.outcome}`,
    { method: 'DELETE' }
  );

  const data = await response.json();

  if (data.success) {
    onOrderCancelled(order.orderId);
  }
};
```

---

### PositionPanel.tsx

**用途**: 显示用户的 CTF 持仓余额

**主要功能**:
- 显示每个市场的跌和涨代币余额
- 实时余额更新
- 持仓价值计算

**用法**:
```tsx
<PositionPanel
  account={currentAccount}
  markets={allMarkets}
/>
```

**持仓查询**:

```typescript
const loadPositions = async () => {
  const ctf = getCTF(provider);
  const positions = [];

  for (const market of markets) {
    // 查询跌持仓
    const downPositionId = getPositionId(market.conditionId, 0);
    const downBalance = await ctf.balanceOf(account.address, downPositionId);

    // 查询涨持仓
    const upPositionId = getPositionId(market.conditionId, 1);
    const upBalance = await ctf.balanceOf(account.address, upPositionId);

    positions.push({
      marketId: market.id,
      downBalance: formatUnits(downBalance, 6),
      upBalance: formatUnits(upBalance, 6),
    });
  }

  setPositions(positions);
};
```

**持仓 ID 计算**:

```typescript
import { solidityPackedKeccak256 } from 'ethers';

function getPositionId(conditionId: string, outcome: number): string {
  const indexSet = outcome === 0 ? 1 : 2; // 1 表示跌, 2 表示涨

  const collectionId = solidityPackedKeccak256(
    ['bytes32', 'uint256'],
    [conditionId, indexSet]
  );

  const positionId = solidityPackedKeccak256(
    ['address', 'bytes32'],
    [USDC_ADDRESS, collectionId]
  );

  return positionId;
}
```

---

### RedemptionPanel.tsx

**用途**: 在市场解决后赎回获胜持仓

**主要功能**:
- 仅显示可赎回持仓 (已解决的市场及获胜结果)
- 显示潜在收益
- 一键赎回

**用法**:
```tsx
<RedemptionPanel
  account={currentAccount}
  markets={allMarkets}
/>
```

**赎回流程**:

```typescript
const loadRedeemablePositions = async () => {
  const ctf = getCTF(provider);
  const redeemable = [];

  // 仅筛选已解决的市场
  const resolvedMarkets = markets.filter(m => m.resolved && m.winningOutcome !== null);

  for (const market of resolvedMarkets) {
    for (let outcome = 0; outcome <= 1; outcome++) {
      const positionId = getPositionId(market.conditionId, outcome);
      const balance = await ctf.balanceOf(account.address, positionId);

      // 仅包含余额非零的获胜持仓
      if (balance > 0n && outcome === market.winningOutcome) {
        redeemable.push({
          marketId: market.id,
          conditionId: market.conditionId,
          outcome,
          balance: formatUnits(balance, 6),
          payout: formatUnits(balance, 6), // 获胜结果为 1:1
        });
      }
    }
  }

  setRedeemablePositions(redeemable);
};

const handleRedeem = async (position) => {
  const wallet = createWallet(account.privateKey);
  const ctf = getCTF(wallet);

  const indexSet = position.outcome === 0 ? 1 : 2;

  await ctf.redeemPositions(
    USDC_ADDRESS,
    position.conditionId,
    [indexSet]
  );

  // 刷新余额
  await loadRedeemablePositions();
};
```

---

## 工具函数

### lib/ethers.ts

**用途**: 集中的 ethers.js 工具函数和合约辅助函数

**关键函数**:

```typescript
// 从私钥创建钱包
export function createWallet(privateKey: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL);
  return new ethers.Wallet(privateKey, provider);
}

// 获取合约实例
export function getUSDC(signerOrProvider: any) {
  return new ethers.Contract(USDC_ADDRESS, USDC_ABI, signerOrProvider);
}

export function getSettlement(signerOrProvider: any) {
  return new ethers.Contract(SETTLEMENT_ADDRESS, SETTLEMENT_ABI, signerOrProvider);
}

export function getCTF(signerOrProvider: any) {
  return new ethers.Contract(CTF_ADDRESS, CTF_ABI, signerOrProvider);
}

export function getMarketRegistry(signerOrProvider: any) {
  return new ethers.Contract(MARKET_REGISTRY_ADDRESS, REGISTRY_ABI, signerOrProvider);
}

// 格式化 USDC 金额
export function parseUSDC(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}

export function formatUSDC(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

// 价格转换
export function parsePriceToPips(price: string): string {
  return Math.round(parseFloat(price) * 10000).toString();
}

export function formatPriceFromPips(pricePips: string): string {
  return (parseInt(pricePips) / 10000).toString();
}

// EIP-712 订单签名
export async function signOrder(
  wallet: ethers.Wallet,
  order: OrderV2
): Promise<string> {
  const domain = {
    name: 'PredictXSettlementV2',
    version: '1',
    chainId: parseInt(order.chainId.toString()),
    verifyingContract: order.verifyingContract,
  };

  const types = {
    OrderV2: [
      { name: 'maker', type: 'address' },
      { name: 'marketId', type: 'string' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'outcome', type: 'uint8' },
      { name: 'collateral', type: 'address' },
      { name: 'pricePips', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'makerFeeBps', type: 'uint16' },
      { name: 'takerFeeBps', type: 'uint16' },
      { name: 'expiry', type: 'uint256' },
      { name: 'salt', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'mintOnFill', type: 'bool' },
      { name: 'allowedTaker', type: 'address' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
  };

  return await wallet.signTypedData(domain, types, order);
}
```

---

### lib/contracts.ts

**用途**: 合约地址和常量

```typescript
export const USDC_ADDRESS = '0x0CE332cbf8AA68675C541BBBCe9D6E4a3a4778Ce';
export const CTF_ADDRESS = '0xBaA6292b5BDf0F7D73e2c2b66eF68C8764417665';
export const SETTLEMENT_ADDRESS = '0xc73967F29E6dB5b7b61a616d030a9180e8617464';
export const MARKET_REGISTRY_ADDRESS = '0xE108166156626bD94e5686847F7a29E044D2b73c';
export const ORACLE_ADAPTER_ADDRESS = '0xad3F4094cfA60d2503057e26EbeAf241AC7434E8';
export const CHAIN_ID = 1111111;

export const USDC_ABI = [ /* ... */ ];
export const SETTLEMENT_ABI = [ /* ... */ ];
export const CTF_ABI = [ /* ... */ ];
export const MARKET_REGISTRY_ABI = [ /* ... */ ];
```

---

## 用户工作流程

### 1. 完整交易流程

**步骤 1: 选择账户**
```
用户从下拉菜单中选择 "演示交易员" 或 "流动性提供者"
→ 显示 USDC 余额、已存入抵押品、CTF 持仓
```

**步骤 2: 存入抵押品**
```
用户点击 "存入 50 USDC"
→ 批准 USDC 支出
→ 调用 settlement.depositCollateral()
→ 等待确认
→ 刷新余额
```

**步骤 3: 选择市场**
```
用户从市场列表中选择一个活跃市场
→ 显示市场详情、到期倒计时
→ 加载两个结果的订单簿
```

**步骤 4: 提交订单**
```
用户输入:
- 价格: 0.55 (55%)
- 金额: 100 USDC
- 方向: 买入
- 结果: 涨

→ 签署 EIP-712 订单
→ 提交到 API
→ 订单显示在 "我的订单" 面板
→ 订单出现在订单簿中
```

**步骤 5: 等待匹配**
```
撮合器找到交叉订单
→ 中继器提交成交到区块链
→ 用户收到涨代币
→ 持仓显示在 "持仓面板"
```

**步骤 6: 等待市场解决**
```
市场到期
→ MarketManager 解决市场
→ 市场显示获胜结果
→ 获胜持仓显示在 "赎回面板"
```

**步骤 7: 赎回收益**
```
用户点击获胜持仓的 "赎回"
→ 调用 ctf.redeemPositions()
→ 收到 USDC 返回到已存入余额
```

**步骤 8: 提取**
```
用户点击 "全部提取"
→ 调用 settlement.withdrawCollateral()
→ USDC 出现在钱包余额中
```

---

### 2. MetaMask 集成 (生产环境推荐)

**连接钱包**:
```typescript
const connectWallet = async () => {
  if (typeof window.ethereum !== 'undefined') {
    try {
      // 请求账户访问
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      // 检查网络
      const chainId = await window.ethereum.request({
        method: 'eth_chainId',
      });

      if (chainId !== '0x10F447') { // 1111111 的十六进制
        alert('请切换到 Socrates 测试网');
        return;
      }

      // 创建 provider 和 signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      setAccount({
        address: accounts[0],
        signer,
      });
    } catch (error) {
      console.error('连接钱包失败:', error);
    }
  } else {
    alert('请安装 MetaMask');
  }
};
```

**网络切换**:
```typescript
const switchToSocrates = async () => {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x10F447' }], // 1111111
    });
  } catch (switchError: any) {
    // 网络未添加,添加它
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x10F447',
          chainName: 'Socrates Testnet',
          rpcUrls: ['https://rpc-testnet.socrateschain.org'],
          nativeCurrency: {
            name: 'SOCRATES',
            symbol: 'SOC',
            decimals: 18,
          },
          blockExplorerUrls: ['https://explorer-testnet.socrateschain.org'],
        }],
      });
    }
  }
};
```

---

## 样式

### 当前方案

当前实现使用内联 CSS。这对于原型设计是可以接受的,但不建议用于生产环境。

**示例**:
```tsx
<div style={{ padding: '20px', border: '2px solid #4CAF50', borderRadius: '8px' }}>
  <h3 style={{ margin: '0 0 15px 0', color: '#4CAF50' }}>买入涨</h3>
  <input type="number" style={{ width: '100%', padding: '8px' }} />
</div>
```

### 推荐方案

**方案 1: Tailwind CSS**
```bash
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

```tsx
<div className="p-5 border-2 border-green-500 rounded-lg">
  <h3 className="mb-4 text-green-500 font-bold">买入涨</h3>
  <input type="number" className="w-full p-2 border rounded" />
</div>
```

**方案 2: Material-UI**
```bash
pnpm add @mui/material @emotion/react @emotion/styled
```

```tsx
import { Box, Typography, TextField } from '@mui/material';

<Box sx={{ p: 2, border: '2px solid green', borderRadius: 1 }}>
  <Typography variant="h6" color="green">买入涨</Typography>
  <TextField fullWidth type="number" />
</Box>
```

---

## 状态管理

### 当前方案

当前实现使用 React 内置的 `useState` 和 `useEffect` hooks。这适用于小型应用,但随着复杂性增加会变得难以管理。

### 推荐方案

**方案 1: Zustand (轻量级)**

```bash
pnpm add zustand
```

```typescript
// store.ts
import create from 'zustand';

interface AppState {
  account: Account | null;
  markets: Market[];
  orders: Order[];
  setAccount: (account: Account | null) => void;
  setMarkets: (markets: Market[]) => void;
  addOrder: (order: Order) => void;
}

export const useStore = create<AppState>((set) => ({
  account: null,
  markets: [],
  orders: [],
  setAccount: (account) => set({ account }),
  setMarkets: (markets) => set({ markets }),
  addOrder: (order) => set((state) => ({ orders: [...state.orders, order] })),
}));

// 在组件中使用
const { account, setAccount } = useStore();
```

**方案 2: Redux Toolkit (功能完整)**

```bash
pnpm add @reduxjs/toolkit react-redux
```

---

## 实时更新

### 当前方案

基于轮询的更新,使用 `setInterval`:

```typescript
useEffect(() => {
  const interval = setInterval(loadOrderbook, 5000);
  return () => clearInterval(interval);
}, []);
```

### 推荐方案

**WebSocket 集成** (需要后端 WebSocket 支持):

```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function useOrderbook(marketId: string, outcome: number) {
  const [orderbook, setOrderbook] = useState({ bids: [], asks: [] });

  useEffect(() => {
    const socket = io('http://localhost:8080');

    // 订阅订单簿更新
    socket.emit('subscribe', { marketId, outcome });

    // 监听更新
    socket.on('orderbook_update', (data) => {
      if (data.marketId === marketId && data.outcome === outcome) {
        setOrderbook(data.orderbook);
      }
    });

    return () => {
      socket.emit('unsubscribe', { marketId, outcome });
      socket.disconnect();
    };
  }, [marketId, outcome]);

  return orderbook;
}
```

---

## 错误处理

### 当前方案

基本的 try-catch 加状态消息:

```typescript
try {
  const response = await fetch('/api/v1/orders', { ... });
  const data = await response.json();

  if (data.success) {
    setStatus('成功!');
  } else {
    setStatus(`错误: ${data.error}`);
  }
} catch (error: any) {
  setStatus(`错误: ${error.message}`);
}
```

### 推荐方案

**集中式错误处理器**:

```typescript
// lib/errors.ts
export class APIError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function handleError(error: any): string {
  if (error instanceof APIError) {
    switch (error.code) {
      case 'INVALID_SIGNATURE':
        return '订单签名无效。请重试。';
      case 'ORDER_EXPIRED':
        return '订单已过期。请创建新订单。';
      case 'INSUFFICIENT_BALANCE':
        return '余额不足。请存入更多抵押品。';
      default:
        return error.message;
    }
  }

  if (error.code === 'NETWORK_ERROR') {
    return '网络错误。请检查您的连接。';
  }

  return '发生意外错误。';
}

// 使用
try {
  await submitOrder(order);
} catch (error) {
  const message = handleError(error);
  toast.error(message); // 使用 toast 库
}
```

---

## 测试

### 单元测试

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom
```

```typescript
// TradeForm.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TradeForm from './TradeForm';

describe('TradeForm', () => {
  it('验证价格输入', () => {
    const { getByLabelText } = render(<TradeForm {...props} />);

    const priceInput = getByLabelText('价格');
    fireEvent.change(priceInput, { target: { value: '1.5' } });

    expect(screen.getByText('价格必须在 0 到 1 之间')).toBeInTheDocument();
  });
});
```

---

## 性能优化

### 代码分割

```typescript
// 懒加载组件
import { lazy, Suspense } from 'react';

const TradeForm = lazy(() => import('./components/TradeForm'));
const OrderBook = lazy(() => import('./components/OrderBook'));

function App() {
  return (
    <Suspense fallback={<div>加载中...</div>}>
      <TradeForm {...props} />
      <OrderBook {...props} />
    </Suspense>
  );
}
```

### 记忆化

```typescript
import { memo, useMemo, useCallback } from 'react';

// 记忆化昂贵的计算
const OrderBook = memo(({ bids, asks }) => {
  const totalVolume = useMemo(() => {
    return bids.reduce((sum, bid) => sum + parseInt(bid.amount), 0);
  }, [bids]);

  return <div>总交易量: {totalVolume}</div>;
});

// 记忆化回调
const handleOrderSubmit = useCallback((order) => {
  submitOrder(order);
}, []);
```

---

## 部署

### 生产构建

```bash
pnpm build
```

输出到 `apps/web/dist/`。

### 环境变量

创建 `.env.production`:

```bash
VITE_API_URL=https://api.predictx.com
VITE_RPC_URL=https://rpc-testnet.socrateschain.org
VITE_CHAIN_ID=1111111
```

**从生产构建中删除所有演示私钥!**

### 托管选项

**方案 1: Vercel**
```bash
pnpm add -g vercel
vercel --prod
```

**方案 2: Netlify**
```bash
pnpm add -g netlify-cli
netlify deploy --prod
```

**方案 3: Docker**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm add -g serve
CMD ["serve", "-s", "dist", "-l", "3000"]
```

---

## 未来增强

### 高优先级

1. **移除演示账户**: 仅使用 MetaMask
2. **添加加载状态**: 骨架屏、加载指示器
3. **改进错误处理**: Toast 通知、详细错误消息
4. **添加 WebSocket**: 实时订单簿更新
5. **响应式设计**: 移动端友好布局

### 中优先级

6. **高级交易界面**: TradingView 图表、深度图
7. **持仓管理**: 详细盈亏、持仓历史
8. **交易历史**: 用户过往订单和成交
9. **市场分析**: 交易量图表、价格历史

### 低优先级

10. **深色模式**: 主题切换
11. **多语言**: 国际化支持
12. **通知**: 成交/解决的浏览器通知
13. **投资组合仪表板**: 整体投资组合表现

---

有关后端 API 集成,请参阅 **BACKEND.md**。
有关智能合约交互,请参阅 **CONTRACTS.md**。
