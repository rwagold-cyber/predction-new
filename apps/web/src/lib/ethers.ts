import { ethers } from 'ethers';
import {
  USDC_ADDRESS,
  SETTLEMENT_ADDRESS,
  MARKET_REGISTRY_ADDRESS,
  CTF_ADDRESS,
  CHAIN_ID,
  ERC20_ABI,
  SETTLEMENT_ABI,
  CTF_ABI,
  MARKET_REGISTRY_ABI,
  ORDER_TYPES,
  getEip712Domain,
} from './contracts';

const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://rpc-testnet.socrateschain.org';

// Global provider instance
export const provider = new ethers.JsonRpcProvider(RPC_URL);

// Create wallet from private key
export function createWallet(privateKey: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, provider);
}

// Get contract instances
export function getUSDCContract(signerOrProvider: ethers.Wallet | ethers.JsonRpcProvider) {
  return new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signerOrProvider);
}

export function getSettlementContract(signerOrProvider: ethers.Wallet | ethers.JsonRpcProvider) {
  return new ethers.Contract(SETTLEMENT_ADDRESS, SETTLEMENT_ABI, signerOrProvider);
}

export function getCTFContract(signerOrProvider: ethers.Wallet | ethers.JsonRpcProvider) {
  return new ethers.Contract(CTF_ADDRESS, CTF_ABI, signerOrProvider);
}

export function getMarketRegistryContract(signerOrProvider: ethers.Wallet | ethers.JsonRpcProvider) {
  return new ethers.Contract(MARKET_REGISTRY_ADDRESS, MARKET_REGISTRY_ABI, signerOrProvider);
}

// Order interface matching backend
export interface OrderV2 {
  maker: string;
  marketId: string;
  conditionId: string;
  outcome: number;
  collateral: string;
  pricePips: string;
  amount: string;
  makerFeeBps: number;
  takerFeeBps: number;
  expiry: number;
  salt: string;
  nonce: number;
  mintOnFill: boolean;
  allowedTaker: string;
  chainId: number;
  verifyingContract: string;
}

// Sign an order using EIP-712
export async function signOrder(wallet: ethers.Wallet, order: OrderV2): Promise<string> {
  const domain = getEip712Domain();
  const signature = await wallet.signTypedData(domain, ORDER_TYPES, order);
  return signature;
}

// Helper to calculate positionId from conditionId and outcome
export function getPositionId(conditionId: string, outcome: number): bigint {
  // CTF Contract calculation:
  // collectionId = keccak256(abi.encodePacked(conditionId, indexSet))
  // positionId = uint256(keccak256(abi.encodePacked(collateralToken, collectionId)))

  const indexSet = outcome === 0 ? 1 : 2;

  // Step 1: Calculate collectionId using solidityPackedKeccak256
  const collectionId = ethers.solidityPackedKeccak256(
    ['bytes32', 'uint256'],
    [conditionId, indexSet]
  );

  // Step 2: Calculate positionId including USDC_ADDRESS
  const positionId = ethers.solidityPackedKeccak256(
    ['address', 'bytes32'],
    [USDC_ADDRESS, collectionId]
  );

  return BigInt(positionId);
}

// Format price from pips (1 pip = 0.0001) to display
export function formatPrice(pricePips: string | number): string {
  const pips = typeof pricePips === 'string' ? parseInt(pricePips) : pricePips;
  return (pips / 10000).toFixed(4);
}

// Parse display price to pips
export function parsePriceToPips(price: string | number): string {
  const priceNum = typeof price === 'string' ? parseFloat(price) : price;
  return Math.round(priceNum * 10000).toString();
}

// Format amount from wei to USDC (6 decimals)
export function formatUSDC(amount: string | bigint): string {
  return ethers.formatUnits(amount, 6);
}

// Parse USDC to wei (6 decimals)
export function parseUSDC(amount: string | number): bigint {
  return ethers.parseUnits(amount.toString(), 6);
}
