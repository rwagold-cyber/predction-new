import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import * as fs from "fs";
import * as path from "path";

/**
 * V2 Deployment - CTF-based Architecture
 *
 * Deploys:
 * 1. MockUSDC (test collateral)
 * 2. ConditionalTokensV2 (CTF for position management)
 * 3. SettlementV2 (trading logic with CTF integration)
 * 4. MarketRegistryV2 (market management with CTF)
 * 5. PythOracleAdapter (price oracle)
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, execute } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("\n================================================");
  console.log("🚀 PredictX V2 Deployment (CTF Architecture)");
  console.log("================================================");
  console.log("Deploying contracts with account:", deployer);

  const balance = await ethers.provider.getBalance(deployer);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Oracle configuration
  const pythOracleAddress =
    process.env.BTC_ORACLE_ADDRESS ||
    "0x132923f95FD7E8a6FD8aC302D8fd92317F23aFfd"; // Socrates testnet
  const btcFeedId =
    process.env.BTC_FEED_ID ||
    "0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de";
  const coolDownPeriod = process.env.ORACLE_READ_COOL_DOWN_SECS || "60";

  // Step 1: Deploy MockUSDC
  console.log("\n========================================");
  console.log("Step 1/5: Deploying Mock USDC...");
  console.log("========================================");
  const usdc = await deploy("MockUSDC", {
    from: deployer,
    args: [],
    log: true,
  });
  console.log("✅ MockUSDC deployed to:", usdc.address);

  // Step 2: Deploy ConditionalTokensV2 (CTF)
  console.log("\n========================================");
  console.log("Step 2/5: Deploying CTF...");
  console.log("========================================");
  const ctf = await deploy("ConditionalTokensV2", {
    from: deployer,
    args: [],
    log: true,
  });
  console.log("✅ ConditionalTokensV2 deployed to:", ctf.address);

  // Step 3: Deploy SettlementV2
  console.log("\n========================================");
  console.log("Step 3/5: Deploying SettlementV2...");
  console.log("========================================");
  const settlementV2 = await deploy("SettlementV2", {
    from: deployer,
    args: [ctf.address],
    log: true,
  });
  console.log("✅ SettlementV2 deployed to:", settlementV2.address);

  // Whitelist MockUSDC
  console.log("\nWhitelisting MockUSDC as supported collateral...");
  await execute(
    "SettlementV2",
    { from: deployer, log: true },
    "setCollateralSupport",
    usdc.address,
    true
  );
  console.log("✅ MockUSDC whitelisted");

  // Step 4: Deploy PythOracleAdapter
  console.log("\n========================================");
  console.log("Step 4/5: Deploying PythOracleAdapter...");
  console.log("========================================");
  const oracleAdapter = await deploy("PythOracleAdapter", {
    from: deployer,
    args: [pythOracleAddress, btcFeedId, coolDownPeriod],
    log: true,
  });
  console.log("✅ PythOracleAdapter deployed to:", oracleAdapter.address);

  // Step 5: Deploy MarketRegistryV2
  console.log("\n========================================");
  console.log("Step 5/5: Deploying MarketRegistryV2...");
  console.log("========================================");
  const marketRegistryV2 = await deploy("MarketRegistryV2", {
    from: deployer,
    args: [ctf.address],  // Only CTF address
    log: true,
  });
  console.log("✅ MarketRegistryV2 deployed to:", marketRegistryV2.address);

  console.log("\nNote: MarketRegistryV2 will call CTF.prepareCondition() and CTF.reportPayouts()");
  console.log("CTF allows any address to call these functions (no access control)");

  // Save addresses
  const network = await ethers.provider.getNetwork();
  const addresses = {
    network: hre.network.name,
    chainId: network.chainId.toString(),
    usdc: usdc.address,
    ctf: ctf.address,
    settlementV2: settlementV2.address,
    marketRegistryV2: marketRegistryV2.address,
    oracleAdapter: oracleAdapter.address,
    pythOracle: pythOracleAddress,
    btcFeedId: btcFeedId,
    deployer: deployer,
  };

  const addressesPath = path.join(__dirname, "..", "addresses.json");
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));

  console.log("\n================================================");
  console.log("📝 Deployment Summary");
  console.log("================================================");
  console.log(JSON.stringify(addresses, null, 2));

  console.log("\n================================================");
  console.log("✅ All V2 Contracts Deployed Successfully!");
  console.log("================================================");

  console.log("\n📋 Next Steps:");
  console.log("1. Mint test USDC:");
  console.log("   npx hardhat run scripts/mintUSDC.ts --network soc_test");
  console.log("\n2. Create test markets:");
  console.log("   npx hardhat run scripts/createMarketsV2.ts --network soc_test");
  console.log("\n3. Start backend services:");
  console.log("   cd ../services && pnpm start");
  console.log("\n4. Test order submission:");
  console.log("   npx hardhat run scripts/testOrderFlow.ts --network soc_test");
  console.log("================================================\n");
};

export default func;
func.tags = ["v2", "all"];
