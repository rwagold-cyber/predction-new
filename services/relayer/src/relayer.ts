import { ethers } from "ethers";
import { Fill, RelayerConfig, SubmissionResult } from "./types";
import * as fs from "fs";
import * as path from "path";
import { retryTransaction } from "../../utils/retry";

/**
 * Relayer - Submits matched orders to blockchain
 *
 * Features:
 * - Batching for gas optimization
 * - Automatic retry with exponential backoff
 * - Gas price monitoring
 * - Transaction tracking
 */
export class Relayer {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private settlement: ethers.Contract;
  private config: RelayerConfig;

  // Pending fills queue
  private pendingFills: Fill[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalSubmitted: 0,
    totalFills: 0,
    totalGasUsed: 0n,
    failedSubmissions: 0,
    permanentlyFailedFills: 0, // 不可重试的失败
  };

  // Callbacks for fill status
  private onFillRejected?: (fill: Fill, reason: string) => void;

  constructor(config: RelayerConfig) {
    this.config = config;

    // Setup provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Load Settlement ABI
    const settlementABI = this.loadSettlementABI();
    this.settlement = new ethers.Contract(
      config.settlementAddress,
      settlementABI,
      this.wallet
    );

    console.log("Relayer initialized");
    console.log("Wallet address:", this.wallet.address);
    console.log("Settlement address:", config.settlementAddress);
  }

  /**
   * Set callback for rejected fills (non-retryable errors)
   */
  setOnFillRejected(callback: (fill: Fill, reason: string) => void): void {
    this.onFillRejected = callback;
  }

  /**
   * Load Settlement V2 ABI from compiled artifacts
   */
  private loadSettlementABI(): any[] {
    // Try multiple paths (local, Docker relative, Docker absolute)
    const paths = [
      path.join(__dirname, "../../../chain/artifacts/contracts/core/SettlementV2.sol/SettlementV2.json"),
      path.join(__dirname, "../chain/artifacts/contracts/core/SettlementV2.sol/SettlementV2.json"),
      "/app/chain/artifacts/contracts/core/SettlementV2.sol/SettlementV2.json"
    ];

    let artifactPath = paths.find(p => fs.existsSync(p));

    if (!artifactPath) {
      throw new Error(`SettlementV2 artifact not found. Tried: ${paths.join(", ")}`);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    return artifact.abi;
  }

  /**
   * Submit fills for settlement
   * Adds to queue and triggers batch submission
   */
  async submitFills(fills: Fill[]): Promise<void> {
    if (fills.length === 0) return;

    console.log(`Queuing ${fills.length} fills for submission`);
    this.pendingFills.push(...fills);

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.config.batchDelayMs);
    }

