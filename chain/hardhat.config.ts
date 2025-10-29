import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const CHAIN_ID = 1111111;
const RPC_URL = process.env.RPC_URL || "https://rpc-testnet.socrateschain.org";
const DEPLOYER_PK = process.env.DEPLOYER_PK || "0x0000000000000000000000000000000000000000000000000000000000000001";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500,
      },
      viaIR: true,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    soc_test: {
      chainId: CHAIN_ID,
      url: RPC_URL,
      accounts: [DEPLOYER_PK],
      gasPrice: "auto",
    },
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
