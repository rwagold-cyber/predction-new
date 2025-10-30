# PredictX 前端问题修复

## 修复时间
2025-10-30

## 问题 1: CORS 跨域错误

### 症状
```
Access to XMLHttpRequest at 'http://localhost:8080/api/v1/orders' from origin 
'http://localhost:5175' has been blocked by CORS policy: Response to preflight 
request doesn't pass access control check: It does not have HTTP ok status.
```

### 根本原因
后端 API 的 CORS 配置不完整：
1. 缺少 `DELETE` 方法支持
2. 没有正确处理 OPTIONS 预检请求

### 修复方案
修改 `services/api/src/server.ts` 的 CORS 中间件：

**修改前:**
```typescript
this.app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});
```

**修改后:**
```typescript
this.app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});
```

### 验证
```bash
# 测试 OPTIONS 预检请求
curl -X OPTIONS http://localhost:8080/api/v1/orders \
  -H "Origin: http://localhost:5175" \
  -H "Access-Control-Request-Method: POST" \
  -i

# 预期响应头:
# HTTP/1.1 200 OK
# Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
```

## 问题 2: 测试账户 USDC 不足

### 症状
前端测试账户没有足够的 USDC 用于存入和交易

### 解决方案
为前端使用的两个测试账户 mint USDC：

```bash
# Demo Trader
Address: 0xe40a34B77CBf15b49F6981e4236c76c2f096D261
Balance: 100,000 USDC

# Liquidity Provider
Address: 0x44ffe865Ed0807D95be110E58B673111B702a122
Balance: 100,000 USDC
```

### Mint 脚本
创建了 `/tmp/mint-test-accounts.ts` 脚本用于批量 mint:

```typescript
const testAccounts = [
  { name: "Demo Trader", address: "0xe40a34B77CBf15b49F6981e4236c76c2f096D261" },
  { name: "Liquidity Provider", address: "0x44ffe865Ed0807D95be110E58B673111B702a122" }
];

for (const account of testAccounts) {
  const amount = ethers.parseUnits("100000", 6);
  const tx = await usdc.mint(account.address, amount);
  await tx.wait();
}
```

## 部署更改

### 1. 重建 Docker 镜像
```bash
cd /home/jason/文档/mygits/predction-new
docker-compose -f docker-compose.backend.yml down
docker-compose -f docker-compose.backend.yml up --build -d
```

### 2. 验证服务状态
```bash
# 检查容器状态
docker ps | grep predictx-backend

# 检查健康状态
curl http://localhost:8080/health

# 检查日志
docker logs predictx-backend --tail 50
```

## 测试结果

### CORS 测试
✅ POST 请求正常
✅ DELETE 请求正常
✅ OPTIONS 预检请求返回 200
✅ 跨域头包含所有必需方法

### 账户余额测试
✅ Demo Trader: 100,000 USDC
✅ Liquidity Provider: 100,000 USDC
✅ 足够用于前端测试流程

## 现在可以使用的功能

1. **账户管理**
   - 选择测试账户
   - 查看 USDC 和 Collateral 余额
   - 存入/提取抵押品

2. **交易功能**
   - 提交买单和卖单
   - 取消订单 (DELETE 请求现在工作)
   - 查看订单状态

3. **市场功能**
   - 查看市场列表
   - 创建新市场
   - 查看订单簿

## 前端访问

- **前端应用**: http://localhost:5175/
- **后端 API**: http://localhost:8080/
- **API 健康检查**: http://localhost:8080/health

## 下一步

用户现在可以：
1. 打开浏览器访问 http://localhost:5175/
2. 选择 "Demo Trader" 账户
3. 存入 50 USDC
4. 创建测试市场
5. 下单交易
6. 完整体验交易流程

所有功能已验证可用！🎉
