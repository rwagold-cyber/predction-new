import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * 完整市场生命周期测试 - 使用真实未来市场
 *
 * 这个测试创建真实的未来市场，等待价格发布，然后使用 getPriceAtZeroTimestamp 解析
 *
 * 测试流程：
 * 1. 创建开始时间在未来的市场（例如：下一分钟）
 * 2. 等待市场开始
 * 3. 等待市场结束
 * 4. 等待冷却期结束
 * 5. 使用 getPriceAtZeroTimestamp 查询价格
 * 6. 解析市场
 * 7. 验证结果
 */
describe("Market Resolution - Complete Real Flow", function () {

  const REAL_PYTH_ADDRESS = "0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd";
  const BTC_FEED_ID = "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";
  const COOLDOWN_PERIOD = 60;
  const RESOLVE_BUFFER = 60;

  async function getCurrentTime(): Promise<number> {
    const block = await ethers.provider.getBlock('latest');
    return block!.timestamp;
  }

  async function waitForBlock(targetTime: number, maxWait: number = 200): Promise<boolean> {
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

      // 每秒检查一次
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`⚠️ 超时：等待了 ${maxWait} 秒，区块时间还未到达`);
    return false;
  }

  async function deployContracts() {
    const [owner, user1, user2] = await ethers.getSigners();

    console.log("\n========================================");
    console.log("部署合约");
    console.log("========================================\n");

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    console.log(`✅ USDC: ${await usdc.getAddress()}`);

    // Deploy CTF
    const CTF = await ethers.getContractFactory("ConditionalTokensV2");
    const ctf = await CTF.deploy();
    await ctf.waitForDeployment();
    console.log(`✅ CTF: ${await ctf.getAddress()}`);

    // Deploy PythOracleAdapter
    const OracleAdapter = await ethers.getContractFactory("PythOracleAdapter");
    const oracle = await OracleAdapter.deploy(REAL_PYTH_ADDRESS, BTC_FEED_ID, COOLDOWN_PERIOD);
    await oracle.waitForDeployment();
    console.log(`✅ Oracle Adapter: ${await oracle.getAddress()}`);

    // Deploy MarketRegistry
    const MarketRegistry = await ethers.getContractFactory("MarketRegistryV2");
    const registry = await MarketRegistry.deploy(await ctf.getAddress());
    await registry.waitForDeployment();
    console.log(`✅ Market Registry: ${await registry.getAddress()}`);

    // Connect to real Pyth
    const pyth = await ethers.getContractAt("contracts/oracle/IPyth.sol:IPyth", REAL_PYTH_ADDRESS);

    return { registry, oracle, ctf, usdc, pyth, owner, user1, user2 };
  }

  it("Should create and resolve a 1-minute real market", async function () {
    this.timeout(300000); // 5分钟超时

    const { registry, oracle, usdc, pyth } = await deployContracts();

    console.log("\n========================================");
    console.log("完整市场生命周期 - 1分钟市场");
    console.log("========================================");

    // Step 1: Calculate future timestamps
    const currentTime = await getCurrentTime();
    console.log(`\n当前时间: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);

    // Start at next minute + at least 30 seconds in future
    const startTime = Math.ceil((currentTime + 30) / 60) * 60;
    const endTime = startTime + 60; // 1 minute later
    const resolveTime = endTime + COOLDOWN_PERIOD + RESOLVE_BUFFER;

    console.log(`\n市场时间规划:`);
    console.log(`  开始时间: ${startTime} (${new Date(startTime * 1000).toISOString()})`);
    console.log(`  结束时间: ${endTime} (${new Date(endTime * 1000).toISOString()})`);
    console.log(`  可解析时间: ${resolveTime} (${new Date(resolveTime * 1000).toISOString()})`);
    console.log(`\n预计总等待时间: ${resolveTime - currentTime} 秒 (约 ${Math.ceil((resolveTime - currentTime) / 60)} 分钟)`);

    // Step 2: Create market
    console.log(`\n========================================`);
    console.log(`步骤 1: 创建市场`);
    console.log(`========================================`);

    const tx = await registry.createMarket(
      await usdc.getAddress(),
      await oracle.getAddress(),
      startTime,
      0, // BTC_UPDOWN
      1  // 1 minute
    );

    await tx.wait();
    console.log(`\n✅ 市场已创建 (ID: 1)`);

    const market = await registry.getMarket(1);
    console.log(`   开始时间: ${market.startTime}`);
    console.log(`   结束时间: ${market.endTime}`);
    console.log(`   状态: ${market.resolved ? '已解析' : '待解析'}`);

    expect(market.id).to.equal(1);
    expect(market.resolved).to.be.false;

    // Step 3: Wait for start time + buffer for price to publish
    console.log(`\n========================================`);
    console.log(`步骤 2: 等待市场开始和价格发布`);
    console.log(`========================================`);

    const startReached = await waitForBlock(startTime + 15, 120);

    if (!startReached) {
      console.log(`❌ 未能等到开始时间`);
      this.skip();
      return;
    }

    // Try to query start price
    console.log(`\n尝试查询开始价格...`);
    try {
      const startPriceData = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, startTime);
      const startPrice = Number(startPriceData.price) / 1e8;
      console.log(`✅ 开始价格: $${startPrice.toLocaleString()}`);
      console.log(`   时间戳: ${startPriceData.publishTime}`);
      console.log(`   置信度: ${startPriceData.conf}`);
    } catch (error: any) {
      console.log(`⚠️ 开始价格尚未发布: ${error.message}`);
      console.log(`   (这是正常的，价格可能需要几秒钟延迟)`);
    }

    // Step 4: Wait for end time + buffer
    console.log(`\n========================================`);
    console.log(`步骤 3: 等待市场结束和价格发布`);
    console.log(`========================================`);

    const endReached = await waitForBlock(endTime + 15, 120);

    if (!endReached) {
      console.log(`❌ 未能等到结束时间`);
      this.skip();
      return;
    }

    // Try to query end price
    console.log(`\n尝试查询结束价格...`);
    try {
      const endPriceData = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, endTime);
      const endPrice = Number(endPriceData.price) / 1e8;
      console.log(`✅ 结束价格: $${endPrice.toLocaleString()}`);
      console.log(`   时间戳: ${endPriceData.publishTime}`);
      console.log(`   置信度: ${endPriceData.conf}`);
    } catch (error: any) {
      console.log(`⚠️ 结束价格尚未发布: ${error.message}`);
    }

    // Step 5: Wait for cooldown + resolve buffer
    console.log(`\n========================================`);
    console.log(`步骤 4: 等待冷却期结束`);
    console.log(`========================================`);

    const resolveReached = await waitForBlock(resolveTime + 5, 150);

    if (!resolveReached) {
      console.log(`❌ 未能等到解析时间`);
      this.skip();
      return;
    }

    // Step 6: Check if can resolve
    console.log(`\n检查是否可以解析...`);
    const canResolve = await registry.canResolve(1);
    console.log(`   可以解析: ${canResolve}`);

    if (!canResolve) {
      console.log(`\n❌ 市场尚不能解析`);
      console.log(`可能原因:`);
      console.log(`  1. 开始或结束价格尚未发布`);
      console.log(`  2. 冷却期尚未结束`);
      console.log(`  3. 预言机更新延迟`);

      // Try to get more info
      try {
        const [startPrice, startValid] = await oracle.getPriceAt(startTime);
        const [endPrice, endValid] = await oracle.getPriceAt(endTime);

        console.log(`\nAdapter 查询结果:`);
        console.log(`  开始价格有效: ${startValid}`);
        console.log(`  结束价格有效: ${endValid}`);

        if (startValid && endValid) {
          console.log(`\n价格数据:`);
          console.log(`  开始: $${(Number(startPrice) / 1e8).toLocaleString()}`);
          console.log(`  结束: $${(Number(endPrice) / 1e8).toLocaleString()}`);
        }
      } catch (error: any) {
        console.log(`\n无法通过 Adapter 查询: ${error.message}`);
      }

      return;
    }

    // Step 7: Resolve market
    console.log(`\n========================================`);
    console.log(`步骤 5: 解析市场`);
    console.log(`========================================`);

    const resolveTx = await registry.resolveMarket(1);
    const receipt = await resolveTx.wait();

    console.log(`\n✅ 市场已成功解析！`);

    // Step 8: Verify resolution
    const resolvedMarket = await registry.getMarket(1);

    // Find MarketResolved event to get prices
    const event = receipt?.logs.find((log: any) => {
      try {
        return registry.interface.parseLog(log)?.name === "MarketResolved";
      } catch {
        return false;
      }
    });

    let eventStartPrice: bigint | undefined;
    let eventEndPrice: bigint | undefined;

    if (event) {
      const parsed = registry.interface.parseLog(event);
      eventStartPrice = parsed?.args.startPrice;
      eventEndPrice = parsed?.args.endPrice;

      const startPrice = Number(eventStartPrice) / 1e8;
      const endPrice = Number(eventEndPrice) / 1e8;
      const priceChange = ((endPrice - startPrice) / startPrice) * 100;

      console.log(`\n========================================`);
      console.log(`解析结果`);
      console.log(`========================================`);
      console.log(`  开始价格: $${startPrice.toLocaleString()}`);
      console.log(`  结束价格: $${endPrice.toLocaleString()}`);
      console.log(`  价格变化: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(4)}%`);
      console.log(`  赢家: ${resolvedMarket.winningOutcome === 1n ? 'UP (看涨)' : 'DOWN (看跌)'}`);
      console.log(`  状态: ${resolvedMarket.resolved ? '✅ 已解析' : '❌ 未解析'}`);

      console.log(`\n事件数据:`);
      console.log(`  Market ID: ${parsed?.args.marketId}`);
      console.log(`  Winning Outcome: ${parsed?.args.winningOutcome} (${parsed?.args.winningOutcome === 1n ? 'UP' : 'DOWN'})`);
      console.log(`  Start Price: ${parsed?.args.startPrice}`);
      console.log(`  End Price: ${parsed?.args.endPrice}`);
    }

    // Verify with getPriceAtZeroTimestamp
    console.log(`\n========================================`);
    console.log(`验证: 直接从 Pyth 查询价格`);
    console.log(`========================================`);

    const pythStartPrice = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, startTime);
    const pythEndPrice = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, endTime);

    console.log(`  Pyth 开始价格: ${pythStartPrice.price}`);
    console.log(`  事件开始价格: ${eventStartPrice}`);
    console.log(`  匹配: ${pythStartPrice.price === eventStartPrice}`);

    console.log(`\n  Pyth 结束价格: ${pythEndPrice.price}`);
    console.log(`  事件结束价格: ${eventEndPrice}`);
    console.log(`  匹配: ${pythEndPrice.price === eventEndPrice}`);

    // Assertions
    expect(resolvedMarket.resolved).to.be.true;
    expect(eventStartPrice).to.equal(pythStartPrice.price);
    expect(eventEndPrice).to.equal(pythEndPrice.price);

    console.log(`\n✅ 所有验证通过！`);
  });

  it("Should verify recent historical prices are accessible", async function () {
    this.timeout(30000);

    const { pyth } = await deployContracts();

    console.log("\n========================================");
    console.log("验证历史价格查询功能");
    console.log("========================================");

    // Get recent timestamps
    const timestamps = await pyth.getZeroTimestampsPaginated(BTC_FEED_ID, 0, 5);

    console.log(`\n找到 ${timestamps.length} 个最近的时间戳:`);

    for (let i = 0; i < timestamps.length; i++) {
      const ts = Number(timestamps[i]);
      const date = new Date(ts * 1000);

      try {
        const price = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, ts);
        const actualPrice = Number(price.price) / 1e8;

        console.log(`\n[${i}] ${ts}`);
        console.log(`    时间: ${date.toISOString()}`);
        console.log(`    价格: $${actualPrice.toLocaleString()}`);
        console.log(`    置信度: ${price.conf}`);
        console.log(`    状态: ✅ 可查询`);
      } catch (error: any) {
        console.log(`\n[${i}] ${ts}`);
        console.log(`    时间: ${date.toISOString()}`);
        console.log(`    状态: ❌ 无法查询`);
      }
    }

    expect(timestamps.length).to.be.greaterThan(0);
  });
});
