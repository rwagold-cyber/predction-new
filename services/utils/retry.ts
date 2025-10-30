/**
 * 共享的重试工具模块
 * 用于处理网络间歇性问题
 */

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  backoff?: boolean; // 指数退避
}

/**
 * 重试执行交易 - 处理网络间歇性问题
 */
export async function retryTransaction<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 3000,
    backoff = true,
  } = options;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      if (i === maxRetries - 1) {
        throw error;
      }

      // 计算延迟（指数退避或固定延迟）
      const delay = backoff
        ? Math.min(delayMs * Math.pow(2, i), 30000)
        : delayMs;

      console.log(
        `   ⚠️ 交易失败 (${i + 1}/${maxRetries}): ${error.message}`
      );
      console.log(`   等待 ${delay / 1000} 秒后重试...`);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Should not reach here");
}

/**
 * 带条件的重试 - 只重试特定错误
 */
export async function retryTransactionIf<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: any) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 3000,
    backoff = true,
  } = options;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      // 检查是否应该重试
      if (!shouldRetry(error) || i === maxRetries - 1) {
        throw error;
      }

      const delay = backoff
        ? Math.min(delayMs * Math.pow(2, i), 30000)
        : delayMs;

      console.log(
        `   ⚠️ 可重试错误 (${i + 1}/${maxRetries}): ${error.message}`
      );
      console.log(`   等待 ${delay / 1000} 秒后重试...`);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Should not reach here");
}

/**
 * 检查是否为可重试的网络错误
 */
export function isNetworkError(error: any): boolean {
  const message = error.message?.toLowerCase() || "";

  const retryablePatterns = [
    "network",
    "timeout",
    "connection",
    "econnrefused",
    "enotfound",
    "503",
    "502",
    "429",
    "nonce too low",
    "replacement transaction underpriced",
  ];

  for (const pattern of retryablePatterns) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  return false;
}
