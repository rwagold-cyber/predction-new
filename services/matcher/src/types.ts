export type Side = "BUY" | "SELL";

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

export interface SignedOrder {
  order: OrderV2;
  signature: string;
  side: Side;
  id: string;
  timestamp: number;
  remainingAmount: string;
}

export interface Fill {
  order: OrderV2;
  signature: string;
  fillAmount: string;
  taker: string;
}

export interface Match {
  buyOrder: SignedOrder;
  sellOrder: SignedOrder;
  matchAmount: string;
  matchPrice: string;
}

export interface OrderBookLevel {
  price: string;
  totalAmount: string;
  orders: SignedOrder[];
}
