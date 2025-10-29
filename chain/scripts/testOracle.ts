import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Testing Pyth Oracle connection...\n");

  const oracleAddress = process.env.BTC_ORACLE_ADDRESS || "0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd";
  const btcFeedId = process.env.BTC_FEED_ID || "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";

  console.log("Oracle Address:", oracleAddress);
  console.log("BTC Feed ID:", btcFeedId);

  try {
    // Connect to IPyth interface
    const pythOracleAbi = [
      "function getPrice(bytes32 id) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint publishTime) price)",
      "function getPriceAtZeroTimestamp(bytes32 id, uint256 timestamp) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint publishTime) price)"
    ];

    const pyth = await ethers.getContractAt(pythOracleAbi, oracleAddress);

    console.log("\n========================================");
    console.log("Testing getPrice() - Latest Price");
    console.log("========================================");

    const latestPrice = await pyth.getPrice(btcFeedId);
    console.log("Raw Price:", latestPrice.price.toString());
    console.log("Exponent:", latestPrice.expo);
    console.log("Confidence:", latestPrice.conf.toString());
    console.log("Publish Time:", latestPrice.publishTime.toString());
    console.log("Date:", new Date(Number(latestPrice.publishTime) * 1000).toISOString());

    // Calculate actual price (divide by 10^8 if expo is -8)
    const actualPrice = Number(latestPrice.price) / Math.pow(10, Math.abs(latestPrice.expo));
    console.log("Actual BTC Price: $", actualPrice.toLocaleString());

    // Check if minute-aligned
    const isMinuteAligned = Number(latestPrice.publishTime) % 60 === 0;
    console.log("Is Minute-Aligned:", isMinuteAligned ? "✓ Yes" : "✗ No");

    // Test historical price
    console.log("\n========================================");
    console.log("Testing getPriceAtZeroTimestamp() - Historical Price");
    console.log("========================================");

    // Get price from 2 minutes ago
    const now = Math.floor(Date.now() / 1000);
    const twoMinutesAgo = Math.floor((now - 120) / 60) * 60;

    console.log("Querying price at:", new Date(twoMinutesAgo * 1000).toISOString());

    try {
      const historicalPrice = await pyth.getPriceAtZeroTimestamp(btcFeedId, twoMinutesAgo);
      console.log("✓ Historical price found!");
      console.log("Price:", Number(historicalPrice.price) / Math.pow(10, 8));
      console.log("Timestamp:", new Date(Number(historicalPrice.publishTime) * 1000).toISOString());
    } catch (error: any) {
      console.log("✗ Historical price not available");
      console.log("This is normal - historical prices may not be available yet");
    }

    console.log("\n========================================");
    console.log("Oracle Connection Test: PASSED ✓");
    console.log("========================================");

  } catch (error) {
    console.error("\n❌ Oracle Connection Test FAILED");
    console.error(error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
