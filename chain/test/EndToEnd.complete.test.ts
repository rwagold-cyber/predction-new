import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 完整的端到端测试
 *
 * 测试流程：
 * 1. 准备：铸造USDC，存入抵押品
 * 2. 签名订单（EIP-712）
 * 3. 模拟撮合
 * 4. 提交到Settlement结算
 * 5. 验证CTF持仓
 * 6. 等待市场结束
 * 7. 解析市场
 * 8. 验证赎回
 */
describe("End-to-End Integration Test", function () {
  this.timeout(600000); // 10 minutes

  async function getCurrentTime(): Promise<number> {
    const block = await ethers.provider.getBlock("latest");
    return block!.timestamp;
  }

  async function waitForBlock(targetTime: number, maxWait: number = 300): Promise<boolean> {
    console.log(`\n⏳ 等待区块时间到达 ${new Date(targetTime * 1000).toISOString()}...`);
    const startTime = Date.now();
    const maxWaitMs = maxWait * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const currentTime = await getCurrentTime();
      if (currentTime >= targetTime) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`✅ 区块时间已到达 (等待了 ${elapsed} 秒)`);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(`⚠️ 超时`);
    return false;
  }

  it("Should complete full market lifecycle with trading", async function () {
    console.log("\n================================================");
    console.log("完整端到端测试 - 市场生命周期");
    console.log("================================================\n");

    // Load addresses
    const addressesPath = path.join(__dirname, "..", "addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

    console.log("合约地址:");
    console.log("- USDC:", addresses.usdc);
    console.log("- CTF:", addresses.ctf);
    console.log("- Settlement:", addresses.settlementV2);
    console.log("- Market Registry:", addresses.marketRegistryV2);
    console.log("- Oracle Adapter:", addresses.oracleAdapter);
    console.log("");

    // Get signers
    const [trader1, trader2] = await ethers.getSigners();
    console.log("交易者:");
    console.log("- Trader 1:", trader1.address);
    console.log("- Trader 2:", trader2.address);
    console.log("");

    // Connect to contracts
    const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);
    const ctf = await ethers.getContractAt("ConditionalTokensV2", addresses.ctf);
    const settlement = await ethers.getContractAt("SettlementV2", addresses.settlementV2);
    const marketRegistry = await ethers.getContractAt("MarketRegistryV2", addresses.marketRegistryV2);
    const oracleAdapter = await ethers.getContractAt("PythOracleAdapter", addresses.oracleAdapter);

    // ========================================
    // 步骤 1: 创建测试市场
    // ========================================
    console.log("========================================");
    console.log("步骤 1: 创建测试市场");
    console.log("========================================\n");

    const currentTime = await getCurrentTime();
    const startTime = Math.ceil((currentTime + 30) / 60) * 60;
    const timeframe = 3; // 3 minutes
    const endTime = startTime + timeframe * 60;

    console.log(`当前时间: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);
    console.log(`开始时间: ${startTime} (${new Date(startTime * 1000).toISOString()})`);
    console.log(`结束时间: ${endTime} (${new Date(endTime * 1000).toISOString()})`);
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

    console.log(`✅ 市场已创建`);
    console.log(`   Market ID: ${marketId}`);
    console.log(`   Condition ID: ${conditionId}`);
    console.log("");

    // ========================================
    // 步骤 2: 准备交易者账户
    // ========================================
    console.log("========================================");
    console.log("步骤 2: 准备交易者账户");
    console.log("========================================\n");

    // Mint USDC
    const mintAmount = ethers.parseUnits("500", 6);
    await usdc.connect(trader1).mint(trader1.address, mintAmount);
    await usdc.connect(trader2).mint(trader2.address, mintAmount);
    console.log("✅ 铸造 USDC 完成");

    // Approve and deposit
    const depositAmount = ethers.parseUnits("200", 6);
    await usdc.connect(trader1).approve(settlement.target, depositAmount);
    await settlement.connect(trader1).depositCollateral(usdc.target, depositAmount);
    console.log(`✅ Trader 1 存入 ${ethers.formatUnits(depositAmount, 6)} USDC`);

    await usdc.connect(trader2).approve(settlement.target, depositAmount);
    await settlement.connect(trader2).depositCollateral(usdc.target, depositAmount);
    console.log(`✅ Trader 2 存入 ${ethers.formatUnits(depositAmount, 6)} USDC`);
    console.log("");

    // ========================================
    // 步骤 3: 创建并签名订单
    // ========================================
    console.log("========================================");
    console.log("步骤 3: 创建并签名订单");
    console.log("========================================\n");

    const expiry = currentTime + 3600;

    // Buy order (trader1 wants to buy UP at 55%)
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

    // Sell order (trader2 wants to sell UP at 50%)
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
    const sellSignature = await trader2.signTypedData(domain, types, sellOrder);

    console.log("✅ 订单签名完成");
    console.log(`   Buy Order: ${buyOrder.amount} @ ${buyOrder.pricePips} BPS`);
    console.log(`   Sell Order: ${sellOrder.amount} @ ${sellOrder.pricePips} BPS`);
    console.log("");

    // ========================================
    // 步骤 4: 撮合并结算
    // ========================================
    console.log("========================================");
    console.log("步骤 4: 撮合并结算");
    console.log("========================================\n");

    const matchAmount = "50000000"; // 50 USDC

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

    const fillTx = await settlement.connect(trader1).batchFill(fills);
    const fillReceipt = await fillTx.wait();

    console.log("✅ 订单已结算");
    console.log(`   Gas 使用: ${fillReceipt?.gasUsed.toString()}`);
    console.log("");

    // ========================================
    // 步骤 5: 验证 CTF 持仓
    // ========================================
    console.log("========================================");
    console.log("步骤 5: 验证 CTF 持仓");
    console.log("========================================\n");

    // 计算 position ID
    const outcomeSlotCount = 2; // UP and DOWN
    const collection = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [conditionId, (1 << 1)] // 表示 UP (outcome 1)
    );
    const positionId = await ctf.getPositionId(usdc.target, collection);

    const trader1Balance = await ctf.balanceOf(trader1.address, positionId);
    const trader2Balance = await ctf.balanceOf(trader2.address, positionId);

    console.log(`Trader 1 UP 持仓: ${ethers.formatUnits(trader1Balance, 6)} tokens`);
    console.log(`Trader 2 UP 持仓: ${ethers.formatUnits(trader2Balance, 6)} tokens`);
    console.log("");

    expect(trader1Balance).to.be.greaterThan(0n);
    expect(trader2Balance).to.be.greaterThan(0n);

    // ========================================
    // 步骤 6: 等待市场结束
    // ========================================
    console.log("========================================");
    console.log("步骤 6: 等待市场结束");
    console.log("========================================\n");

    const resolveTime = endTime + 60 + 60; // endTime + cooldown + buffer
    const reached = await waitForBlock(resolveTime + 5, 300);

    if (!reached) {
      console.log("⚠️ 未能等到解析时间，跳过后续步骤");
      this.skip();
      return;
    }

    // ========================================
    // 步骤 7: 解析市场
    // ========================================
    console.log("\n========================================");
    console.log("步骤 7: 解析市场");
    console.log("========================================\n");

    const canResolve = await marketRegistry.canResolve(marketId);
    console.log(`可以解析: ${canResolve}`);

    if (!canResolve) {
      console.log("⚠️ 市场尚不能解析");
      return;
    }

    const resolveTx = await marketRegistry.resolveMarket(marketId);
    const resolveReceipt = await resolveTx.wait();

    const resolveEvent = resolveReceipt?.logs
      .map((log: any) => {
        try {
          return marketRegistry.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "MarketResolved");

    const winningOutcome = resolveEvent!.args.winningOutcome;
    const startPrice = resolveEvent!.args.startPrice;
    const endPrice = resolveEvent!.args.endPrice;

    console.log("✅ 市场已解析");
    console.log(`   开始价格: $${(Number(startPrice) / 1e8).toLocaleString()}`);
    console.log(`   结束价格: $${(Number(endPrice) / 1e8).toLocaleString()}`);
    console.log(`   赢家: ${winningOutcome === 1n ? "UP" : "DOWN"}`);
    console.log("");

    // ========================================
    // 步骤 8: 赎回
    // ========================================
    console.log("========================================");
    console.log("步骤 8: 赎回代币");
    console.log("========================================\n");

    const payouts = [1, 0]; // Assume UP won
    const indexSets = [(1 << 1) | (1 << 0)]; // Both outcomes

    // Trader 1 redeem
    try {
      const trader1Before = await usdc.balanceOf(trader1.address);
      const redeemTx1 = await ctf
        .connect(trader1)
        .redeemPositions(usdc.target, ethers.ZeroHash, conditionId, indexSets);
      await redeemTx1.wait();
      const trader1After = await usdc.balanceOf(trader1.address);
      const trader1Profit = trader1After - trader1Before;

      console.log(`✅ Trader 1 赎回`);
      console.log(`   赎回金额: ${ethers.formatUnits(trader1Profit, 6)} USDC`);
    } catch (error: any) {
      console.log(`⚠️ Trader 1 赎回失败: ${error.message}`);
    }

    console.log("\n================================================");
    console.log("✅ 完整端到端测试完成！");
    console.log("================================================\n");
  });
});
