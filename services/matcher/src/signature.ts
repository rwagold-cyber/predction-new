import { ethers } from "ethers";
import { OrderV2 } from "./types";

/**
 * EIP-712 domain for Settlement contract
 */
export function getDomain(chainId: number, verifyingContract: string) {
  return {
    name: "PredictXSettlementV2",
    version: "1",
    chainId: chainId,
    verifyingContract: verifyingContract,
  };
}

/**
 * EIP-712 types for Order
 */
export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "conditionId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "collateral", type: "address" },
    { name: "pricePips", type: "uint128" },
    { name: "amount", type: "uint128" },
    { name: "makerFeeBps", type: "uint16" },
    { name: "takerFeeBps", type: "uint16" },
    { name: "expiry", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "mintOnFill", type: "bool" },
    { name: "allowedTaker", type: "address" },
  ],
};

/**
 * Verify EIP-712 signature for an order
 */
export async function verifyOrderSignature(
  order: OrderV2,
  signature: string
): Promise<{ valid: boolean; signer: string }> {
  try {
    const domain = getDomain(order.chainId, order.verifyingContract);

    const orderData = {
      maker: order.maker,
      marketId: order.marketId,
      conditionId: order.conditionId,
      outcome: order.outcome,
      collateral: order.collateral,
      pricePips: order.pricePips,
      amount: order.amount,
      makerFeeBps: order.makerFeeBps,
      takerFeeBps: order.takerFeeBps,
      expiry: order.expiry,
      salt: order.salt,
      nonce: order.nonce,
      mintOnFill: order.mintOnFill,
      allowedTaker: order.allowedTaker,
    };

    // Verify signature
    const recoveredAddress = ethers.verifyTypedData(
      domain,
      ORDER_TYPES,
      orderData,
      signature
    );

    const valid = recoveredAddress.toLowerCase() === order.maker.toLowerCase();

    return {
      valid,
      signer: recoveredAddress,
    };
  } catch (error) {
    console.error("Signature verification failed:", error);
    return {
      valid: false,
      signer: "",
    };
  }
}

/**
 * Hash order for tracking
 */
export function hashOrder(order: OrderV2): string {
  const domain = getDomain(order.chainId, order.verifyingContract);

  const orderData = {
    maker: order.maker,
    marketId: order.marketId,
    conditionId: order.conditionId,
    outcome: order.outcome,
    collateral: order.collateral,
    pricePips: order.pricePips,
    amount: order.amount,
    makerFeeBps: order.makerFeeBps,
    takerFeeBps: order.takerFeeBps,
    expiry: order.expiry,
    salt: order.salt,
    nonce: order.nonce,
    mintOnFill: order.mintOnFill,
    allowedTaker: order.allowedTaker,
  };

  return ethers.TypedDataEncoder.hash(domain, ORDER_TYPES, orderData);
}
