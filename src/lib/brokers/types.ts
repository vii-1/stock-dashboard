// Shared shape every broker's holdings are normalised into, so pages,
// totals and the dashboard never care which broker a stock came from.
// Adding a broker = one adapter in this folder that produces these.

export type BrokerId = "kite" | "angel";

export const BROKER_LABELS: Record<BrokerId, string> = {
  kite: "Zerodha (Kite)",
  angel: "Angel One",
};

export interface BrokerHolding {
  broker: BrokerId;
  tradingsymbol: string; // plain exchange symbol, e.g. "SBIN" (no -EQ suffix)
  exchange: "NSE" | "BSE";
  isin: string;
  quantity: number; // settled
  t1Quantity: number; // bought, not yet settled
  averagePrice: number;
  lastPrice: number;
  closePrice: number; // previous close, for day change
  pnl: number; // (last - avg) * total quantity, in ₹
  dayChangePct: number;
}

// Yahoo symbol for the same stock (for fundamentals / scoring).
export function yahooSymbol(h: Pick<BrokerHolding, "tradingsymbol" | "exchange">): string {
  return `${h.tradingsymbol}.${h.exchange === "BSE" ? "BO" : "NS"}`;
}

export function totalQuantity(h: Pick<BrokerHolding, "quantity" | "t1Quantity">): number {
  return h.quantity + h.t1Quantity;
}

export type BrokerStatus =
  | { state: "unconfigured" } // no API key in .env
  | { state: "disconnected" } // no valid session today
  | { state: "error"; message: string }
  | { state: "connected"; userId: string; userName: string | null; holdings: BrokerHolding[] };

/** Thrown when a broker rejects the stored session (expired/revoked). */
export class BrokerSessionError extends Error {}
