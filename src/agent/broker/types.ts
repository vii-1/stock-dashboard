// Shared contract every broker implements (paper, Binance testnet later,
// eventually live) - see TRADING_AGENT_DESIGN.md §2. The orchestration
// loop (runAgent.ts) only ever talks to this interface, so swapping the
// paper broker for a real one later is a one-file change, same pattern
// as MarketDataProvider for the dashboard's data sources.

export type PositionSide = "LONG" | "SHORT";

export interface BrokerPosition {
  symbol: string;
  assetClass: string;
  quantity: number; // always positive; direction is `side`
  // LONG: cost/share incl. fee. SHORT: proceeds/share net of fee.
  avgBuyPrice: number;
  side: PositionSide;
}

/** Mark-to-market value a position contributes to equity. */
export function positionValue(p: Pick<BrokerPosition, "quantity" | "avgBuyPrice" | "side">, price: number): number {
  // A short holds its entry proceeds as margin and gains as price falls:
  // margin (avg x qty) + unrealised (avg - price) x qty.
  return p.side === "SHORT" ? p.quantity * (2 * p.avgBuyPrice - price) : p.quantity * price;
}

export interface PlaceOrderParams {
  symbol: string;
  assetClass: string;
  // SHORT opens/adds to a short (sell first), COVER buys it back.
  // Intraday only - nothing in the daily agent ever sends them.
  side: "BUY" | "SELL" | "SHORT" | "COVER";
  quantity: number;
  price: number;
}

export interface OrderResult {
  status: "FILLED" | "REJECTED";
  price?: number;
  rejectReason?: string;
  // Only set on a SELL/COVER fill that closes/reduces a position - the P&L
  // realized by that specific sell, in the position's native currency,
  // already net of the fee below.
  realizedPnl?: number;
  // Transaction cost charged on this fill (see TRANSACTION_COST_PCT in
  // paperBroker.ts) - broken out so callers can report it, even though
  // it's already folded into the cash movement and realizedPnl.
  fee?: number;
}

export interface Broker {
  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;
  getPositions(): Promise<BrokerPosition[]>;
  getCashBalance(): Promise<number>;
}
