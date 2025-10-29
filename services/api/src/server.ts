import express, { Request, Response } from "express";
import { OrderV2 } from "../../matcher/src/types";

/**
 * API Server for Order Submission
 * Receives signed orders from users and forwards to Matcher
 */

interface SubmitOrderRequest {
  order: OrderV2;
  signature: string;
  side: "buy" | "sell";
}

interface SubmitOrderResponse {
  success: boolean;
  orderId?: string;
  error?: string;
}

interface OrderStatusResponse {
  orderId: string;
  status: "active" | "filled" | "cancelled" | "not_found";
  filledAmount?: string;
  remainingAmount?: string;
}

export class APIServer {
  private app: express.Application;
  private matchingEngine: any; // Will be injected from runner
  private port: number;
  private server: any;

  constructor(port: number = 3000) {
    this.app = express();
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Set matching engine instance
   */
  setMatchingEngine(engine: any) {
    this.matchingEngine = engine;
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware() {
    // Parse JSON bodies
    this.app.use(express.json());

    // CORS - allow all origins for testing
    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes() {
    // Health check
    this.app.get("/health", (req: Request, res: Response) => {
      res.json({ status: "ok", service: "PredictX API" });
    });

    // Submit order
    this.app.post("/api/v1/orders", async (req: Request, res: Response) => {
      try {
        const { order, signature, side }: SubmitOrderRequest = req.body;

        // Validation
        if (!order || !signature || !side) {
          return res.status(400).json({
            success: false,
            error: "Missing required fields: order, signature, side",
          });
        }

        if (side !== "buy" && side !== "sell") {
          return res.status(400).json({
            success: false,
            error: "Invalid side. Must be 'buy' or 'sell'",
          });
        }

        if (!this.matchingEngine) {
          return res.status(503).json({
            success: false,
            error: "Matching engine not available",
          });
        }

        // Convert side to uppercase (BUY or SELL)
        const orderSide = side === "buy" ? "BUY" : "SELL";

        // Submit to matching engine
        const result = await this.matchingEngine.addOrder(
          order,
          signature,
          orderSide
        );

        if (result.success) {
          console.log(
            `[API] Order submitted successfully: ${result.orderId}`
          );
          return res.status(201).json(result);
        } else {
          console.log(`[API] Order rejected: ${result.error}`);
          return res.status(400).json(result);
        }
      } catch (error: any) {
        console.error("[API] Error submitting order:", error);
        return res.status(500).json({
          success: false,
          error: error.message || "Internal server error",
        });
      }
    });

    // Get order status
    this.app.get("/api/v1/orders/:orderId", (req: Request, res: Response) => {
      try {
        const { orderId } = req.params;

        if (!this.matchingEngine) {
          return res.status(503).json({
            error: "Matching engine not available",
          });
        }

        // Get order status from matching engine
        const status = this.matchingEngine.getOrderStatus(orderId);

        if (!status) {
          return res.status(404).json({
            orderId,
            status: "not_found",
          });
        }

        return res.json(status);
      } catch (error: any) {
        console.error("[API] Error getting order status:", error);
        return res.status(500).json({
          error: error.message || "Internal server error",
        });
      }
    });

    // Get orderbook for market
    this.app.get(
      "/api/v1/orderbook/:marketId/:outcome",
      (req: Request, res: Response) => {
        try {
          const { marketId, outcome } = req.params;

          if (!this.matchingEngine) {
            return res.status(503).json({
              error: "Matching engine not available",
            });
          }

          const orderbook = this.matchingEngine.getOrderBookForAPI(
            marketId,
            parseInt(outcome)
          );

          return res.json(orderbook);
        } catch (error: any) {
          console.error("[API] Error getting orderbook:", error);
          return res.status(500).json({
            error: error.message || "Internal server error",
          });
        }
      }
    );

    // Get matcher statistics
    this.app.get("/api/v1/stats", (req: Request, res: Response) => {
      try {
        if (!this.matchingEngine) {
          return res.status(503).json({
            error: "Matching engine not available",
          });
        }

        const stats = this.matchingEngine.getStats();
        return res.json(stats);
      } catch (error: any) {
        console.error("[API] Error getting stats:", error);
        return res.status(500).json({
          error: error.message || "Internal server error",
        });
      }
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: "Not found" });
    });
  }

  /**
   * Start API server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`✅ API server listening on port ${this.port}`);
        console.log(`   Health check: http://localhost:${this.port}/health`);
        console.log(
          `   Submit orders: POST http://localhost:${this.port}/api/v1/orders`
        );
        resolve();
      });
    });
  }

  /**
   * Stop API server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
