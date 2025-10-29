import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Resolve market using MarketRegistryV2
 * This triggers CTF payout reporting
 */
async function main() {
  const [signer] = await ethers.getSigners();
  const marketId = process.argv[2] || process.env.MARKET_ID;

  if (!marketId) {
    console.error("❌ Market ID required!");
    console.error("Usage: npx hardhat run scripts/resolveMarketV2.ts --network soc_test -- <marketId>");
    process.exit(1);
  }

  console.log("\n================================================");
  console.log("Resolving Market (V2)");
  console.log("================================================");
  console.log("Account:", signer.address);
  console.log("Market ID:", marketId);
  console.log("");

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Please deploy contracts first.");
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  // Connect to MarketRegistryV2
  const marketRegistry = await ethers.getContractAt(
    "MarketRegistryV2",
    addresses.marketRegistryV2
  );

  // Get market info
  console.log("Fetching market info...");
  const market = await marketRegistry.getMarket(marketId);

  const kindName = market.kind === 0 ? "BTC_UPDOWN" : "ETH_UPDOWN";

  console.log("\nMarket Information:");
  console.log("- Market ID:", market.id.toString());
  console.log("- Kind:", kindName);
  console.log("- Timeframe:", market.timeframe.toString(), "minute(s)");
  console.log("- Start Time:", new Date(Number(market.startTime) * 1000).toISOString());
  console.log("- End Time:", new Date(Number(market.endTime) * 1000).toISOString());
  console.log("- Collateral:", market.collateral);
  console.log("- Oracle:", market.oracle);
  console.log("- Condition ID:", market.conditionId);
  console.log("- Outcome Count:", market.outcomeCount.toString());
  console.log("- Resolved:", market.resolved);

  if (market.resolved) {
    console.log("- Winning Outcome:", market.winningOutcome.toString());
  }
  console.log("");

  if (market.resolved) {
    console.log("⚠️  Market already resolved!");
    console.log(`Winning outcome: ${market.winningOutcome === 0 ? "DOWN" : "UP"}`);
    console.log("");
    return;
  }

  // Check if can resolve
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(market.endTime)) {
    const waitTime = Number(market.endTime) - now;
    console.log("⚠️  Market has not ended yet!");
    console.log(`Please wait ${waitTime} seconds (${Math.ceil(waitTime / 60)} minutes)`);
    console.log("");
    return;
  }

  console.log("✅ Market has ended and can be resolved");
  console.log("Resolving...\n");

  try {
    // Resolve market
    const tx = await marketRegistry.resolveMarket(marketId);
    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log(`Gas used: ${receipt?.gasUsed.toString()}`);
    console.log("");

    // Get updated market info
    const updatedMarket = await marketRegistry.getMarket(marketId);
    const updatedKindName = updatedMarket.kind === 0 ? "BTC_UPDOWN" : "ETH_UPDOWN";

    console.log("================================================");
    console.log("✅ Market Resolved Successfully!");
    console.log("================================================");
    console.log("Market ID:", updatedMarket.id.toString());
    console.log("Kind:", updatedKindName);
    console.log("Timeframe:", updatedMarket.timeframe.toString(), "minute(s)");
    console.log(`Winning Outcome: ${updatedMarket.winningOutcome === 0 ? "DOWN (price went down)" : "UP (price went up)"}`);
    console.log("Condition ID:", updatedMarket.conditionId);
    console.log("================================================");
    console.log("\nNext Steps:");
    console.log("- Users can now redeem their winning positions via CTF");
    console.log("- Winning token holders call: ctf.redeemPositions(...)");
    console.log("- Use the conditionId above when calling redeemPositions");
    console.log("================================================\n");
  } catch (error: any) {
    console.error("❌ Resolution failed:", error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
