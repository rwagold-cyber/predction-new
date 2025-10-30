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

export interface Fill {
  order: OrderV2;
  signature: string;
  fillAmount: string;
  taker: string;
}

export interface RelayerConfig {
  rpcUrl: string;
  privateKey: string;
  settlementAddress: string;
  chainId: number;
  batchSize: number;
  batchDelayMs: number;
  maxGasPrice: string; // in gwei
  maxRetries: number;
}

export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: bigint;
  fillCount?: number;
  retryable?: boolean; // 是否为可重试错误
}
