import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Create test markets using MarketRegistryV2
 */
async function main() {
  console.log("\n================================================");
  console.log("Creating Test Markets (V2)");
  console.log("================================================\n");

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Deploy contracts first.");
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  console.log("Loaded addresses for network:", addresses.network);

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);

  // Connect to contracts
  const marketRegistry = await ethers.getContractAt(
    "MarketRegistryV2",
    addresses.marketRegistryV2
  );
  const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);

  console.log("\nContract addresses:");
  console.log("- MarketRegistryV2:", addresses.marketRegistryV2);
  console.log("- MockUSDC:", addresses.usdc);
  console.log("- CTF:", addresses.ctf);

  // Get current block timestamp
  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;

  // Market configurations
  // MarketRegistryV2.createMarket(address collateral, address oracle, uint256 startTime, MarketKind kind, uint8 timeframe)
  const markets = [
    {
      description: "BTC UP/DOWN 1min",
      timeframe: 1, // 1 minute
    },
    {
      description: "BTC UP/DOWN 3min",
      timeframe: 3, // 3 minutes
    },
    {
      description: "BTC UP/DOWN 5min",
      timeframe: 5, // 5 minutes
    },
  ];

  const createdMarkets = [];

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    console.log(`\n----------------------------------------`);
    console.log(`Creating Market ${i + 1}/${markets.length}`);
    console.log(`----------------------------------------`);
    console.log(`Description: ${market.description}`);
    console.log(`Timeframe: ${market.timeframe} minute(s)`);

    // Calculate start time (next minute boundary + 1 minute buffer)
    const startTime = Math.floor(now / 60) * 60 + 120; // 2 minutes from now, minute-aligned

    try {
      // Create market
      // createMarket(address collateral, address oracle, uint256 startTime, MarketKind kind, uint8 timeframe)
      const tx = await marketRegistry.createMarket(
        addresses.usdc,           // collateral
        addresses.oracleAdapter,  // oracle
        startTime,                // startTime (minute-aligned)
        0,                        // kind: BTC_UPDOWN
        market.timeframe          // timeframe: 1, 3, or 5
      );

      console.log("Transaction sent:", tx.hash);
      const receipt = await tx.wait();

      // Find MarketCreated event
      const event = receipt?.logs
        .map((log: any) => {
          try {
            return marketRegistry.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "MarketCreated");

      if (event) {
        const marketId = event.args.marketId.toString();
        const conditionId = event.args.conditionId;

        console.log("✅ Market created successfully!");
        console.log(`   Market ID: ${marketId}`);
        console.log(`   Condition ID: ${conditionId}`);

        createdMarkets.push({
          id: marketId,
          conditionId: conditionId,
          description: market.description,
          startTime: startTime,
          endTime: startTime + market.timeframe * 60,
          timeframe: market.timeframe,
        });
      }
    } catch (error: any) {
      console.error("❌ Failed to create market:", error.message);
    }
  }

  // Save market info
  if (createdMarkets.length > 0) {
    const marketsPath = path.join(__dirname, "..", "test-markets.json");
    fs.writeFileSync(marketsPath, JSON.stringify(createdMarkets, null, 2));
    console.log("\n================================================");
    console.log("✅ Markets saved to:", marketsPath);
    console.log("================================================");
    console.log(JSON.stringify(createdMarkets, null, 2));
  }

  console.log("\n================================================");
  console.log(`Summary: Created ${createdMarkets.length}/${markets.length} markets`);
  console.log("================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
