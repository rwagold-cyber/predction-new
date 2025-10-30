import { OrderBook } from "./orderbook";
import { SignedOrder, OrderV2, Match, Fill, Side } from "./types";
import { verifyOrderSignature, hashOrder } from "./signature";
import * as fs from "fs";
import * as path from "path";

/**
 * MatchingEngine - Core matching engine with order validation
 */
export class MatchingEngine {
  // Market ID + Outcome => OrderBook
  private orderBooks: Map<string, OrderBook> = new Map();

  // Track filled amounts
  private filledAmounts: Map<string, bigint> = new Map();

  // Configuration
  private chainId: number;
  private verifyingContract: string;

  constructor(chainId: number, verifyingContract: string) {
    this.chainId = chainId;
    this.verifyingContract = verifyingContract;
  }

  /**
   * Get or create order book for market + outcome
   */
  private getOrderBook(marketId: string, outcome: number): OrderBook {
    const key = `${marketId}-${outcome}`;
    if (!this.orderBooks.has(key)) {
      this.orderBooks.set(key, new OrderBook());
    }
    return this.orderBooks.get(key)!;
  }

  /**
   * Add and validate order
   */
  async addOrder(
    order: OrderV2,
    signature: string,
    side: Side
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // Basic validation
      if (BigInt(order.amount) <= 0) {
        return { success: false, error: "Invalid amount" };
      }

      if (order.expiry < Date.now() / 1000) {
        return { success: false, error: "Order expired" };
      }

      if (order.outcome > 1) {
        return { success: false, error: "Invalid outcome" };
      }

      // Verify signature
      const verification = await verifyOrderSignature(order, signature);
      if (!verification.valid) {
        return { success: false, error: "Invalid signature" };
      }

      // Create signed order
      const orderHash = hashOrder(order);
      const currentFilled = this.filledAmounts.get(orderHash) || 0n;
      const remainingAmount = BigInt(order.amount) - currentFilled;

      if (remainingAmount <= 0n) {
        return { success: false, error: "Order already filled" };
      }

      const signedOrder: SignedOrder = {
        order,
        signature,
        side,
        id: orderHash,
        timestamp: Date.now(),
        remainingAmount: remainingAmount.toString(),
      };

      // Add to order book
      const orderBook = this.getOrderBook(order.marketId, order.outcome);
      orderBook.addOrder(signedOrder);

      console.log(
        `Order added: ${side} ${order.amount} @ ${order.pricePips} (Market: ${order.marketId}, Outcome: ${order.outcome})`
      );

      return { success: true, orderId: orderHash };
    } catch (error: any) {
      console.error("Error adding order:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel order
   */
  cancelOrder(orderId: string, marketId: string, outcome: number): boolean {
    const orderBook = this.getOrderBook(marketId, outcome);
    return orderBook.removeOrder(orderId);
  }

  /**
   * Run matching for a specific market + outcome
   */
  matchMarket(marketId: string, outcome: number): Match[] {
    const orderBook = this.getOrderBook(marketId, outcome);
    const matches = orderBook.matchOrders();

    // Update filled amounts
    for (const match of matches) {
      const buyHash = match.buyOrder.id;
      const sellHash = match.sellOrder.id;
      const matchAmount = BigInt(match.matchAmount);

      const buyFilled = this.filledAmounts.get(buyHash) || 0n;
      const sellFilled = this.filledAmounts.get(sellHash) || 0n;

      this.filledAmounts.set(buyHash, buyFilled + matchAmount);
      this.filledAmounts.set(sellHash, sellFilled + matchAmount);
    }

    if (matches.length > 0) {
      console.log(
        `Matched ${matches.length} orders for market ${marketId}, outcome ${outcome}`
      );
    }

    return matches;
  }

  /**
   * Run matching for all markets
   */
  matchAll(): Map<string, Match[]> {
    const allMatches = new Map<string, Match[]>();

    for (const key of this.orderBooks.keys()) {
      const [marketId, outcomeStr] = key.split("-");
      const outcome = parseInt(outcomeStr);

      const matches = this.matchMarket(marketId, outcome);
      if (matches.length > 0) {
        allMatches.set(key, matches);
      }
    }

    return allMatches;
  }

  /**
   * Convert matches to fills for settlement
   */
  matchesToFills(matches: Match[]): Fill[] {
    const fills: Fill[] = [];

    for (const match of matches) {
      // 单向填充：sellOrder 作为 maker，buyOrder.maker 作为 taker
      // taker 支付 price * amount，获得 outcome 代币
      // maker 锁定 amount 抵押品，mint 代币后将 outcome 给 taker，保留相反 outcome
      fills.push({
        order: match.sellOrder.order,
        signature: match.sellOrder.signature,
        fillAmount: match.matchAmount,
        taker: match.buyOrder.order.maker,
      });
    }

    return fills;
  }

  /**
   * Get order status by order ID
   */
  getOrderStatus(orderId: string): {
    orderId: string;
    status: "active" | "filled" | "cancelled" | "not_found";
    filledAmount?: string;
    remainingAmount?: string;
  } | null {
    const filledAmount = this.filledAmounts.get(orderId);

    // Search all order books for this order
    for (const book of this.orderBooks.values()) {
      const order = book.findOrder(orderId);
      if (order) {
        const filled = filledAmount || 0n;
        const total = BigInt(order.order.amount);
        const remaining = total - filled;

        if (remaining <= 0n) {
          return {
            orderId,
            status: "filled",
            filledAmount: filled.toString(),
            remainingAmount: "0",
          };
        } else {
          return {
            orderId,
            status: "active",
            filledAmount: filled.toString(),
            remainingAmount: remaining.toString(),
          };
        }
      }
    }

    // Check if it was filled
    if (filledAmount) {
      return {
        orderId,
        status: "filled",
        filledAmount: filledAmount.toString(),
        remainingAmount: "0",
      };
    }

    return null;
  }

  /**
   * Get order book snapshot (public API-friendly version)
   */
  getOrderBookSnapshot(marketId: string, outcome: number) {
    const orderBook = this.getOrderBook(marketId, outcome);
    return orderBook.getSnapshot();
  }

  /**
   * Get order book for API (with formatted data)
   */
  getOrderBookForAPI(marketId: string, outcome: number) {
    const snapshot = this.getOrderBookSnapshot(marketId, outcome);

    return {
      marketId,
      outcome,
      bids: snapshot.bids.map((level) => ({
        price: level.price,
        amount: level.totalAmount,
        orderCount: level.orders.length,
      })),
      asks: snapshot.asks.map((level) => ({
        price: level.price,
        amount: level.totalAmount,
        orderCount: level.orders.length,
      })),
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalOrders = 0;
    const bookStats = [];

    for (const [key, book] of this.orderBooks.entries()) {
      const count = book.getOrderCount();
      totalOrders += count;
      if (count > 0) {
        bookStats.push({ market: key, orders: count });
      }
    }

    return {
      totalOrders,
      totalBooks: this.orderBooks.size,
      activeBooks: bookStats.length,
      books: bookStats,
    };
  }
}

/**
 * Main matcher service
 */
async function main() {
  console.log("Starting Matching Engine...");

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
    console.log("Settlement address:", settlementAddress);
    console.log("Chain ID:", chainId);
  } else {
    console.warn("addresses.json not found, using defaults");
    settlementAddress = "0x0000000000000000000000000000000000000000";
  }

  const engine = new MatchingEngine(chainId, settlementAddress);

  // Initialize Relayer (if available via global)
  // Note: Relayer should be running as separate service
  const relayer = (global as any).relayer;

  // Run matching loop
  setInterval(async () => {
    const matches = engine.matchAll();

    if (matches.size > 0) {
      console.log("\n=== Matching Results ===");
      for (const [market, matchList] of matches.entries()) {
        console.log(
          `Market ${market}: ${matchList.length} matches`
        );

        // Convert to fills
        const fills = engine.matchesToFills(matchList);
        console.log(`Generated ${fills.length} fills for settlement`);

        // Send fills to Relayer (if available)
        if (relayer) {
          try {
            await relayer.submitFills(fills);
            console.log(`✅ Fills submitted to Relayer`);
          } catch (error: any) {
            console.error(`❌ Failed to submit fills:`, error.message);
          }
        } else {
          console.warn("⚠️  Relayer not available - fills not submitted");
        }
      }
      console.log("========================\n");
    }

    // Log stats every iteration
    const stats = engine.getStats();
    if (stats.totalOrders > 0) {
      console.log(`Active orders: ${stats.totalOrders}`);
    }
  }, 1000); // Match every second

  console.log("Matching engine running...");

  // Export engine for external use (e.g., API integration)
  (global as any).matchingEngine = engine;
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
