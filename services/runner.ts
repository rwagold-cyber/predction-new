import { Relayer } from "./relayer/src/relayer";
import { MatchingEngine } from "./matcher/src/matcher";
import { APIServer } from "./api/src/server";
import { MarketManager } from "./market-manager/src/market-manager";
import { hashOrder } from "./matcher/src/signature";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

/**
 * Unified Service Runner
 * Starts API, Relayer, Matcher, and MarketManager in coordinated fashion
 */

dotenv.config();

async function main() {
  console.log("=================================");
  console.log("PredictX Services Starting...");
  console.log("=================================\n");

  // Load addresses (support both local and Docker paths)
  let addressesPath = path.join(__dirname, "../chain/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    // Try Docker path
    addressesPath = path.join(__dirname, "chain/addresses.json");
  }

  if (!fs.existsSync(addressesPath)) {
    console.error("❌ addresses.json not found!");
    console.error("Tried paths:");
    console.error(`  - ${path.join(__dirname, "../chain/addresses.json")}`);
    console.error(`  - ${path.join(__dirname, "chain/addresses.json")}`);
    console.error("Please deploy contracts first:");
    console.error("  cd chain && pnpm deploy");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const settlementAddress = addresses.settlementV2 || addresses.settlement;
  const marketRegistryAddress = addresses.marketRegistryV2;
  const chainId = parseInt(addresses.chainId);

  console.log("Configuration:");
  console.log("- Chain ID:", chainId);
  console.log("- Settlement:", settlementAddress);
  console.log("- Market Registry:", marketRegistryAddress);
  console.log("- CTF:", addresses.ctf);
  console.log("- API Port:", process.env.API_PORT || "8080");
  console.log("");

  // Step 1: Initialize Relayer
  console.log("Step 1: Starting Relayer...");

  const rpcUrl = process.env.RPC_URL || "https://rpc-testnet.socrateschain.org";
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY;

  if (!relayerPrivateKey) {
    console.error("❌ RELAYER_PRIVATE_KEY environment variable required!");
    console.error("Add to .env file in services directory");
    process.exit(1);
  }

  const relayerConfig = {
    rpcUrl,
    privateKey: relayerPrivateKey,
    settlementAddress,
    chainId,
    batchSize: parseInt(process.env.BATCH_SIZE || "10"),
    batchDelayMs: parseInt(process.env.BATCH_DELAY_MS || "2000"),
    maxGasPrice: process.env.MAX_GAS_PRICE || "100",
    maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
  };

  const relayer = new Relayer(relayerConfig);
  (global as any).relayer = relayer;

  console.log("✅ Relayer started\n");

  // Step 2: Initialize Matching Engine
  console.log("Step 2: Starting Matching Engine...");

  const engine = new MatchingEngine(chainId, settlementAddress);
  (global as any).matchingEngine = engine;

  console.log("✅ Matching Engine started\n");

  // Register Relayer callback to remove failed orders from matcher
  relayer.setOnFillRejected((fill, reason) => {
    const orderId = hashOrder(fill.order);
    const cancelled = engine.cancelOrder(
      orderId,
      fill.order.marketId,
      fill.order.outcome
    );
    if (cancelled) {
      console.log(`🚫 Removed failed order from matcher: ${orderId}`);
      console.log(`   Reason: ${reason}`);
    }
  });
  console.log("✅ Relayer callback registered\n");

  // Step 3: Initialize API Server
  console.log("Step 3: Starting API Server...");

  const apiPort = parseInt(process.env.API_PORT || "8080");
  const apiServer = new APIServer(apiPort);
  apiServer.setMatchingEngine(engine);
  // MarketManager will be set after initialization
  await apiServer.start();
  (global as any).apiServer = apiServer;

  console.log("✅ API Server started\n");

  // Step 4: Initialize MarketManager
  console.log("Step 4: Starting MarketManager...");

  // 使用独立的MarketManager私钥，或回退到Relayer私钥
  const marketManagerPrivateKey = process.env.MARKET_MANAGER_PRIVATE_KEY || relayerPrivateKey;

  if (process.env.MARKET_MANAGER_PRIVATE_KEY) {
    console.log("✓ 使用独立的 MARKET_MANAGER_PRIVATE_KEY");
  } else {
    console.log("⚠️ 未配置 MARKET_MANAGER_PRIVATE_KEY，使用 RELAYER_PRIVATE_KEY");
  }

  const marketManager = new MarketManager({
    rpcUrl,
    privateKey: marketManagerPrivateKey,
    registryAddress: marketRegistryAddress,
    chainId,
    checkIntervalMs: 30000, // 30秒检查一次
  });
  (global as any).marketManager = marketManager;

  // 加载已创建的市场（support both local and Docker paths）
  let marketsPath = path.join(__dirname, "../chain/test-markets.json");
  if (!fs.existsSync(marketsPath)) {
    marketsPath = path.join(__dirname, "chain/test-markets.json");
  }

  if (fs.existsSync(marketsPath)) {
    const markets = JSON.parse(fs.readFileSync(marketsPath, "utf8"));
    console.log(`Loading ${markets.length} markets from test-markets.json`);
    for (const market of markets) {
      try {
        await marketManager.addMarket(market.id);
      } catch (error: any) {
        console.error(`Failed to add market ${market.id}:`, error.message);
      }
    }
  }

  // 启动市场监控
  marketManager.startMonitoring();

  // 注入MarketManager到API Server
  apiServer.setMarketManager(marketManager);

  console.log("✅ MarketManager started\n");

  // Step 5: Start matching loop
  console.log("Step 4: Starting matching loop...\n");

  setInterval(async () => {
    const matches = engine.matchAll();

    if (matches.size > 0) {
      console.log("\n=== Matching Results ===");
      for (const [market, matchList] of matches.entries()) {
        console.log(`Market ${market}: ${matchList.length} matches`);

        // Convert to fills
        const fills = engine.matchesToFills(matchList);
        console.log(`Generated ${fills.length} fills for settlement`);

        // Submit to relayer
        try {
          await relayer.submitFills(fills);
          console.log(`✅ Fills queued for blockchain submission`);
        } catch (error: any) {
          console.error(`❌ Failed to queue fills:`, error.message);
        }
      }
      console.log("========================\n");
    }

    // Log stats
    const engineStats = engine.getStats();
    if (engineStats.totalOrders > 0) {
      console.log(`[Matcher] Active orders: ${engineStats.totalOrders}`);
    }
  }, 1000); // Match every second

  // Periodic stats logging
  setInterval(() => {
    const engineStats = engine.getStats();
    const relayerStats = relayer.getStats();
    const marketStats = marketManager.getStats();

    if (engineStats.totalOrders > 0 || relayerStats.totalSubmitted > 0 || marketStats.totalMarketsTracked > 0) {
      console.log("\n=== Service Statistics ===");
      console.log("Matcher:");
      console.log(`  - Total Orders: ${engineStats.totalOrders}`);
      console.log(`  - Active Books: ${engineStats.activeBooks}`);

      console.log("Relayer:");
      console.log(`  - Total Submissions: ${relayerStats.totalSubmitted}`);
      console.log(`  - Total Fills: ${relayerStats.totalFills}`);
      console.log(`  - Pending Fills: ${relayerStats.pendingFills}`);
      console.log(`  - Failed: ${relayerStats.failedSubmissions}`);

      console.log("MarketManager:");
      console.log(`  - Total Markets: ${marketStats.totalMarketsTracked}`);
      console.log(`  - Unresolved: ${marketStats.unresolvedMarkets}`);
      console.log(`  - Resolved: ${marketStats.marketsResolved}`);
      console.log(`  - Failed: ${marketStats.failedResolutions}`);
      console.log("==========================\n");
    }
  }, 30000); // Stats every 30 seconds

  console.log("=================================");
  console.log("✅ All Services Running");
  console.log("=================================\n");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n\nShutting down services...");
    await apiServer.stop();
    await relayer.shutdown();
    await marketManager.shutdown();
    console.log("✅ All services stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
