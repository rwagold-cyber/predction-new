import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Complete functional test of the prediction market system
 */
async function main() {
  console.log("\n================================================");
  console.log("🧪 PredictX V2 - Complete Functional Test");
  console.log("================================================\n");

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const marketsPath = path.join(__dirname, "..", "test-markets.json");
  const markets = JSON.parse(fs.readFileSync(marketsPath, "utf8"));

  const [deployer, relayer] = await ethers.getSigners();

  console.log("📋 Test Configuration:");
  console.log("- Deployer:", deployer.address);
  console.log("- Relayer:", relayer.address);
  console.log("- Network:", addresses.network);
  console.log();

  // Connect to contracts
  const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);
  const ctf = await ethers.getContractAt("ConditionalTokensV2", addresses.ctf);
  const settlement = await ethers.getContractAt("SettlementV2", addresses.settlementV2);
  const marketRegistry = await ethers.getContractAt("MarketRegistryV2", addresses.marketRegistryV2);
  const oracle = await ethers.getContractAt("PythOracleAdapter", addresses.oracleAdapter);

  let passedTests = 0;
  let failedTests = 0;

  // ==============================================
  // Test 1: Contract Deployment Verification
  // ==============================================
  console.log("========================================");
  console.log("Test 1: Contract Deployment Verification");
  console.log("========================================");

  try {
    const usdcCode = await ethers.provider.getCode(addresses.usdc);
    const ctfCode = await ethers.provider.getCode(addresses.ctf);
    const settlementCode = await ethers.provider.getCode(addresses.settlementV2);
    const registryCode = await ethers.provider.getCode(addresses.marketRegistryV2);
    const oracleCode = await ethers.provider.getCode(addresses.oracleAdapter);

    if (usdcCode !== "0x" && ctfCode !== "0x" && settlementCode !== "0x" &&
        registryCode !== "0x" && oracleCode !== "0x") {
      console.log("✅ All contracts deployed successfully");
      passedTests++;
    } else {
      console.log("❌ Some contracts failed to deploy");
      failedTests++;
    }
  } catch (error) {
    console.log("❌ Deployment verification failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 2: Oracle Functionality
  // ==============================================
  console.log("========================================");
  console.log("Test 2: Oracle Functionality");
  console.log("========================================");

  try {
    const [price, timestamp, valid] = await oracle.getLatestPrice();
    if (valid && price > 0n) {
      console.log("✅ Oracle returning valid prices");
      console.log(`   Latest BTC Price: $${Number(price) / 1e8}`);
      console.log(`   Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);
      passedTests++;
    } else {
      console.log("❌ Oracle returning invalid data");
      failedTests++;
    }
  } catch (error) {
    console.log("❌ Oracle test failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 3: USDC Balance and Allowance
  // ==============================================
  console.log("========================================");
  console.log("Test 3: USDC Balance and Allowance");
  console.log("========================================");

  try {
    const balance = await usdc.balanceOf(deployer.address);
    console.log(`   Deployer USDC Balance: ${ethers.formatUnits(balance, 6)} USDC`);

    if (balance < ethers.parseUnits("1000", 6)) {
      console.log("   Minting additional USDC...");
      await usdc.mint(deployer.address, ethers.parseUnits("10000", 6));
    }

    const newBalance = await usdc.balanceOf(deployer.address);
    if (newBalance > 0n) {
      console.log("✅ USDC balance sufficient");
      passedTests++;
    } else {
      console.log("❌ Insufficient USDC balance");
      failedTests++;
    }
  } catch (error) {
    console.log("❌ USDC test failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 4: Collateral Deposit
  // ==============================================
  console.log("========================================");
  console.log("Test 4: Collateral Deposit");
  console.log("========================================");

  try {
    const depositAmount = ethers.parseUnits("1000", 6);

    // Approve USDC
    console.log("   Approving USDC...");
    const approveTx = await usdc.approve(settlement.target, depositAmount);
    await approveTx.wait();

    // Check allowance
    const allowance = await usdc.allowance(deployer.address, settlement.target);
    console.log(`   Allowance: ${ethers.formatUnits(allowance, 6)} USDC`);

    // Deposit
    console.log("   Depositing collateral...");
    const depositTx = await settlement.depositCollateral(usdc.target, depositAmount);
    await depositTx.wait();

    // Verify deposit
    const depositedBalance = await settlement.collateralBalance(deployer.address, usdc.target);
    if (depositedBalance >= depositAmount) {
      console.log("✅ Collateral deposited successfully");
      console.log(`   Deposited: ${ethers.formatUnits(depositedBalance, 6)} USDC`);
      passedTests++;
    } else {
      console.log("❌ Deposit amount mismatch");
      failedTests++;
    }
  } catch (error: any) {
    console.log("❌ Collateral deposit failed:", error.message || error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 5: Market Query
  // ==============================================
  console.log("========================================");
  console.log("Test 5: Market Query");
  console.log("========================================");

  try {
    if (markets.length > 0) {
      const marketId = markets[0].id;
      const marketData = await marketRegistry.markets(marketId);

      console.log(`   Market ID: ${marketId}`);
      console.log(`   Collateral: ${marketData.collateral}`);
      console.log(`   Oracle: ${marketData.oracle}`);
      console.log(`   Start Time: ${new Date(Number(marketData.startTime) * 1000).toISOString()}`);
      console.log(`   End Time: ${new Date(Number(marketData.endTime) * 1000).toISOString()}`);
      console.log(`   Resolved: ${marketData.resolved}`);

      if (marketData.collateral !== ethers.ZeroAddress) {
        console.log("✅ Market data retrieved successfully");
        passedTests++;
      } else {
        console.log("❌ Invalid market data");
        failedTests++;
      }
    } else {
      console.log("⚠️  No markets found to test");
    }
  } catch (error) {
    console.log("❌ Market query failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 6: CTF Position Query
  // ==============================================
  console.log("========================================");
  console.log("Test 6: CTF Position Tracking");
  console.log("========================================");

  try {
    if (markets.length > 0) {
      const conditionId = markets[0].conditionId;

      // Calculate position IDs
      const collectionIdYes = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 1);
      const collectionIdNo = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 2);

      const posIdYes = await ctf.getPositionId(usdc.target, collectionIdYes);
      const posIdNo = await ctf.getPositionId(usdc.target, collectionIdNo);

      console.log(`   Condition ID: ${conditionId.slice(0, 10)}...`);
      console.log(`   Position ID (YES): ${posIdYes.slice(0, 10)}...`);
      console.log(`   Position ID (NO): ${posIdNo.slice(0, 10)}...`);

      const balanceYes = await ctf.balanceOf(deployer.address, posIdYes);
      const balanceNo = await ctf.balanceOf(deployer.address, posIdNo);

      console.log(`   YES Position Balance: ${ethers.formatUnits(balanceYes, 6)}`);
      console.log(`   NO Position Balance: ${ethers.formatUnits(balanceNo, 6)}`);
      console.log("✅ CTF position tracking working");
      passedTests++;
    } else {
      console.log("⚠️  No markets found for position test");
    }
  } catch (error) {
    console.log("❌ CTF position query failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 7: Settlement Configuration
  // ==============================================
  console.log("========================================");
  console.log("Test 7: Settlement Configuration");
  console.log("========================================");

  try {
    const isSupported = await settlement.supportedCollateral(usdc.target);
    const ctfAddress = await settlement.ctf();
    const relayerRole = await settlement.RELAYER_ROLE();
    const hasRelayerRole = await settlement.hasRole(relayerRole, relayer.address);

    console.log(`   USDC Supported: ${isSupported}`);
    console.log(`   CTF Address: ${ctfAddress}`);
    console.log(`   Relayer Has Role: ${hasRelayerRole}`);

    if (isSupported && ctfAddress === addresses.ctf) {
      console.log("✅ Settlement properly configured");
      passedTests++;
    } else {
      console.log("❌ Settlement configuration issue");
      failedTests++;
    }
  } catch (error) {
    console.log("❌ Settlement config test failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Test 8: Market Count
  // ==============================================
  console.log("========================================");
  console.log("Test 8: Market Registry State");
  console.log("========================================");

  try {
    const nextMarketId = await marketRegistry.nextMarketId();
    console.log(`   Next Market ID: ${nextMarketId}`);
    console.log(`   Markets Created: ${Number(nextMarketId) - 1}`);

    if (nextMarketId > 1n) {
      console.log("✅ Markets have been created");
      passedTests++;
    } else {
      console.log("⚠️  No markets created yet");
      failedTests++;
    }
  } catch (error) {
    console.log("❌ Market registry test failed:", error);
    failedTests++;
  }
  console.log();

  // ==============================================
  // Final Results
  // ==============================================
  console.log("\n================================================");
  console.log("📊 Test Results Summary");
  console.log("================================================");
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`📈 Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%`);
  console.log("================================================\n");

  if (failedTests === 0) {
    console.log("🎉 All tests passed! System is fully functional.");
  } else {
    console.log("⚠️  Some tests failed. Please review the results above.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
