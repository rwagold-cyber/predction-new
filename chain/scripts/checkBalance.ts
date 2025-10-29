import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const address = signer.address;

  console.log("Checking balances for:", address);

  // Get native token balance
  const balance = await ethers.provider.getBalance(address);
  console.log("\nNative Token Balance:", ethers.formatEther(balance), "ETH");

  // Try to get USDC balance if available
  try {
    const addressesPath = require("path").join(__dirname, "..", "addresses.json");
    const fs = require("fs");

    if (fs.existsSync(addressesPath)) {
      const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

      if (addresses.usdc) {
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        const usdc = MockUSDC.attach(addresses.usdc);
        const usdcBalance = await usdc.balanceOf(address);
        console.log("USDC Balance:", ethers.formatUnits(usdcBalance, 6), "USDC");
      }
    }
  } catch (error) {
    // USDC not deployed yet, skip
  }

  console.log("\n✓ Balance check complete");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
