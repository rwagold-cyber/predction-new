import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const provider = ethers.provider;

  let faucetSigner = (await ethers.getSigners())[0];
  const faucetPk = process.env.FAUCET_PK;

  if (faucetPk && faucetPk.startsWith("0x")) {
    faucetSigner = new ethers.Wallet(faucetPk, provider);
  }

  console.log("Minting USDC with account:", faucetSigner.address);

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("addresses.json not found. Please deploy contracts first.");
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const usdcAddress = addresses.usdc;

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach(usdcAddress);

  console.log("Minting 100,000 USDC to", faucetSigner.address);
  const tx = await usdc
    .connect(faucetSigner)
    .mint(faucetSigner.address, ethers.parseUnits("100000", 6));
  await tx.wait();

  const balance = await usdc.balanceOf(faucetSigner.address);
  console.log("New balance:", ethers.formatUnits(balance, 6), "USDC");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
