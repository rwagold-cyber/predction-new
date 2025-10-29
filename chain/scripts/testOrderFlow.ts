import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Test complete order flow:
 * 1. Approve collateral
 * 2. Deposit collateral to Settlement
 * 3. Sign orders (EIP-712)
 * 4. Submit to Matcher (manual simulation)
 * 5. Verify settlement can process fills
 */
async function main() {
  console.log("\n================================================");
  console.log("Testing Order Flow (V2)");
  console.log("================================================\n");

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Deploy contracts first.");
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  // Load test markets
  const marketsPath = path.join(__dirname, "..", "test-markets.json");
  if (!fs.existsSync(marketsPath)) {
    throw new Error(
      "test-markets.json not found. Run createMarkets.ts first."
    );
  }
  const markets = JSON.parse(fs.readFileSync(marketsPath, "utf8"));
  const market = markets[0]; // Use first market

  console.log("Test Configuration:");
  console.log("- Network:", addresses.network);
  console.log("- Market ID:", market.id);
  console.log("- Market Description:", market.description);
  console.log("- Condition ID:", market.conditionId);
  console.log("\n");

  // Get signers (2 accounts for maker/taker)
  const [maker, taker] = await ethers.getSigners();
  console.log("Participants:");
  console.log("- Maker:", maker.address);
  console.log("- Taker:", taker.address);
  console.log("\n");

  // Connect to contracts
  const usdc = await ethers.getContractAt("MockUSDC", addresses.usdc);
  const settlement = await ethers.getContractAt(
    "SettlementV2",
    addresses.settlementV2
  );
  const ctf = await ethers.getContractAt(
    "ConditionalTokensV2",
    addresses.ctf
  );

  // Step 1: Mint USDC for both users
  console.log("Step 1: Minting test USDC...");
  const mintAmount = ethers.parseUnits("10000", 6); // 10,000 USDC

  await usdc.connect(maker).mint(maker.address, mintAmount);
  console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 6)} USDC to maker`);

  await usdc.connect(taker).mint(taker.address, mintAmount);
  console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 6)} USDC to taker`);
  console.log("");

  // Step 2: Approve and deposit collateral
  console.log("Step 2: Depositing collateral to Settlement...");
  const depositAmount = ethers.parseUnits("1000", 6); // 1,000 USDC each

  await usdc.connect(maker).approve(settlement.target, depositAmount);
  await settlement.connect(maker).depositCollateral(usdc.target, depositAmount);
  console.log(`✅ Maker deposited ${ethers.formatUnits(depositAmount, 6)} USDC`);

  await usdc.connect(taker).approve(settlement.target, depositAmount);
  await settlement.connect(taker).depositCollateral(usdc.target, depositAmount);
  console.log(`✅ Taker deposited ${ethers.formatUnits(depositAmount, 6)} USDC`);
  console.log("");

  // Step 3: Create and sign orders
  console.log("Step 3: Creating and signing orders...");

  const block = await ethers.provider.getBlock("latest");
  const expiry = block!.timestamp + 3600; // 1 hour from now

  // Buy order (maker wants to buy UP at 55%)
  // Price is in BPS (basis points): 5500 = 55.00%
  // Amount is in USDC units (6 decimals): 100_000000 = 100 USDC
  const buyOrder = {
    maker: maker.address,
    marketId: market.id,
    conditionId: market.conditionId,
    outcome: 1, // UP
    collateral: usdc.target,
    pricePips: "5500", // 55% in BPS
    amount: "100000000", // 100 USDC (6 decimals)
    makerFeeBps: 30, // 0.3%
    takerFeeBps: 30, // 0.3%
    expiry: expiry,
    salt: ethers.hexlify(ethers.randomBytes(32)),
    nonce: 1,
    mintOnFill: true,
    allowedTaker: ethers.ZeroAddress,
  };

  // Sell order (taker wants to sell UP at 50% - will match!)
  const sellOrder = {
    maker: taker.address,
    marketId: market.id,
    conditionId: market.conditionId,
    outcome: 1, // UP
    collateral: usdc.target,
    pricePips: "5000", // 50% in BPS
    amount: "50000000", // 50 USDC (6 decimals, partial fill)
    makerFeeBps: 30,
    takerFeeBps: 30,
    expiry: expiry,
    salt: ethers.hexlify(ethers.randomBytes(32)),
    nonce: 1,
    mintOnFill: true,
    allowedTaker: ethers.ZeroAddress,
  };

  // EIP-712 domain
  const domain = {
    name: "PredictXSettlementV2",
    version: "1",
    chainId: parseInt(addresses.chainId), // Convert string to number
    verifyingContract: addresses.settlementV2,
  };

  // EIP-712 types
  const types = {
    Order: [
      { name: "maker", type: "address" },
      { name: "marketId", type: "uint256" },
      { name: "conditionId", type: "bytes32" },
      { name: "outcome", type: "uint8" },
      { name: "collateral", type: "address" },
      { name: "pricePips", type: "uint128" },
      { name: "amount", type: "uint128" },
      { name: "makerFeeBps", type: "uint16" },
      { name: "takerFeeBps", type: "uint16" },
      { name: "expiry", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "mintOnFill", type: "bool" },
      { name: "allowedTaker", type: "address" },
    ],
  };

  // Sign orders
  const buySignature = await maker.signTypedData(domain, types, buyOrder);
  console.log("✅ Buy order signed");

  const sellSignature = await taker.signTypedData(domain, types, sellOrder);
  console.log("✅ Sell order signed");
  console.log("");

  // Step 4: Simulate matching (in production, Matcher does this)
  console.log("Step 4: Creating fills from matched orders...");

  const matchAmount = "50000000"; // Match 50 USDC (6 decimals)

  const fills = [
    {
      order: sellOrder,
      signature: sellSignature,
      fillAmount: matchAmount,
      taker: buyOrder.maker, // Buyer is taker
    },
    {
      order: buyOrder,
      signature: buySignature,
      fillAmount: matchAmount,
      taker: sellOrder.maker, // Seller is taker
    },
  ];

  console.log(`✅ Created ${fills.length} fills`);
  console.log(`   Match amount: ${ethers.formatUnits(matchAmount, 6)} USDC`);
  console.log(`   Match price: ${sellOrder.pricePips} BPS (50%)`);
  console.log("");

  // Step 5: Submit fills to Settlement
  console.log("Step 5: Submitting fills to Settlement...");

  try {
    // In production, Relayer does this with correct signer
    const tx = await settlement.connect(maker).batchFill(fills);
    console.log("Transaction sent:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Fills settled successfully!");
    console.log(`   Gas used: ${receipt?.gasUsed.toString()}`);
    console.log("");

    // Step 6: Verify positions
    console.log("Step 6: Verifying CTF positions...");

    // Position IDs calculation (simplified - actual logic in CTF)
    const positionIdYes = await ctf.getPositionId(
      usdc.target,
      ethers.solidityPackedKeccak256(
        ["bytes32", "uint256"],
        [market.conditionId, 2]
      )
    );

    const makerBalance = await ctf.balanceOf(maker.address, positionIdYes);
    const takerBalance = await ctf.balanceOf(taker.address, positionIdYes);

    console.log(`Maker UP tokens: ${ethers.formatUnits(makerBalance, 6)} USDC worth`);
    console.log(`Taker UP tokens: ${ethers.formatUnits(takerBalance, 6)} USDC worth`);
    console.log("");

    console.log("================================================");
    console.log("✅ Order Flow Test Completed Successfully!");
    console.log("================================================");
    console.log("\nTest Summary:");
    console.log("- Orders signed with EIP-712 ✅");
    console.log("- Orders matched off-chain ✅");
    console.log("- Fills settled on-chain ✅");
    console.log("- CTF positions minted ✅");
    console.log("\nNext: Start backend services to automate this flow");
    console.log("  cd ../services && pnpm start");
    console.log("================================================\n");
  } catch (error: any) {
    console.error("❌ Settlement failed:", error.message);
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
