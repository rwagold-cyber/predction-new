import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Minting USDC with account:", signer.address);

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Please deploy contracts first.");
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const usdcAddress = addresses.usdc;

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach(usdcAddress);

  console.log("Minting 100,000 USDC to", signer.address);
  const tx = await usdc.mint(signer.address, ethers.parseUnits("100000", 6));
  await tx.wait();

  const balance = await usdc.balanceOf(signer.address);
  console.log("New balance:", ethers.formatUnits(balance, 6), "USDC");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