    // If queue is full, process immediately
    if (this.pendingFills.length >= this.config.batchSize) {
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      await this.processBatch();
    }
  }

  /**
   * Process pending fills batch
   */
  private async processBatch(): Promise<void> {
    this.batchTimer = null;

    if (this.pendingFills.length === 0) return;

    // Take batch from queue
    const batch = this.pendingFills.splice(0, this.config.batchSize);

    console.log(`\n=== Processing Batch ===`);
    console.log(`Fills: ${batch.length}`);

    // Convert to contract format
    const fillStructs = batch.map((fill) => ({
      order: {
        maker: fill.order.maker,
        marketId: fill.order.marketId,
        conditionId: fill.order.conditionId,
        outcome: fill.order.outcome,
        collateral: fill.order.collateral,
        pricePips: fill.order.pricePips,
        amount: fill.order.amount,
        makerFeeBps: fill.order.makerFeeBps,
        takerFeeBps: fill.order.takerFeeBps,
        expiry: fill.order.expiry,
        salt: fill.order.salt,
        nonce: fill.order.nonce,
        mintOnFill: fill.order.mintOnFill,
        allowedTaker: fill.order.allowedTaker,
      },
      signature: fill.signature,
      fillAmount: fill.fillAmount,
      taker: fill.taker,
    }));

    // Submit with retries
    const result = await this.submitWithRetry(fillStructs, batch);

    if (result.success) {
      console.log(`✅ Batch submitted successfully`);
      console.log(`TX Hash: ${result.txHash}`);
      console.log(`Gas Used: ${result.gasUsed?.toString()}`);

      this.stats.totalSubmitted++;
      this.stats.totalFills += batch.length;
      this.stats.totalGasUsed += result.gasUsed || 0n;
    } else {
      console.error(`❌ Batch submission failed: ${result.error}`);
      this.stats.failedSubmissions++;

      // 区分可重试和不可重试的错误
      if (result.retryable) {
        console.warn(`⚠️ 错误可重试，重新入队 ${batch.length} 个订单`);
        this.pendingFills.unshift(...batch);
      } else {
        console.error(`🚫 错误不可重试，丢弃 ${batch.length} 个订单: ${result.error}`);
        this.stats.permanentlyFailedFills += batch.length;

        // 回调通知每个订单永久失败
        if (this.onFillRejected) {
          for (const fill of batch) {
            this.onFillRejected(fill, result.error || "Unknown error");
          }
        }
      }
    }

    console.log(`========================\n`);

    // Process next batch if queue not empty
    if (this.pendingFills.length > 0) {
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.config.batchDelayMs);
    }
  }

  /**
   * Submit batch with retry logic
   */
  private async submitWithRetry(
    fills: any[],
    originalFills: Fill[],
    attempt = 1
  ): Promise<SubmissionResult> {
    try {
      // Check gas price（带重试）
      const feeData = await retryTransaction(
        () => this.provider.getFeeData(),
        { maxRetries: 3, delayMs: 1000, backoff: true }
      );
      const gasPrice = feeData.gasPrice || 0n;
      const maxGasPrice = ethers.parseUnits(this.config.maxGasPrice, "gwei");

      if (gasPrice > maxGasPrice) {
        console.warn(
          `Gas price too high: ${ethers.formatUnits(gasPrice, "gwei")} gwei > ${this.config.maxGasPrice} gwei`
        );
        return {
          success: false,
          error: "Gas price too high",
          retryable: true, // Gas price might drop
        };
      }

      console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

      // Estimate gas（带重试）
      let gasLimit: bigint;
      try {
        gasLimit = await retryTransaction(
          () => this.settlement.batchFill.estimateGas(fills),
          { maxRetries: 3, delayMs: 1000, backoff: true }
        );
        console.log(`Estimated gas: ${gasLimit.toString()}`);
      } catch (error: any) {
        console.error("Gas estimation failed:", error.message);
        const retryable = this.isRetryableError(error);
        return {
          success: false,
          error: `Gas estimation failed: ${error.message}`,
          retryable,
        };
      }

      // Submit transaction
      const tx = await this.settlement.batchFill(fills, {
        gasLimit: gasLimit * 120n / 100n, // Add 20% buffer
        gasPrice: gasPrice,
      });

      console.log(`Transaction sent: ${tx.hash}`);
      console.log("Waiting for confirmation...");

      // Wait for confirmation
      const receipt = await tx.wait(1);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed,
        fillCount: fills.length,
        retryable: false,
      };
    } catch (error: any) {
      console.error(`Submission attempt ${attempt} failed:`, error.message);

      // Check if retryable error
      const retryable = this.isRetryableError(error);

      if (retryable && attempt < this.config.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.submitWithRetry(fills, originalFills, attempt + 1);
      }

      return {
        success: false,
        error: error.message,
        retryable: retryable && attempt >= this.config.maxRetries, // Retryable but exhausted retries
      };
    }
  }

  /**
   * Check if error is retryable
   *
   * 不可重试错误（会导致僵尸订单）：
   * - invalid signature: 签名无效
   * - expired / order expired: 订单过期
   * - insufficient balance / insufficient collateral: 余额不足
   * - overfill: 订单已完全成交
   * - invalid nonce: nonce 无效（用户已取消）
   * - unauthorized: 未授权的 taker
   */
  private isRetryableError(error: any): boolean {
    const message = error.message.toLowerCase();

    // 明确的不可重试错误（黑名单）
    const nonRetryablePatterns = [
      "invalid signature",
      "order expired",
      "expired",
      "insufficient balance",
      "insufficient collateral",
      "overfill",
      "invalid nonce",
      "unauthorized taker",
      "unauthorized",
      "unsupported collateral",
      "invalid outcome",
      "invalid amount",
    ];

    for (const pattern of nonRetryablePatterns) {
      if (message.includes(pattern)) {
        console.log(`🚫 Non-retryable error detected: ${pattern}`);
        return false;
      }
    }

    // 可重试的网络错误
    const retryablePatterns = [
      "network",
      "timeout",
      "connection",
      "econnrefused",
      "enotfound",
      "503", // Service unavailable
      "502", // Bad gateway
      "429", // Rate limit
    ];

    for (const pattern of retryablePatterns) {
      if (message.includes(pattern)) {
        console.log(`⚠️ Retryable network error detected: ${pattern}`);
        return true;
      }
    }

    // Nonce errors - 可能是并发问题，可重试
    if (message.includes("nonce too low") || message.includes("replacement")) {
      console.log(`⚠️ Retryable nonce error detected`);
      return true;
    }

    // Gas errors - 可能暂时性，可重试
    if (message.includes("gas") && !message.includes("out of gas")) {
      console.log(`⚠️ Retryable gas error detected`);
      return true;
    }

    // 默认不重试未知错误，避免僵尸订单
    console.log(`🚫 Unknown error, treating as non-retryable`);
    return false;
  }

  /**
   * Get relayer statistics
   */
  getStats() {
    return {
      ...this.stats,
      pendingFills: this.pendingFills.length,
      averageGasPerSubmission:
        this.stats.totalSubmitted > 0
          ? this.stats.totalGasUsed / BigInt(this.stats.totalSubmitted)
          : 0n,
      averageFillsPerBatch:
        this.stats.totalSubmitted > 0
          ? this.stats.totalFills / this.stats.totalSubmitted
          : 0,
      permanentlyFailedFills: this.stats.permanentlyFailedFills,
    };
  }

  /**
   * Force flush pending fills
   */
  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.processBatch();
  }

  /**
   * Shutdown relayer gracefully
   */
  async shutdown(): Promise<void> {
    console.log("Shutting down relayer...");
    await this.flush();
    console.log("Relayer stopped");
  }
}

