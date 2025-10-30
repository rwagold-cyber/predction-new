import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * 真实 Pyth Oracle 实时价格测试
 *
 * 正确理解：
 * 1. 预言机每分钟在整分钟时刻（例如 18:25:00）发布新价格
 * 2. 价格发布后几秒内（最多10秒）会在链上可用
 * 3. 我们应该等待新价格发布，而不是查询历史价格
 */
describe("Real Pyth Oracle - Realtime Price Updates", function () {

  const REAL_PYTH_ADDRESS = "0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd";
  const BTC_FEED_ID = "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";
  const COOLDOWN_PERIOD = 60;
  const MAX_WAIT_TIME = 80; // 最多等待80秒（60秒到下一分钟 + 20秒缓冲）

  async function getCurrentTime(): Promise<number> {
    const block = await ethers.provider.getBlock('latest');
    return block!.timestamp;
  }

  async function waitForNextMinute(): Promise<number> {
    const currentTime = await getCurrentTime();
    const nextMinute = Math.ceil(currentTime / 60) * 60;
    const waitSeconds = nextMinute - currentTime;

    console.log(`\n当前时间: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);
    console.log(`下一个整分钟: ${nextMinute} (${new Date(nextMinute * 1000).toISOString()})`);
    console.log(`需要等待: ${waitSeconds} 秒`);

    return nextMinute;
  }

  async function waitForBlock(targetTime: number, maxWait: number = 15): Promise<boolean> {
    console.log(`\n等待区块时间到达 ${targetTime} + ${maxWait}秒...`);

    const startTime = Date.now();
    const maxWaitMs = maxWait * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const currentTime = await getCurrentTime();

      if (currentTime >= targetTime) {
        console.log(`✅ 区块时间已到达: ${currentTime} (等待了 ${Math.floor((Date.now() - startTime) / 1000)} 秒)`);
        return true;
      }

      // 等待1秒再检查
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`⚠️ 超时：等待了 ${maxWait} 秒，区块时间还未到达`);
    return false;
  }

  it("Should get the latest published price", async function () {
    this.timeout(120000); // 2分钟超时

    const pyth = await ethers.getContractAt("contracts/oracle/IPyth.sol:IPyth", REAL_PYTH_ADDRESS);

    console.log("\n========================================");
    console.log("获取最新发布的价格");
    console.log("========================================");

    const lastPrice = await pyth.getLastZeroPrice(BTC_FEED_ID);
    const lastTimestamp = Number(lastPrice.publishTime);

    console.log(`\n最新价格:`);
    console.log(`  时间戳: ${lastTimestamp}`);
    console.log(`  日期: ${new Date(lastTimestamp * 1000).toISOString()}`);
    console.log(`  价格: ${lastPrice.price}`);
    console.log(`  实际价格: $${(Number(lastPrice.price) / 1e8).toLocaleString()}`);

    const currentTime = await getCurrentTime();
    const secondsAgo = currentTime - lastTimestamp;
    console.log(`\n发布于 ${secondsAgo} 秒前`);

    expect(lastPrice.publishTime).to.be.greaterThan(0);
    expect(lastPrice.price).to.be.greaterThan(0);
  });

  it("Should wait for and query next price update", async function () {
    this.timeout(120000); // 2分钟超时

    const pyth = await ethers.getContractAt("contracts/oracle/IPyth.sol:IPyth", REAL_PYTH_ADDRESS);

    console.log("\n========================================");
    console.log("等待下一次价格更新");
    console.log("========================================");

    // 1. 计算下一个整分钟时间戳
    const nextMinute = await waitForNextMinute();

    // 2. 等待到下一分钟 + 10秒（给预言机时间发布价格）
    const targetTime = nextMinute + 10;

    console.log(`\n⏳ 等待价格发布...`);
    console.log(`目标时间: ${new Date(targetTime * 1000).toISOString()}`);

    const reached = await waitForBlock(targetTime, MAX_WAIT_TIME);

    if (!reached) {
      console.log(`\n⚠️ 测试超时，但这是预期的（需要等待真实时间）`);
      this.skip();
      return;
    }

    // 3. 尝试获取刚发布的价格
    console.log(`\n查询价格...`);
    console.log(`时间戳: ${nextMinute} (${new Date(nextMinute * 1000).toISOString()})`);

    try {
      const price = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, nextMinute);

      console.log(`\n✅ 成功获取价格！`);
      console.log(`  价格: ${price.price}`);
      console.log(`  置信度: ${price.conf}`);
      console.log(`  指数: ${price.expo}`);
      console.log(`  发布时间: ${price.publishTime}`);
      console.log(`  实际价格: $${(Number(price.price) / 1e8).toLocaleString()}`);

      expect(price.publishTime).to.equal(nextMinute);
      expect(price.price).to.be.greaterThan(0);
      expect(price.expo).to.equal(-8);

    } catch (error: any) {
      console.log(`\n❌ 获取价格失败: ${error.message}`);

      // 检查是否是因为价格还未发布
      if (error.message.includes("No price available")) {
        console.log(`\n可能原因：`);
        console.log(`  1. 预言机更新延迟超过10秒`);
        console.log(`  2. 预言机暂时停止更新`);
        console.log(`  3. 网络延迟`);

        // 尝试获取最新价格确认预言机仍在工作
        try {
          const lastPrice = await pyth.getLastZeroPrice(BTC_FEED_ID);
          const lastTimestamp = Number(lastPrice.publishTime);
          console.log(`\n最新可用价格时间戳: ${lastTimestamp} (${new Date(lastTimestamp * 1000).toISOString()})`);
        } catch (e: any) {
          console.log(`无法获取最新价格: ${e.message}`);
        }
      }

      throw error;
    }
  });

  it("Should test PythOracleAdapter with realtime price", async function () {
    this.timeout(120000);

    const pyth = await ethers.getContractAt("contracts/oracle/IPyth.sol:IPyth", REAL_PYTH_ADDRESS);

    console.log("\n========================================");
    console.log("测试 Adapter 获取实时价格");
    console.log("========================================");

    // 1. 获取最新已发布的价格时间戳
    const lastPrice = await pyth.getLastZeroPrice(BTC_FEED_ID);
    const lastTimestamp = Number(lastPrice.publishTime);

    console.log(`\n最新价格时间戳: ${lastTimestamp} (${new Date(lastTimestamp * 1000).toISOString()})`);

    // 2. 检查是否已过冷却期
    const currentTime = await getCurrentTime();
    const secondsPassed = currentTime - lastTimestamp;

    console.log(`当前时间: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);
    console.log(`距离发布: ${secondsPassed} 秒`);

    if (secondsPassed < COOLDOWN_PERIOD) {
      console.log(`\n⚠️ 价格仍在冷却期内，等待 ${COOLDOWN_PERIOD - secondsPassed} 秒...`);

      // 等待冷却期结束
      await waitForBlock(lastTimestamp + COOLDOWN_PERIOD + 5, 70);
    }

    // 3. 部署 Adapter
    console.log(`\n部署 PythOracleAdapter...`);
    const OracleAdapter = await ethers.getContractFactory("PythOracleAdapter");
    const adapter = await OracleAdapter.deploy(
      REAL_PYTH_ADDRESS,
      BTC_FEED_ID,
      COOLDOWN_PERIOD
    );
    await adapter.waitForDeployment();
    console.log(`✅ Adapter 已部署: ${await adapter.getAddress()}`);

    // 4. 通过 Adapter 获取价格
    console.log(`\n通过 Adapter 查询价格...`);
    console.log(`时间戳: ${lastTimestamp}`);

    const [price, valid] = await adapter.getPriceAt(lastTimestamp);

    console.log(`\nAdapter 返回:`);
    console.log(`  价格: ${price}`);
    console.log(`  有效: ${valid}`);
    console.log(`  实际价格: $${(Number(price) / 1e8).toLocaleString()}`);

    expect(valid).to.be.true;
    expect(price).to.equal(lastPrice.price);
  });

  it("Should query multiple recent prices", async function () {
    const pyth = await ethers.getContractAt("contracts/oracle/IPyth.sol:IPyth", REAL_PYTH_ADDRESS);

    console.log("\n========================================");
    console.log("查询最近的多个价格");
    console.log("========================================");

    // 获取最近10个时间戳
    const timestamps = await pyth.getZeroTimestampsPaginated(BTC_FEED_ID, 0, 10);

    console.log(`\n找到 ${timestamps.length} 个时间戳`);

    const currentTime = await getCurrentTime();

    // 显示每个时间戳及其年龄
    console.log(`\n最近的价格:`);
    for (let i = timestamps.length - 1; i >= Math.max(0, timestamps.length - 5); i--) {
      const ts = Number(timestamps[i]);
      const age = currentTime - ts;
      const minutes = Math.floor(age / 60);
      const seconds = age % 60;

      console.log(`  [${i}] ${ts} - ${new Date(ts * 1000).toISOString()} (${minutes}分${seconds}秒前)`);

      try {
        const price = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, ts);
        const actualPrice = Number(price.price) / 1e8;
        console.log(`       价格: $${actualPrice.toLocaleString()}`);
      } catch (error: any) {
        console.log(`       ❌ 无法获取价格: ${error.message}`);
      }
    }

    expect(timestamps.length).to.be.greaterThan(0);
  });

  it("Should demonstrate correct usage pattern", async function () {
    console.log("\n========================================");
    console.log("正确使用模式示例");
    console.log("========================================");

    const pyth = await ethers.getContractAt("contracts/oracle/IPyth.sol:IPyth", REAL_PYTH_ADDRESS);

    console.log(`\n模式 1: 获取最新可用价格（推荐）`);
    console.log(`-----------------------------------------`);

    const lastPrice = await pyth.getLastZeroPrice(BTC_FEED_ID);
    console.log(`✅ getLastZeroPrice() 返回最新价格:`);
    console.log(`   时间: ${new Date(Number(lastPrice.publishTime) * 1000).toISOString()}`);
    console.log(`   价格: $${(Number(lastPrice.price) / 1e8).toLocaleString()}`);

    console.log(`\n模式 2: 查询特定时间戳的价格`);
    console.log(`-----------------------------------------`);

    const specificTimestamp = Number(lastPrice.publishTime);
    console.log(`查询时间戳: ${specificTimestamp}`);

    const specificPrice = await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, specificTimestamp);
    console.log(`✅ getPriceAtZeroTimestamp() 返回:`);
    console.log(`   价格: $${(Number(specificPrice.price) / 1e8).toLocaleString()}`);

    console.log(`\n模式 3: 通过 Adapter 查询（用于合约集成）`);
    console.log(`-----------------------------------------`);

    const currentTime = await getCurrentTime();
    const secondsPassed = currentTime - specificTimestamp;

    if (secondsPassed >= COOLDOWN_PERIOD) {
      const OracleAdapter = await ethers.getContractFactory("PythOracleAdapter");
      const adapter = await OracleAdapter.deploy(REAL_PYTH_ADDRESS, BTC_FEED_ID, COOLDOWN_PERIOD);
      await adapter.waitForDeployment();

      const [price, valid] = await adapter.getPriceAt(specificTimestamp);
      console.log(`✅ adapter.getPriceAt() 返回:`);
      console.log(`   价格: $${(Number(price) / 1e8).toLocaleString()}`);
      console.log(`   有效: ${valid}`);
    } else {
      console.log(`⏳ 价格仍在冷却期内（还需 ${COOLDOWN_PERIOD - secondsPassed} 秒）`);
    }

    console.log(`\n❌ 错误模式：查询未来时间戳`);
    console.log(`-----------------------------------------`);

    const futureTimestamp = Math.ceil((currentTime + 120) / 60) * 60;
    console.log(`尝试查询未来时间戳: ${futureTimestamp} (${new Date(futureTimestamp * 1000).toISOString()})`);

    try {
      await pyth.getPriceAtZeroTimestamp(BTC_FEED_ID, futureTimestamp);
      console.log(`❌ 不应该成功`);
    } catch (error: any) {
      console.log(`✅ 预期的错误: ${error.message}`);
    }

    console.log(`\n总结：`);
    console.log(`✅ 使用 getLastZeroPrice() 获取最新价格`);
    console.log(`✅ 使用 getPriceAtZeroTimestamp() 查询已发布的价格`);
    console.log(`✅ 通过 Adapter 查询时注意冷却期`);
    console.log(`❌ 不要查询未发布的价格`);
  });
});
