import { SignedOrder, Side, OrderBookLevel, Match } from "./types";

/**
 * OrderBook - Price-Time Priority Order Book
 *
 * Features:
 * - Price-time priority matching
 * - Efficient insertion and removal
 * - Partial fill support
 * - Best bid/ask tracking
 */
export class OrderBook {
  private bids: Map<string, SignedOrder[]> = new Map(); // price => orders
  private asks: Map<string, SignedOrder[]> = new Map();
  private orderIndex: Map<string, { price: string; side: Side }> = new Map();

  /**
   * Add order to book
   */
  addOrder(order: SignedOrder): void {
    const priceKey = order.order.pricePips;
    const book = order.side === "BUY" ? this.bids : this.asks;

    if (!book.has(priceKey)) {
      book.set(priceKey, []);
    }

    book.get(priceKey)!.push(order);
    this.orderIndex.set(order.id, { price: priceKey, side: order.side });
  }

  /**
   * Remove order from book
   */
  removeOrder(orderId: string): boolean {
    const index = this.orderIndex.get(orderId);
    if (!index) return false;

    const book = index.side === "BUY" ? this.bids : this.asks;
    const orders = book.get(index.price);

    if (!orders) return false;

    const idx = orders.findIndex((o) => o.id === orderId);
    if (idx === -1) return false;

    orders.splice(idx, 1);

    // Clean up empty price levels
    if (orders.length === 0) {
      book.delete(index.price);
    }

    this.orderIndex.delete(orderId);
    return true;
  }

  /**
   * Update order remaining amount (after partial fill)
   */
  updateOrderAmount(orderId: string, newRemainingAmount: string): boolean {
    const index = this.orderIndex.get(orderId);
    if (!index) return false;

    const book = index.side === "BUY" ? this.bids : this.asks;
    const orders = book.get(index.price);
    if (!orders) return false;

    const order = orders.find((o) => o.id === orderId);
    if (!order) return false;

    order.remainingAmount = newRemainingAmount;

    // Remove if fully filled
    if (BigInt(newRemainingAmount) === 0n) {
      this.removeOrder(orderId);
    }

    return true;
  }

  /**
   * Get best bid price
   */
  getBestBid(): string | null {
    if (this.bids.size === 0) return null;

    let bestPrice = "0";
    for (const price of this.bids.keys()) {
      if (BigInt(price) > BigInt(bestPrice)) {
        bestPrice = price;
      }
    }

    return bestPrice;
  }

  /**
   * Get best ask price
   */
  getBestAsk(): string | null {
    if (this.asks.size === 0) return null;

    let bestPrice = BigInt(2) ** BigInt(256) - BigInt(1); // max uint256
    let found = false;

    for (const price of this.asks.keys()) {
      const priceBN = BigInt(price);
      if (priceBN < bestPrice) {
        bestPrice = priceBN;
        found = true;
      }
    }

    return found ? bestPrice.toString() : null;
  }

  /**
   * Match orders - returns array of matches
   */
  matchOrders(): Match[] {
    const matches: Match[] = [];

    while (true) {
      const bestBid = this.getBestBid();
      const bestAsk = this.getBestAsk();

      if (!bestBid || !bestAsk) break;

      // Check if prices cross
      if (BigInt(bestBid) < BigInt(bestAsk)) break;

      const buyOrders = this.bids.get(bestBid)!;
      const sellOrders = this.asks.get(bestAsk)!;

      if (buyOrders.length === 0 || sellOrders.length === 0) break;

      // Take first order from each side (time priority)
      const buyOrder = buyOrders[0];
      const sellOrder = sellOrders[0];

      // Calculate match amount
      const buyAmount = BigInt(buyOrder.remainingAmount);
      const sellAmount = BigInt(sellOrder.remainingAmount);
      const matchAmount = buyAmount < sellAmount ? buyAmount : sellAmount;

      // Create match (use sell order price - price-time priority)
      matches.push({
        buyOrder,
        sellOrder,
        matchAmount: matchAmount.toString(),
        matchPrice: bestAsk, // Taker (buyer) gets filled at maker (seller) price
      });

      // Update remaining amounts
      const newBuyRemaining = (buyAmount - matchAmount).toString();
      const newSellRemaining = (sellAmount - matchAmount).toString();

      this.updateOrderAmount(buyOrder.id, newBuyRemaining);
      this.updateOrderAmount(sellOrder.id, newSellRemaining);

      // If price level is now empty, it will be cleaned up by updateOrderAmount
    }

    return matches;
  }

  /**
   * Get order book snapshot
   */
  getSnapshot(): {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  } {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];

    // Process bids (sort descending)
    const bidPrices = Array.from(this.bids.keys()).sort(
      (a, b) => Number(BigInt(b) - BigInt(a))
    );

    for (const price of bidPrices) {
      const orders = this.bids.get(price)!;
      let totalAmount = 0n;
      for (const order of orders) {
        totalAmount += BigInt(order.remainingAmount);
      }
      bids.push({
        price,
        totalAmount: totalAmount.toString(),
        orders: [...orders],
      });
    }

    // Process asks (sort ascending)
    const askPrices = Array.from(this.asks.keys()).sort(
      (a, b) => Number(BigInt(a) - BigInt(b))
    );

    for (const price of askPrices) {
      const orders = this.asks.get(price)!;
      let totalAmount = 0n;
      for (const order of orders) {
        totalAmount += BigInt(order.remainingAmount);
      }
      asks.push({
        price,
        totalAmount: totalAmount.toString(),
        orders: [...orders],
      });
    }

    return { bids, asks };
  }

  /**
   * Find order by ID
   */
  findOrder(orderId: string): SignedOrder | null {
    const index = this.orderIndex.get(orderId);
    if (!index) return null;

    const book = index.side === "BUY" ? this.bids : this.asks;
    const orders = book.get(index.price);
    if (!orders) return null;

    return orders.find((o) => o.id === orderId) || null;
  }

  /**
   * Get total number of orders
   */
  getOrderCount(): number {
    return this.orderIndex.size;
  }

  /**
   * Clear all orders
   */
  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.orderIndex.clear();
  }
}
