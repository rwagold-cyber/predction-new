import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Debug order flow to find the issue
 */
async function main() {
  console.log("\n================================================");
  console.log("Debugging Order Flow");
  console.log("================================================\n");

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  // Get signers
  const [maker, taker] = await ethers.getSigners();
  console.log("Accounts:");
  console.log("- Maker:", maker.address);
  console.log("- Taker:", taker.address);

  // Check balances
  const makerBalance = await ethers.provider.getBalance(maker.address);
  const takerBalance = await ethers.provider.getBalance(taker.address);
  console.log("- Maker ETH:", ethers.formatEther(makerBalance));
  console.log("- Taker ETH:", ethers.formatEther(takerBalance));
  console.log("");

  // Connect to contracts
  const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);
  const settlement = await ethers.getContractAt(
    "SettlementV2",
    addresses.settlementV2
  );

  console.log("Contracts:");
  console.log("- USDC:", addresses.usdc);
  console.log("- Settlement:", addresses.settlementV2);
  console.log("");

  // Step 1: Mint USDC
  console.log("Step 1: Minting USDC...");
  const mintAmount = ethers.parseUnits("1000", 6);

  try {
    await usdc.connect(maker).mint(maker.address, mintAmount);
    console.log("✅ Maker minted 1000 USDC");
  } catch (error: any) {
    console.error("❌ Maker mint failed:", error.message);
  }

  try {
    await usdc.connect(taker).mint(taker.address, mintAmount);
    console.log("✅ Taker minted 1000 USDC");
  } catch (error: any) {
    console.error("❌ Taker mint failed:", error.message);
  }

  // Check USDC balances
  const makerUSDC = await usdc.balanceOf(maker.address);
  const takerUSDC = await usdc.balanceOf(taker.address);
  console.log("- Maker USDC:", ethers.formatUnits(makerUSDC, 6));
  console.log("- Taker USDC:", ethers.formatUnits(takerUSDC, 6));
  console.log("");

  // Step 2: Check if USDC is whitelisted
  console.log("Step 2: Checking collateral whitelist...");
  const isWhitelisted = await settlement.supportedCollateral(usdc.target);
  console.log("- USDC whitelisted:", isWhitelisted);

  if (!isWhitelisted) {
    console.error("❌ USDC is not whitelisted in Settlement contract!");
  }
  console.log("");

  // Step 3: Approve
  console.log("Step 3: Approving USDC...");
  const depositAmount = ethers.parseUnits("100", 6);

  try {
    const tx1 = await usdc.connect(maker).approve(settlement.target, depositAmount);
    await tx1.wait();
    console.log("✅ Maker approved 100 USDC");
  } catch (error: any) {
    console.error("❌ Maker approve failed:", error.message);
  }

  try {
    const tx2 = await usdc.connect(taker).approve(settlement.target, depositAmount);
    await tx2.wait();
    console.log("✅ Taker approved 100 USDC");
  } catch (error: any) {
    console.error("❌ Taker approve failed:", error.message);
  }

  // Check allowances
  const makerAllowance = await usdc.allowance(maker.address, settlement.target);
  const takerAllowance = await usdc.allowance(taker.address, settlement.target);
  console.log("- Maker allowance:", ethers.formatUnits(makerAllowance, 6));
  console.log("- Taker allowance:", ethers.formatUnits(takerAllowance, 6));
  console.log("");

  // Step 4: Deposit
  console.log("Step 4: Depositing collateral...");

  try {
    const tx3 = await settlement.connect(maker).depositCollateral(usdc.target, depositAmount);
    await tx3.wait();
    console.log("✅ Maker deposited 100 USDC");
  } catch (error: any) {
    console.error("❌ Maker deposit failed:");
    console.error("Error:", error.message);
    if (error.data) {
      console.error("Data:", error.data);
    }
  }

  try {
    const tx4 = await settlement.connect(taker).depositCollateral(usdc.target, depositAmount);
    await tx4.wait();
    console.log("✅ Taker deposited 100 USDC");
  } catch (error: any) {
    console.error("❌ Taker deposit failed:");
    console.error("Error:", error.message);
    if (error.data) {
      console.error("Data:", error.data);
    }
  }

  // Check balances in settlement
  const makerDeposit = await settlement.balances(maker.address, usdc.target);
  const takerDeposit = await settlement.balances(taker.address, usdc.target);
  console.log("- Maker deposit in Settlement:", ethers.formatUnits(makerDeposit, 6));
  console.log("- Taker deposit in Settlement:", ethers.formatUnits(takerDeposit, 6));

  console.log("\n================================================");
  console.log("Debug Complete");
  console.log("================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
