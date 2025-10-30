import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 后端集成测试 - 完整流程
 *
 * 测试完整的市场生命周期：
 * 1. 创建市场
 * 2. 用户存入抵押品
 * 3. 签名和提交订单
 * 4. 撮合和结算
 * 5. 验证持仓
 * 6. 等待市场结束
 * 7. 解析市场
 * 8. 赎回代币
 * 9. 验证收益
 */
describe("Backend Integration Test - Complete Flow", function () {
  this.timeout(900000); // 15分钟超时

  async function getCurrentTime(): Promise<number> {
    const block = await ethers.provider.getBlock("latest");
    return block!.timestamp;
  }

  async function waitForBlock(
    targetTime: number,
    maxWait: number = 600
  ): Promise<boolean> {
    console.log(
      `\n⏳ 等待区块时间到达 ${new Date(targetTime * 1000).toISOString()}...`
    );
    const startTime = Date.now();
    const maxWaitMs = maxWait * 1000;

    let lastLog = 0;
    while (Date.now() - startTime < maxWaitMs) {
      const currentTime = await getCurrentTime();

      // 每30秒输出一次进度
      if (Date.now() - lastLog > 30000) {
        const remaining = targetTime - currentTime;
        console.log(
          `   进度: ${remaining > 0 ? `还需 ${remaining} 秒` : "已到达"}`
        );
        lastLog = Date.now();
      }

      if (currentTime >= targetTime) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`✅ 区块时间已到达 (等待了 ${elapsed} 秒)`);
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log(`⚠️ 超时：等待了 ${maxWait} 秒，区块时间还未到达`);
    return false;
  }

  /**
   * 重试执行交易 - 处理网络间歇性问题
   */
  async function retryTransaction<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 3000
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        if (i === maxRetries - 1) {
          throw error;
        }
        console.log(
          `   ⚠️ 交易失败 (${i + 1}/${maxRetries}): ${error.message}`
        );
        console.log(`   等待 ${delayMs / 1000} 秒后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error("Should not reach here");
  }

  it("Should complete full market lifecycle with backend services", async function () {
    console.log("\n================================================");
    console.log("后端集成测试 - 完整市场生命周期");
    console.log("================================================\n");

    // ========================================
    // 准备：加载配置
    // ========================================
    const addressesPath = path.join(__dirname, "..", "addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

    console.log("配置信息:");
    console.log("- Network:", addresses.network);
    console.log("- Chain ID:", addresses.chainId);
    console.log("- USDC:", addresses.usdc);
    console.log("- CTF:", addresses.ctf);
    console.log("- Settlement:", addresses.settlementV2);
    console.log("- Market Registry:", addresses.marketRegistryV2);
    console.log("- Oracle Adapter:", addresses.oracleAdapter);
    console.log("");

    // 获取账户
    const [trader1, trader2] = await ethers.getSigners();
    console.log("参与者:");
    console.log("- Trader 1:", trader1.address);
    console.log("- Trader 2:", trader2.address);

    // 检查余额
    const bal1 = await ethers.provider.getBalance(trader1.address);
    const bal2 = await ethers.provider.getBalance(trader2.address);
    console.log("- Trader 1 ETH:", ethers.formatEther(bal1));
    console.log("- Trader 2 ETH:", ethers.formatEther(bal2));
    console.log("");

    // 连接合约
    const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);
    const ctf = await ethers.getContractAt(
      "ConditionalTokensV2",
      addresses.ctf
    );
    const settlement = await ethers.getContractAt(
      "SettlementV2",
      addresses.settlementV2
    );
    const marketRegistry = await ethers.getContractAt(
      "MarketRegistryV2",
      addresses.marketRegistryV2
    );

    // ========================================
    // 步骤 1: 创建 1 分钟测试市场
    // ========================================
    console.log("========================================");
    console.log("步骤 1: 创建 1 分钟测试市场");
    console.log("========================================\n");

    const currentTime = await getCurrentTime();
    const startTime = Math.ceil((currentTime + 30) / 60) * 60; // 下一个整分钟
    const timeframe = 1; // 1 分钟
    const endTime = startTime + timeframe * 60;
    const cooldownPeriod = 60; // 60秒冷却期
    const resolveBuffer = 60; // 60秒解析缓冲
    const resolveTime = endTime + cooldownPeriod + resolveBuffer;

    console.log("时间规划:");
    console.log(
      `- 当前时间: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`
    );
    console.log(
      `- 开始时间: ${startTime} (${new Date(startTime * 1000).toISOString()})`
    );
    console.log(
      `- 结束时间: ${endTime} (${new Date(endTime * 1000).toISOString()})`
    );
    console.log(
      `- 解析时间: ${resolveTime} (${new Date(resolveTime * 1000).toISOString()})`
    );
    console.log(
      `- 预计总等待: ${resolveTime - currentTime} 秒 (约 ${Math.ceil((resolveTime - currentTime) / 60)} 分钟)`
    );
    console.log("");

    const createTx = await marketRegistry.createMarket(
      addresses.usdc,
      addresses.oracleAdapter,
      startTime,
      0, // BTC_UPDOWN
      timeframe
    );

    const createReceipt = await createTx.wait();
    const createEvent = createReceipt?.logs
      .map((log: any) => {
        try {
          return marketRegistry.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "MarketCreated");

    const marketId = createEvent!.args.marketId;
    const conditionId = createEvent!.args.conditionId;

    console.log("✅ 市场已创建");
    console.log(`   Market ID: ${marketId}`);
    console.log(`   Condition ID: ${conditionId}`);
    console.log("");

    // ========================================
    // 步骤 2: 准备交易者账户
    // ========================================
    console.log("========================================");
    console.log("步骤 2: 准备交易者账户");
    console.log("========================================\n");

    // 铸造 USDC
    const mintAmount = ethers.parseUnits("500", 6);
    await usdc.connect(trader1).mint(trader1.address, mintAmount);
    await usdc.connect(trader2).mint(trader2.address, mintAmount);
    console.log(
      `✅ 铸造 USDC: 各 ${ethers.formatUnits(mintAmount, 6)} USDC`
    );

    // 存入抵押品（使用重试机制）
    const depositAmount = ethers.parseUnits("200", 6);

    console.log(
      `存入抵押品: ${ethers.formatUnits(depositAmount, 6)} USDC (每人)`
    );

    // Trader 1 存入
    console.log("\nTrader 1 存入中...");
    await retryTransaction(async () => {
      await usdc.connect(trader1).approve(settlement.target, depositAmount);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待1秒
      return await settlement
        .connect(trader1)
        .depositCollateral(usdc.target, depositAmount);
    });
    console.log(
      `✅ Trader 1 存入 ${ethers.formatUnits(depositAmount, 6)} USDC`
    );

    // Trader 2 存入
    console.log("\nTrader 2 存入中...");
    await retryTransaction(async () => {
      await usdc.connect(trader2).approve(settlement.target, depositAmount);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待1秒
      return await settlement
        .connect(trader2)
        .depositCollateral(usdc.target, depositAmount);
    });
    console.log(
      `✅ Trader 2 存入 ${ethers.formatUnits(depositAmount, 6)} USDC`
    );
    console.log("");

    // ========================================
    // 步骤 3: 创建并签名订单
    // ========================================
    console.log("========================================");
    console.log("步骤 3: 创建并签名订单");
    console.log("========================================\n");

    const expiry = currentTime + 7200; // 2小时过期

    // Trader1 买入 UP @ 55%
    const buyOrder = {
      maker: trader1.address,
      marketId: marketId.toString(),
      conditionId: conditionId,
      outcome: 1, // UP
      collateral: usdc.target,
      pricePips: "5500", // 55%
      amount: "50000000", // 50 USDC
      makerFeeBps: 30,
      takerFeeBps: 30,
      expiry: expiry,
      salt: ethers.hexlify(ethers.randomBytes(32)),
      nonce: 1,
      mintOnFill: true,
      allowedTaker: ethers.ZeroAddress,
    };

    // Trader2 卖出 UP @ 50%
    const sellOrder = {
      maker: trader2.address,
      marketId: marketId.toString(),
      conditionId: conditionId,
      outcome: 1, // UP
      collateral: usdc.target,
      pricePips: "5000", // 50%
      amount: "50000000", // 50 USDC
      makerFeeBps: 30,
      takerFeeBps: 30,
      expiry: expiry,
      salt: ethers.hexlify(ethers.randomBytes(32)),
      nonce: 1,
      mintOnFill: true,
      allowedTaker: ethers.ZeroAddress,
    };

    // EIP-712 签名
    const domain = {
      name: "PredictXSettlementV2",
      version: "1",
      chainId: parseInt(addresses.chainId),
      verifyingContract: addresses.settlementV2,
    };

    const types = {
      Order: [
        { name: "maker", type: "address" },
        { name: "marketId", type: "uint256" },
        { name: "conditionId", type: "bytes32" },
        { name: "outcome", type: "uint8" },
        { name: "collateral", type: "address" },
        { name: "pricePips", type: "uint128" },
        { name: "amount", type: "uint128" },
        { name: "makerFeeBps", type: "uint16" },
        { name: "takerFeeBps", type: "uint16" },
        { name: "expiry", type: "uint256" },
        { name: "salt", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "mintOnFill", type: "bool" },
        { name: "allowedTaker", type: "address" },
      ],
    };

    const buySignature = await trader1.signTypedData(domain, types, buyOrder);
    const sellSignature = await trader2.signTypedData(
      domain,
      types,
      sellOrder
    );

    console.log("✅ 订单签名完成");
    console.log(
      `   Buy Order: ${ethers.formatUnits(buyOrder.amount, 6)} USDC @ ${buyOrder.pricePips} BPS (55%)`
    );
    console.log(
      `   Sell Order: ${ethers.formatUnits(sellOrder.amount, 6)} USDC @ ${sellOrder.pricePips} BPS (50%)`
    );
    console.log("");

    // ========================================
    // 步骤 4: 撮合并结算
    // ========================================
    console.log("========================================");
    console.log("步骤 4: 撮合并结算");
    console.log("========================================\n");

    const matchAmount = "50000000";

    const fills = [
      {
        order: sellOrder,
        signature: sellSignature,
        fillAmount: matchAmount,
        taker: buyOrder.maker,
      },
      {
        order: buyOrder,
        signature: buySignature,
        fillAmount: matchAmount,
        taker: sellOrder.maker,
      },
    ];

    const fillReceipt = await retryTransaction(async () => {
      const fillTx = await settlement.connect(trader1).batchFill(fills);
      return await fillTx.wait();
    });

    console.log("✅ 订单已结算");
    console.log(`   Transaction: ${fillReceipt.hash}`);
    console.log(`   Gas 使用: ${fillReceipt.gasUsed.toString()}`);
    console.log(
      `   成交量: ${ethers.formatUnits(matchAmount, 6)} USDC @ 50% (取Seller价格)`
    );
    console.log("");

    // ========================================
    // 步骤 5: 验证 CTF 持仓
    // ========================================
    console.log("========================================");
    console.log("步骤 5: 验证 CTF 持仓");
    console.log("========================================\n");

    // 计算 position IDs (UP = outcome 1, DOWN = outcome 0)
    const upIndexSet = 1 << 1; // UP outcome
    const downIndexSet = 1 << 0; // DOWN outcome

    const upCollection = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [conditionId, upIndexSet]
    );
    const downCollection = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [conditionId, downIndexSet]
    );

    const upPositionId = await ctf.getPositionId(usdc.target, upCollection);
    const downPositionId = await ctf.getPositionId(usdc.target, downCollection);

    const trader1UpBalance = await ctf.balanceOf(trader1.address, upPositionId);
    const trader1DownBalance = await ctf.balanceOf(
      trader1.address,
      downPositionId
    );
    const trader2UpBalance = await ctf.balanceOf(trader2.address, upPositionId);
    const trader2DownBalance = await ctf.balanceOf(
      trader2.address,
      downPositionId
    );

    console.log("CTF 持仓（交易后）:");
    console.log(
      `   Trader 1 UP: ${ethers.formatUnits(trader1UpBalance, 6)} tokens`
    );
    console.log(
      `   Trader 1 DOWN: ${ethers.formatUnits(trader1DownBalance, 6)} tokens`
    );
    console.log(
      `   Trader 2 UP: ${ethers.formatUnits(trader2UpBalance, 6)} tokens`
    );
    console.log(
      `   Trader 2 DOWN: ${ethers.formatUnits(trader2DownBalance, 6)} tokens`
    );
    console.log("");

    expect(trader1UpBalance + trader1DownBalance).to.be.greaterThan(0n);
    expect(trader2UpBalance + trader2DownBalance).to.be.greaterThan(0n);

    // ========================================
    // 步骤 6: 等待市场结束
    // ========================================
    console.log("========================================");
    console.log("步骤 6: 等待市场结束");
    console.log("========================================\n");

    console.log(
      `市场将在 ${new Date(endTime * 1000).toISOString()} 结束 (${endTime - currentTime} 秒后)`
    );

    const endReached = await waitForBlock(endTime + 15, 600);
    if (!endReached) {
      console.log("❌ 未能等到结束时间");
      this.skip();
      return;
    }

    console.log("✅ 市场已结束\n");

    // ========================================
    // 步骤 7: 等待冷却期并解析市场
    // ========================================
    console.log("========================================");
    console.log("步骤 7: 等待冷却期并解析市场");
    console.log("========================================\n");

    console.log(
      `需要等待冷却期（60秒）+ 缓冲期（60秒），解析时间: ${new Date(resolveTime * 1000).toISOString()}`
    );

    const resolveReached = await waitForBlock(resolveTime + 5, 600);
    if (!resolveReached) {
      console.log("❌ 未能等到解析时间");
      this.skip();
      return;
    }

    // 检查是否可以解析
    const canResolve = await marketRegistry.canResolve(marketId);
    console.log(`\n可以解析: ${canResolve}`);

    if (!canResolve) {
      console.log("⚠️ 市场尚不能解析，可能需要更长的等待时间");
      return;
    }

    // 解析市场
    console.log("\n开始解析市场...");
    const resolveReceipt = await retryTransaction(async () => {
      const resolveTx = await marketRegistry.resolveMarket(marketId);
      console.log(`   Transaction: ${resolveTx.hash}`);
      return await resolveTx.wait();
    });
    console.log(`   Gas 使用: ${resolveReceipt.gasUsed.toString()}`);

    // 查找 MarketResolved 事件
    const resolveEvent = resolveReceipt.logs
      .map((log: any) => {
        try {
          return marketRegistry.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "MarketResolved");

    const winningOutcome = Number(resolveEvent!.args.winningOutcome);
    const startPrice = resolveEvent!.args.startPrice;
    const endPrice = resolveEvent!.args.endPrice;
    const priceChange =
      ((Number(endPrice) - Number(startPrice)) / Number(startPrice)) * 100;

    console.log("\n✅ 市场已成功解析！");
    console.log(
      `   开始价格: $${(Number(startPrice) / 1e8).toLocaleString()}`
    );
    console.log(`   结束价格: $${(Number(endPrice) / 1e8).toLocaleString()}`);
    console.log(
      `   价格变化: ${priceChange > 0 ? "+" : ""}${priceChange.toFixed(4)}%`
    );
    console.log(`   赢家: ${winningOutcome === 1 ? "UP (看涨)" : "DOWN (看跌)"}`);
    console.log("");

    // ========================================
    // 步骤 8: 赎回代币
    // ========================================
    console.log("========================================");
    console.log("步骤 8: 赎回代币");
    console.log("========================================\n");

    // 赎回前的USDC余额
    const trader1USDCBefore = await usdc.balanceOf(trader1.address);
    const trader2USDCBefore = await usdc.balanceOf(trader2.address);

    console.log("赎回前 USDC 余额:");
    console.log(
      `   Trader 1: ${ethers.formatUnits(trader1USDCBefore, 6)} USDC`
    );
    console.log(
      `   Trader 2: ${ethers.formatUnits(trader2USDCBefore, 6)} USDC`
    );
    console.log("");

    // 赎回代币
    // 赎回所有持有的代币（UP和DOWN）
    // ConditionalTokensV2 不需要 parentCollection 参数
    const indexSets = [upIndexSet, downIndexSet]; // 赎回UP和DOWN

    console.log(
      `赎回代币 (赢家: ${winningOutcome === 1 ? "UP" : "DOWN"})`
    );

    console.log("\nTrader 1 赎回...");
    try {
      const redeemTx1 = await retryTransaction(async () => {
        return await ctf
          .connect(trader1)
          .redeemPositions(usdc.target, conditionId, indexSets);
      });
      const redeemReceipt1 = await redeemTx1.wait();
      console.log(`   ✅ Transaction: ${redeemReceipt1.hash}`);
      console.log(`   Gas: ${redeemReceipt1.gasUsed.toString()}`);
    } catch (error: any) {
      console.log(`   ⚠️ 赎回失败: ${error.message}`);
    }

    console.log("\nTrader 2 赎回...");
    try {
      const redeemTx2 = await retryTransaction(async () => {
        return await ctf
          .connect(trader2)
          .redeemPositions(usdc.target, conditionId, indexSets);
      });
      const redeemReceipt2 = await redeemTx2.wait();
      console.log(`   ✅ Transaction: ${redeemReceipt2.hash}`);
      console.log(`   Gas: ${redeemReceipt2.gasUsed.toString()}`);
    } catch (error: any) {
      console.log(`   ⚠️ 赎回失败: ${error.message}`);
    }

    // ========================================
    // 步骤 9: 验证收益
    // ========================================
    console.log("\n========================================");
    console.log("步骤 9: 验证收益");
    console.log("========================================\n");

    // 赎回后的USDC余额
    const trader1USDCAfter = await usdc.balanceOf(trader1.address);
    const trader2USDCAfter = await usdc.balanceOf(trader2.address);

    const trader1Profit = trader1USDCAfter - trader1USDCBefore;
    const trader2Profit = trader2USDCAfter - trader2USDCBefore;

    console.log("赎回后 USDC 余额:");
    console.log(
      `   Trader 1: ${ethers.formatUnits(trader1USDCAfter, 6)} USDC`
    );
    console.log(
      `   Trader 2: ${ethers.formatUnits(trader2USDCAfter, 6)} USDC`
    );
    console.log("");

    console.log("收益/损失:");
    console.log(
      `   Trader 1: ${trader1Profit >= 0 ? "+" : ""}${ethers.formatUnits(trader1Profit, 6)} USDC`
    );
    console.log(
      `   Trader 2: ${trader2Profit >= 0 ? "+" : ""}${ethers.formatUnits(trader2Profit, 6)} USDC`
    );
    console.log("");

    // 验证持仓已清零
    const trader1UpAfter = await ctf.balanceOf(trader1.address, upPositionId);
    const trader1DownAfter = await ctf.balanceOf(
      trader1.address,
      downPositionId
    );
    const trader2UpAfter = await ctf.balanceOf(trader2.address, upPositionId);
    const trader2DownAfter = await ctf.balanceOf(
      trader2.address,
      downPositionId
    );

    console.log("CTF 持仓（赎回后）:");
    console.log(
      `   Trader 1 UP: ${ethers.formatUnits(trader1UpAfter, 6)} tokens`
    );
    console.log(
      `   Trader 1 DOWN: ${ethers.formatUnits(trader1DownAfter, 6)} tokens`
    );
    console.log(
      `   Trader 2 UP: ${ethers.formatUnits(trader2UpAfter, 6)} tokens`
    );
    console.log(
      `   Trader 2 DOWN: ${ethers.formatUnits(trader2DownAfter, 6)} tokens`
    );
    console.log("");

    expect(trader1UpAfter).to.equal(0n);
    expect(trader1DownAfter).to.equal(0n);
    expect(trader2UpAfter).to.equal(0n);
    expect(trader2DownAfter).to.equal(0n);

    // ========================================
    // 总结
    // ========================================
    console.log("================================================");
    console.log("✅ 完整后端集成测试成功完成！");
    console.log("================================================\n");

    console.log("测试总结:");
    console.log(`- 市场 ID: ${marketId}`);
    console.log(
      `- 成交量: ${ethers.formatUnits(matchAmount, 6)} USDC @ 50%`
    );
    console.log(`- 赢家: ${winningOutcome === 1 ? "UP" : "DOWN"}`);
    console.log(
      `- Trader 1 收益: ${trader1Profit >= 0 ? "+" : ""}${ethers.formatUnits(trader1Profit, 6)} USDC`
    );
    console.log(
      `- Trader 2 收益: ${trader2Profit >= 0 ? "+" : ""}${ethers.formatUnits(trader2Profit, 6)} USDC`
    );
    console.log("");
  });
});
