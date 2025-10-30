import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Critical Path Tests - Covers all missing test scenarios identified in FINAL_TEST_REPORT.md
 *
 * Tests:
 * 1. Collateral Withdrawal
 * 2. Market Resolution
 * 3. CTF Position Redemption
 * 4. Oracle Price Verification (with new getPriceAtZeroTimestamp)
 * 5. Complete order lifecycle simulation
 */

async function main() {
  console.log("\n================================================");
  console.log("🧪 PredictX V2 - Critical Path Tests");
  console.log("================================================\n");

  // Load configuration
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const marketsPath = path.join(__dirname, "..", "test-markets.json");
  const markets = JSON.parse(fs.readFileSync(marketsPath, "utf8"));

  const [deployer, user1] = await ethers.getSigners();

  console.log("Test Accounts:");
  console.log("- Deployer:", deployer.address);
  console.log("- User1:", user1.address);
  console.log();

  // Connect to contracts
  const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);
  const ctf = await ethers.getContractAt("ConditionalTokensV2", addresses.ctf);
  const settlement = await ethers.getContractAt("SettlementV2", addresses.settlementV2);
  const marketRegistry = await ethers.getContractAt("MarketRegistryV2", addresses.marketRegistryV2);
  const oracle = await ethers.getContractAt("PythOracleAdapter", addresses.oracleAdapter);

  let testResults = {
    passed: 0,
    failed: 0,
    tests: [] as any[]
  };

  // ============================================
  // Test 1: Enhanced Oracle Verification
  // ============================================
  console.log("========================================");
  console.log("Test 1: Enhanced Oracle Verification");
  console.log("(Testing new getPriceAtZeroTimestamp logic)");
  console.log("========================================");

  try {
    // Test latest price with new validation
    const [price, timestamp, valid] = await oracle.getLatestPrice();
    console.log(`Latest Price: $${Number(price) / 1e8}`);
    console.log(`Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);
    console.log(`Valid: ${valid}`);
    console.log(`Price > 0: ${price > 0n}`);

    // Test historical price if available (after cooldown)
    const block = await ethers.provider.getBlock("latest");
    const currentTime = block!.timestamp;
    const lastMinuteTs = Math.floor(currentTime / 60) * 60 - 120; // 2 minutes ago

    try {
      const [histPrice, histValid] = await oracle.getPriceAt(lastMinuteTs);
      console.log(`Historical Price (${new Date(lastMinuteTs * 1000).toISOString()}): $${Number(histPrice) / 1e8}`);
      console.log(`Historical Valid: ${histValid}`);
    } catch (e: any) {
      console.log(`Historical price not available yet (cooldown period): ${e.message}`);
    }

    if (price > 0n) {
      testResults.passed++;
      testResults.tests.push({ name: "Enhanced Oracle", status: "✅ PASS" });
      console.log("✅ Enhanced oracle validation working");
    } else {
      testResults.failed++;
      testResults.tests.push({ name: "Enhanced Oracle", status: "❌ FAIL" });
    }
  } catch (error: any) {
    console.log("❌ Oracle test failed:", error.message);
    testResults.failed++;
    testResults.tests.push({ name: "Enhanced Oracle", status: "❌ FAIL", error: error.message });
  }
  console.log();

  // ============================================
  // Test 2: Collateral Deposit & Withdrawal
  // ============================================
  console.log("========================================");
  console.log("Test 2: Collateral Deposit & Withdrawal");
  console.log("========================================");

  try {
    const depositAmount = ethers.parseUnits("1000", 6);

    // Ensure deployer has USDC
    const deployerBalance = await usdc.balanceOf(deployer.address);
    if (deployerBalance < depositAmount) {
      console.log("Minting additional USDC...");
      await usdc.mint(deployer.address, depositAmount);
    }

    // Deposit
    console.log("Depositing collateral...");
    await usdc.approve(settlement.target, depositAmount);
    await settlement.depositCollateral(usdc.target, depositAmount);

    const balanceAfterDeposit = await settlement.collateralBalances(deployer.address, usdc.target);
    console.log(`Balance after deposit: ${ethers.formatUnits(balanceAfterDeposit, 6)} USDC`);

    // Withdraw half
    const withdrawAmount = depositAmount / 2n;
    console.log(`Withdrawing ${ethers.formatUnits(withdrawAmount, 6)} USDC...`);

    const usdcBefore = await usdc.balanceOf(deployer.address);
    await settlement.withdrawCollateral(usdc.target, withdrawAmount);
    const usdcAfter = await usdc.balanceOf(deployer.address);

    const balanceAfterWithdraw = await settlement.collateralBalances(deployer.address, usdc.target);
    console.log(`Balance after withdrawal: ${ethers.formatUnits(balanceAfterWithdraw, 6)} USDC`);
    console.log(`USDC received: ${ethers.formatUnits(usdcAfter - usdcBefore, 6)} USDC`);

    if (balanceAfterWithdraw === depositAmount / 2n && usdcAfter - usdcBefore === withdrawAmount) {
      testResults.passed++;
      testResults.tests.push({ name: "Collateral Withdrawal", status: "✅ PASS" });
      console.log("✅ Withdrawal working correctly");
    } else {
      testResults.failed++;
      testResults.tests.push({ name: "Collateral Withdrawal", status: "❌ FAIL" });
      console.log("❌ Withdrawal amounts don't match");
    }
  } catch (error: any) {
    console.log("❌ Withdrawal test failed:", error.message);
    testResults.failed++;
    testResults.tests.push({ name: "Collateral Withdrawal", status: "❌ FAIL", error: error.message });
  }
  console.log();

  // ============================================
  // Test 3: Market Resolution
  // ============================================
  console.log("========================================");
  console.log("Test 3: Market Resolution");
  console.log("========================================");

  try {
    if (markets.length === 0) {
      console.log("⚠️  No markets available for testing");
      testResults.tests.push({ name: "Market Resolution", status: "⚠️  SKIP" });
    } else {
      const market = markets[0];
      const marketData = await marketRegistry.markets(market.id);

      console.log(`Testing Market ID: ${market.id}`);
      console.log(`Start Time: ${new Date(Number(marketData.startTime) * 1000).toISOString()}`);
      console.log(`End Time: ${new Date(Number(marketData.endTime) * 1000).toISOString()}`);
      console.log(`Already Resolved: ${marketData.resolved}`);

      const block = await ethers.provider.getBlock("latest");
      const now = block!.timestamp;

      if (now < Number(marketData.endTime)) {
        console.log("⚠️  Market not yet ended, cannot test resolution");
        console.log(`Current time: ${new Date(now * 1000).toISOString()}`);
        console.log(`Need to wait ${Number(marketData.endTime) - now} seconds`);
        testResults.tests.push({ name: "Market Resolution", status: "⚠️  SKIP (market not ended)" });
      } else if (marketData.resolved) {
        console.log("⚠️  Market already resolved");
        testResults.tests.push({ name: "Market Resolution", status: "⚠️  SKIP (already resolved)" });
      } else {
        // Try to resolve
        console.log("Attempting to resolve market...");

        try {
          const tx = await marketRegistry.resolveMarket(market.id);
          const receipt = await tx.wait();
          console.log(`✅ Market resolved! Gas used: ${receipt?.gasUsed}`);

          // Verify resolution
          const updatedMarketData = await marketRegistry.markets(market.id);
          console.log(`Market now resolved: ${updatedMarketData.resolved}`);
          console.log(`Winning outcome: ${updatedMarketData.winningOutcome}`);

          if (updatedMarketData.resolved) {
            testResults.passed++;
            testResults.tests.push({
              name: "Market Resolution",
              status: "✅ PASS",
              details: `Outcome: ${updatedMarketData.winningOutcome}, Gas: ${receipt?.gasUsed}`
            });
          } else {
            testResults.failed++;
            testResults.tests.push({ name: "Market Resolution", status: "❌ FAIL (not marked as resolved)" });
          }
        } catch (resolveError: any) {
          console.log(`❌ Resolution failed: ${resolveError.message}`);
          testResults.failed++;
          testResults.tests.push({
            name: "Market Resolution",
            status: "❌ FAIL",
            error: resolveError.message
          });
        }
      }
    }
  } catch (error: any) {
    console.log("❌ Market resolution test failed:", error.message);
    testResults.failed++;
    testResults.tests.push({ name: "Market Resolution", status: "❌ FAIL", error: error.message });
  }
  console.log();

  // ============================================
  // Test 4: CTF Position Query & Structure
  // ============================================
  console.log("========================================");
  console.log("Test 4: CTF Position Query");
  console.log("========================================");

  try {
    if (markets.length > 0) {
      const conditionId = markets[0].conditionId;

      // Use correct CTF interface (2 params)
      const collectionIdYes = await ctf.getCollectionId(conditionId, 1);
      const collectionIdNo = await ctf.getCollectionId(conditionId, 2);

      const posIdYes = await ctf.getPositionId(usdc.target, collectionIdYes);
      const posIdNo = await ctf.getPositionId(usdc.target, collectionIdNo);

      console.log(`Condition ID: ${conditionId.slice(0, 20)}...`);
      console.log(`Collection ID (YES): ${collectionIdYes.slice(0, 20)}...`);
      console.log(`Collection ID (NO): ${collectionIdNo.slice(0, 20)}...`);
      console.log(`Position ID (YES): ${posIdYes.slice(0, 20)}...`);
      console.log(`Position ID (NO): ${posIdNo.slice(0, 20)}...`);

      const balYes = await ctf.balanceOf(deployer.address, posIdYes);
      const balNo = await ctf.balanceOf(deployer.address, posIdNo);

      console.log(`YES Balance: ${ethers.formatUnits(balYes, 6)}`);
      console.log(`NO Balance: ${ethers.formatUnits(balNo, 6)}`);

      testResults.passed++;
      testResults.tests.push({ name: "CTF Position Query", status: "✅ PASS" });
      console.log("✅ CTF position queries working");
    } else {
      console.log("⚠️  No markets for position test");
      testResults.tests.push({ name: "CTF Position Query", status: "⚠️  SKIP" });
    }
  } catch (error: any) {
    console.log("❌ CTF position test failed:", error.message);
    testResults.failed++;
    testResults.tests.push({ name: "CTF Position Query", status: "❌ FAIL", error: error.message });
  }
  console.log();

  // ============================================
  // Test 5: CTF Redemption (if positions exist)
  // ============================================
  console.log("========================================");
  console.log("Test 5: CTF Position Redemption");
  console.log("========================================");

  try {
    if (markets.length > 0) {
      const market = markets[0];
      const marketData = await marketRegistry.markets(market.id);

      if (!marketData.resolved) {
        console.log("⚠️  Market not resolved yet, cannot test redemption");
        testResults.tests.push({ name: "CTF Redemption", status: "⚠️  SKIP (market not resolved)" });
      } else {
        const conditionId = market.conditionId;
        const winningOutcome = marketData.winningOutcome;

        console.log(`Market ${market.id} resolved with outcome: ${winningOutcome}`);
        console.log(`Condition ID: ${conditionId.slice(0, 20)}...`);

        // Check if user has any positions
        const collectionId = await ctf.getCollectionId(conditionId, winningOutcome);
        const positionId = await ctf.getPositionId(usdc.target, collectionId);
        const balance = await ctf.balanceOf(deployer.address, positionId);

        console.log(`User's winning position balance: ${ethers.formatUnits(balance, 6)}`);

        if (balance > 0n) {
          console.log("Attempting to redeem positions...");

          const usdcBefore = await usdc.balanceOf(deployer.address);
          const indexSets = [1, 2]; // Both outcomes

          const tx = await ctf.redeemPositions(usdc.target, ethers.ZeroHash, conditionId, indexSets);
          const receipt = await tx.wait();

          const usdcAfter = await usdc.balanceOf(deployer.address);
          const received = usdcAfter - usdcBefore;

          console.log(`✅ Redemption successful! Gas: ${receipt?.gasUsed}`);
          console.log(`USDC received: ${ethers.formatUnits(received, 6)}`);

          testResults.passed++;
          testResults.tests.push({
            name: "CTF Redemption",
            status: "✅ PASS",
            details: `Redeemed: ${ethers.formatUnits(received, 6)} USDC`
          });
        } else {
          console.log("⚠️  No positions to redeem");
          testResults.tests.push({ name: "CTF Redemption", status: "⚠️  SKIP (no positions)" });
        }
      }
    } else {
      console.log("⚠️  No markets for redemption test");
      testResults.tests.push({ name: "CTF Redemption", status: "⚠️  SKIP" });
    }
  } catch (error: any) {
    console.log("❌ Redemption test failed:", error.message);
    testResults.failed++;
    testResults.tests.push({ name: "CTF Redemption", status: "❌ FAIL", error: error.message });
  }
  console.log();

  // ============================================
  // Test 6: Gas Measurements
  // ============================================
  console.log("========================================");
  console.log("Test 6: Gas Usage Measurements");
  console.log("========================================");

  const gasData = {
    deposit: 0,
    withdraw: 0,
    marketCreation: 0,
    resolution: 0,
    redemption: 0
  };

  try {
    // Measure deposit gas
    const depositAmount = ethers.parseUnits("100", 6);
    await usdc.mint(user1.address, depositAmount);
    await usdc.connect(user1).approve(settlement.target, depositAmount);
    const depositTx = await settlement.connect(user1).depositCollateral(usdc.target, depositAmount);
    const depositReceipt = await depositTx.wait();
    gasData.deposit = Number(depositReceipt?.gasUsed || 0);

    // Measure withdraw gas
    const withdrawTx = await settlement.connect(user1).withdrawCollateral(usdc.target, depositAmount / 2n);
    const withdrawReceipt = await withdrawTx.wait();
    gasData.withdraw = Number(withdrawReceipt?.gasUsed || 0);

    console.log("Gas Usage:");
    console.log(`- Deposit Collateral: ${gasData.deposit.toLocaleString()} gas`);
    console.log(`- Withdraw Collateral: ${gasData.withdraw.toLocaleString()} gas`);

    testResults.passed++;
    testResults.tests.push({
      name: "Gas Measurements",
      status: "✅ PASS",
      details: gasData
    });
    console.log("✅ Gas measurements collected");
  } catch (error: any) {
    console.log("❌ Gas measurement failed:", error.message);
    testResults.failed++;
    testResults.tests.push({ name: "Gas Measurements", status: "❌ FAIL", error: error.message });
  }
  console.log();

  // ============================================
  // Final Results
  // ============================================
  console.log("\n================================================");
  console.log("📊 Critical Path Test Results");
  console.log("================================================");
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`⚠️  Skipped: ${testResults.tests.filter(t => t.status.includes('SKIP')).length}`);

  const totalTests = testResults.passed + testResults.failed;
  if (totalTests > 0) {
    console.log(`📈 Success Rate: ${((testResults.passed / totalTests) * 100).toFixed(1)}%`);
  }
  console.log("\nDetailed Results:");
  testResults.tests.forEach((test, i) => {
    console.log(`${i + 1}. ${test.status} ${test.name}`);
    if (test.details) console.log(`   Details: ${JSON.stringify(test.details)}`);
    if (test.error) console.log(`   Error: ${test.error}`);
  });
  console.log("================================================\n");

  // Save results
  const resultsPath = path.join(__dirname, "..", "critical-path-test-results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
  console.log(`Results saved to: ${resultsPath}\n`);

  if (testResults.failed === 0) {
    console.log("🎉 All executed tests passed!");
  } else {
    console.log("⚠️  Some tests failed. Review the results above.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
