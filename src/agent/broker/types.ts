// Shared contract every broker implements (paper, Binance testnet later,
// eventually live) - see TRADING_AGENT_DESIGN.md §2. The orchestration
// loop (runAgent.ts) only ever talks to this interface, so swapping the
// paper broker for a real one later is a one-file change, same pattern
// as MarketDataProvider for the dashboard's data sources.

export interface BrokerPosition {
  symbol: string;
  assetClass: string;
  quantity: number;
  avgBuyPrice: number;
}

export interface PlaceOrderParams {
  symbol: string;
  assetClass: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
}

export interface OrderResult {
  status: "FILLED" | "REJECTED";
  price?: number;
  rejectReason?: string;
  // Only set on a SELL fill that closes/reduces a position - the P&L
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
