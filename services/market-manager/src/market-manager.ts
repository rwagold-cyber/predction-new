import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { retryTransaction } from "../../utils/retry";

/**
 * MarketManager - 市场生命周期管理
 *
 * 功能：
 * - 监控市场状态
 * - 自动解析到期市场
 * - 提供市场信息查询API
 */
export class MarketManager {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private marketRegistry: ethers.Contract;
  private config: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
    chainId: number;
    checkIntervalMs: number;
  };

  // 跟踪的市场
  private markets: Map<string, MarketInfo> = new Map();

  // 事件监听器
  private eventListener: any = null;
  private scanInterval: NodeJS.Timeout | null = null;

  // 最后扫描的市场ID
  private lastScannedMarketId: number = -1;

  // 统计
  private stats = {
    totalMarketsTracked: 0,
    marketsResolved: 0,
    failedResolutions: 0,
    marketDiscoveries: 0, // 自动发现的市场数量
  };

  constructor(config: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
    chainId: number;
    checkIntervalMs?: number;
  }) {
    this.config = {
      ...config,
      checkIntervalMs: config.checkIntervalMs || 30000, // 默认30秒检查一次
    };

    // Setup provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Load MarketRegistry ABI
    const registryABI = this.loadMarketRegistryABI();
    this.marketRegistry = new ethers.Contract(
      config.registryAddress,
      registryABI,
      this.wallet
    );

    console.log("MarketManager initialized");
    console.log("Wallet address:", this.wallet.address);
    console.log("MarketRegistry address:", config.registryAddress);
  }

  /**
   * 加载 MarketRegistry ABI
   */
  private loadMarketRegistryABI(): any[] {
    // Try multiple paths (local, Docker relative, Docker absolute)
    const paths = [
      path.join(__dirname, "../../../chain/artifacts/contracts/core/MarketRegistryV2.sol/MarketRegistryV2.json"),
      path.join(__dirname, "../chain/artifacts/contracts/core/MarketRegistryV2.sol/MarketRegistryV2.json"),
      "/app/chain/artifacts/contracts/core/MarketRegistryV2.sol/MarketRegistryV2.json"
    ];

    let artifactPath = paths.find(p => fs.existsSync(p));

    if (!artifactPath) {
      throw new Error(`MarketRegistryV2 artifact not found. Tried: ${paths.join(", ")}`);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    return artifact.abi;
  }

  /**
   * 添加要跟踪的市场
   */
  async addMarket(marketId: string | number): Promise<void> {
    const id = marketId.toString();

    try {
      // 从链上获取市场信息（带重试）
      const market: any = await retryTransaction(
        () => this.marketRegistry.getMarket(id),
        { maxRetries: 3, delayMs: 2000, backoff: true }
      );

      const marketInfo: MarketInfo = {
        id: id,
        conditionId: market.conditionId,
        startTime: Number(market.startTime),
        endTime: Number(market.endTime),
        resolved: market.resolved,
        winningOutcome: market.resolved ? Number(market.winningOutcome) : null,
        collateral: market.collateral,
        oracle: market.oracle,
        kind: Number(market.kind),
        timeframe: Number(market.timeframe),
      };

      this.markets.set(id, marketInfo);
      this.stats.totalMarketsTracked++;

      console.log(`✅ Added market ${id} to tracking`);
      console.log(`   Start: ${new Date(marketInfo.startTime * 1000).toISOString()}`);
      console.log(`   End: ${new Date(marketInfo.endTime * 1000).toISOString()}`);
      console.log(`   Resolved: ${marketInfo.resolved}`);
    } catch (error: any) {
      console.error(`❌ Failed to add market ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * 检查并解析到期市场
   */
  async checkAndResolveMarkets(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    for (const [id, market] of this.markets.entries()) {
      // 跳过已解析的市场
      if (market.resolved) continue;

      // 检查市场是否已到期
      if (now <= market.endTime) continue;

      console.log(`\n检查市场 ${id} 是否可解析...`);

      try {
        // 检查是否可以解析（带重试）
        const canResolve = await retryTransaction(
          () => this.marketRegistry.canResolve(id),
          { maxRetries: 3, delayMs: 2000, backoff: true }
        );

        if (!canResolve) {
          console.log(`⏳ 市场 ${id} 尚不能解析（可能在冷却期内）`);
          continue;
        }

        console.log(`✅ 市场 ${id} 可以解析，开始解析...`);

        // 解析市场（带重试 - 最关键的交易）
        const tx: any = await retryTransaction(
          () => this.marketRegistry.resolveMarket(id),
          { maxRetries: 5, delayMs: 3000, backoff: true }
        );
        console.log(`   Transaction: ${tx.hash}`);

        // 等待交易确认（带重试）
        const receipt: any = await retryTransaction(
          () => tx.wait(),
          { maxRetries: 3, delayMs: 2000, backoff: true }
        );
        console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

        // 查找 MarketResolved 事件
        const event = receipt.logs
          .map((log: any) => {
            try {
              return this.marketRegistry.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find((e: any) => e?.name === "MarketResolved");

        if (event) {
          const winningOutcome = Number(event.args.winningOutcome);
          const startPrice = event.args.startPrice;
          const endPrice = event.args.endPrice;

          console.log(`   ✅ 市场 ${id} 已解析`);
          console.log(`      开始价格: $${(Number(startPrice) / 1e8).toLocaleString()}`);
          console.log(`      结束价格: $${(Number(endPrice) / 1e8).toLocaleString()}`);
          console.log(`      赢家: ${winningOutcome === 1 ? "UP" : "DOWN"}`);

          // 更新本地记录
          market.resolved = true;
          market.winningOutcome = winningOutcome;
          this.stats.marketsResolved++;
        }
      } catch (error: any) {
        console.error(`❌ Failed to resolve market ${id}:`, error.message);
        this.stats.failedResolutions++;
      }
    }
  }

  /**
   * 启动事件监听 - 实时发现新市场
   */
  startEventListener(): void {
    console.log("📡 启动 MarketCreated 事件监听...");

    // 定义监听器函数
    const listener = async (marketId: any, conditionId: any, collateral: any, oracle: any, startTime: any, kind: any, timeframe: any, event: any) => {
      const id = marketId.toString();
      console.log(`\n🆕 发现新市场: ${id}`);

      if (!this.markets.has(id)) {
        try {
          await this.addMarket(id);
          this.stats.marketDiscoveries++;
        } catch (error: any) {
          console.error(`❌ 添加市场失败: ${error.message}`);
        }
      }
    };

    // 保存监听器引用以便正确解绑
    this.eventListener = listener;
    this.marketRegistry.on("MarketCreated", listener);
  }

  /**
   * 定期扫描新市场 (备用机制)
   */
  async scanForNewMarkets(): Promise<void> {
    try {
      // 获取最新的市场ID（带重试）
      const nextMarketId = await retryTransaction(
        () => this.marketRegistry.nextMarketId(),
        { maxRetries: 3, delayMs: 2000, backoff: true }
      );
      const latestId = Number(nextMarketId) - 1;

      // 如果是第一次扫描，从最新的开始
      if (this.lastScannedMarketId === -1) {
        this.lastScannedMarketId = Math.max(0, latestId - 10); // 最多回溯10个市场
      }

      // 扫描新市场
      if (latestId > this.lastScannedMarketId) {
        console.log(
          `\n🔍 扫描新市场: ${this.lastScannedMarketId + 1} - ${latestId}`
        );

        for (let id = this.lastScannedMarketId + 1; id <= latestId; id++) {
          if (!this.markets.has(id.toString())) {
            try {
              await this.addMarket(id.toString());
              this.stats.marketDiscoveries++;
            } catch (error: any) {
              console.error(`❌ 添加市场 ${id} 失败: ${error.message}`);
            }
          }
        }

        this.lastScannedMarketId = latestId;
      }
    } catch (error: any) {
      console.error(`❌ 扫描市场失败: ${error.message}`);
    }
  }

  /**
   * 启动市场监控循环
   */
  startMonitoring(): void {
    console.log("\n🔄 Starting market monitoring...");
    console.log(`Check interval: ${this.config.checkIntervalMs / 1000} seconds\n`);

    // 启动事件监听
    this.startEventListener();

    // 启动定期扫描（每5分钟）
    this.scanInterval = setInterval(async () => {
      await this.scanForNewMarkets();
    }, 300000); // 5分钟

    // 立即扫描一次
    this.scanForNewMarkets();

    // 启动市场解析监控
    setInterval(async () => {
      await this.checkAndResolveMarkets();
    }, this.config.checkIntervalMs);

    // 立即执行一次解析检查
    this.checkAndResolveMarkets();
  }

  /**
   * 获取市场信息
   */
  getMarket(marketId: string): MarketInfo | undefined {
    return this.markets.get(marketId);
  }

  /**
   * 获取所有市场
   */
  getAllMarkets(): MarketInfo[] {
    return Array.from(this.markets.values());
  }

  /**
   * 获取未解析的市场
   */
  getUnresolvedMarkets(): MarketInfo[] {
    return Array.from(this.markets.values()).filter((m) => !m.resolved);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      totalMarketsActive: this.markets.size,
      unresolvedMarkets: this.getUnresolvedMarkets().length,
      marketDiscoveries: this.stats.marketDiscoveries,
    };
  }

  /**
   * 关闭服务
   */
  async shutdown(): Promise<void> {
    console.log("MarketManager shutting down...");

    // 停止事件监听
    if (this.eventListener) {
      this.marketRegistry.off("MarketCreated", this.eventListener);
      console.log("Event listener stopped");
    }

    // 停止扫描定时器
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      console.log("Scan interval stopped");
    }

    console.log("MarketManager stopped");
  }
}

/**
 * 市场信息接口
 */
export interface MarketInfo {
  id: string;
  conditionId: string;
  startTime: number;
  endTime: number;
  resolved: boolean;
  winningOutcome: number | null;
  collateral: string;
  oracle: string;
  kind: number;
  timeframe: number;
}

/**
 * 主函数 - 独立运行
 */
async function main() {
  console.log("Starting MarketManager Service...\n");

  // 加载配置
  const addressesPath = path.join(
    __dirname,
    "../../../chain/addresses.json"
  );

  let registryAddress = "";
  let chainId = 1111111;

  if (fs.existsSync(addressesPath)) {
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    registryAddress = addresses.marketRegistryV2;
    chainId = parseInt(addresses.chainId);
  } else {
    console.error("addresses.json not found!");
    process.exit(1);
  }

  // 加载环境变量
  const rpcUrl = process.env.RPC_URL || "https://rpc-testnet.socrateschain.org";
  const privateKey = process.env.RELAYER_PRIVATE_KEY || process.env.MARKET_MANAGER_PRIVATE_KEY;

  if (!privateKey) {
    console.error("RELAYER_PRIVATE_KEY or MARKET_MANAGER_PRIVATE_KEY required!");
    process.exit(1);
  }

  // 创建管理器
  const manager = new MarketManager({
    rpcUrl,
    privateKey,
    registryAddress,
    chainId,
    checkIntervalMs: 30000, // 30秒检查一次
  });

  // 加载已创建的市场（从 test-markets.json）
  const marketsPath = path.join(__dirname, "../../../chain/test-markets.json");
  if (fs.existsSync(marketsPath)) {
    const markets = JSON.parse(fs.readFileSync(marketsPath, "utf8"));
    console.log(`Loading ${markets.length} markets from test-markets.json\n`);

    for (const market of markets) {
      await manager.addMarket(market.id);
    }
  }

  // 启动监控
  manager.startMonitoring();

  // 定期输出统计
  setInterval(() => {
    const stats = manager.getStats();
    if (stats.totalMarketsTracked > 0 || stats.marketDiscoveries > 0) {
      console.log("\n=== MarketManager Statistics ===");
      console.log(`Total Markets Tracked: ${stats.totalMarketsTracked}`);
      console.log(`Market Discoveries: ${stats.marketDiscoveries}`);
      console.log(`Active Markets: ${stats.totalMarketsActive}`);
      console.log(`Unresolved Markets: ${stats.unresolvedMarkets}`);
      console.log(`Markets Resolved: ${stats.marketsResolved}`);
      console.log(`Failed Resolutions: ${stats.failedResolutions}`);
      console.log("=================================\n");
    }
  }, 60000); // 每60秒输出统计

  // 导出到全局
  (global as any).marketManager = manager;

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await manager.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await manager.shutdown();
    process.exit(0);
  });
}

// 如果直接运行
if (require.main === module) {
  main().catch(console.error);
}
