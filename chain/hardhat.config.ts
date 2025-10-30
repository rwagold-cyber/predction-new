import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const CHAIN_ID = 1111111;
const RPC_URL = process.env.RPC_URL || "https://rpc-testnet.socrateschain.org";

const accountEnvVars = [
  process.env.DEPLOYER_PK,
  process.env.FAUCET_PK,
  process.env.RELAYER_PK,
  process.env.DEMO_TRADER_PK,
  process.env.LIQUIDITY_PROVIDER_PK,
].filter((pk): pk is string => Boolean(pk && pk.startsWith("0x")));

// Provide at least one account so Hardhat doesn't crash during tests
if (accountEnvVars.length === 0) {
  accountEnvVars.push(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
  );
}

const resolveIndex = (index: number) =>
  accountEnvVars.length > index ? index : 0;

const namedAccountsConfig = {
  deployer: {
    default: resolveIndex(0),
  },
  faucet: {
    default: resolveIndex(1),
  },
  relayer: {
    default: resolveIndex(2),
  },
  trader: {
    default: resolveIndex(3),
  },
  liquidityProvider: {
    default: resolveIndex(4),
  },
};

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
  namedAccounts: namedAccountsConfig,
  networks: {
    soc_test: {
      chainId: CHAIN_ID,
      url: RPC_URL,
      accounts: accountEnvVars,
      gasPrice: "auto",
    },
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      soc_test: "empty",
    },
    customChains: [
      {
        network: "soc_test",
        chainId: CHAIN_ID,
        urls: {
          apiURL: "https://explorer-testnet.socrateschain.org/api",
          browserURL: "https://explorer-testnet.socrateschain.org",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