/**
 * Main relayer service
 */
async function main() {
  console.log("Starting Relayer Service...\n");

  // Load configuration
  const addressesPath = path.join(
    __dirname,
    "../../../chain/addresses.json"
  );

  let settlementAddress = "";
  let chainId = 1111111;

  if (fs.existsSync(addressesPath)) {
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    settlementAddress = addresses.settlementV2 || addresses.settlement;
    chainId = parseInt(addresses.chainId);
  } else {
    console.error("addresses.json not found!");
    process.exit(1);
  }

  // Load environment variables
  const rpcUrl = process.env.RPC_URL || "https://rpc-testnet.socrateschain.org";
  const privateKey = process.env.RELAYER_PRIVATE_KEY;

  if (!privateKey) {
    console.error("RELAYER_PRIVATE_KEY environment variable required!");
    process.exit(1);
  }

  // Create relayer config
  const config: RelayerConfig = {
    rpcUrl,
    privateKey,
    settlementAddress,
    chainId,
    batchSize: parseInt(process.env.BATCH_SIZE || "10"),
    batchDelayMs: parseInt(process.env.BATCH_DELAY_MS || "2000"),
    maxGasPrice: process.env.MAX_GAS_PRICE || "100", // 100 gwei
    maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
  };

  const relayer = new Relayer(config);

  // Export for external use (e.g., integration with Matcher)
  (global as any).relayer = relayer;

  // Stats logging
  setInterval(() => {
    const stats = relayer.getStats();
    if (stats.totalSubmitted > 0 || stats.pendingFills > 0 || stats.permanentlyFailedFills > 0) {
      console.log("\n=== Relayer Statistics ===");
      console.log(`Total Submissions: ${stats.totalSubmitted}`);
      console.log(`Total Fills: ${stats.totalFills}`);
      console.log(`Failed Submissions: ${stats.failedSubmissions}`);
      console.log(`Permanently Failed: ${stats.permanentlyFailedFills}`);
      console.log(`Pending Fills: ${stats.pendingFills}`);
      console.log(`Avg Gas Per Submission: ${stats.averageGasPerSubmission.toString()}`);
      console.log(`Avg Fills Per Batch: ${stats.averageFillsPerBatch.toFixed(2)}`);
      console.log("=========================\n");
    }
  }, 30000); // Log every 30 seconds

  console.log("Relayer service running...");
  console.log("Waiting for fills from Matcher...\n");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await relayer.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await relayer.shutdown();
    process.exit(0);
  });
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
