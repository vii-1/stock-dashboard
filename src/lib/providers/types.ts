// Shared contract every market data provider implements. Pages and API
// routes should only ever import this type + a concrete provider — never
// call an underlying SDK (yahoo-finance2, CoinGecko fetch, etc) directly.
// That's what makes "swap Yahoo for a paid API later" a one-file change.

export interface Quote {
  symbol: string;
  displayName: string;
  price: number;
  changePercent: number;
  currency: string;
  asOf: string; // ISO timestamp
}

export interface HistoryPoint {
  date: string; // ISO date
  close: number;
  // Optional: only Yahoo's chart endpoint supplies these (CoinGecko's
  // market_chart endpoint only returns a price line, not OHLC - see the
  // comment in coingeckoProvider.ts). Indicators that need a true range
  // (ADX) return null when these are missing rather than guessing.
  high?: number;
  low?: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
}

export interface MarketDataProvider {
  /** Single quote lookup, e.g. getQuote("RELIANCE.NS") */
  getQuote(symbol: string): Promise<Quote>;

  /** Batch quote lookup - implement this with a single upstream call where
   * the provider supports it (cheaper than N getQuote calls). */
  getQuotes(symbols: string[]): Promise<Quote[]>;

  /** Top gainers or losers for this market. */
  getMovers(direction: "gainers" | "losers", limit?: number): Promise<Quote[]>;

  /** Daily closes for the last `days` days, oldest first. Used by the
   * suggestion engine (SMA/RSI) - see src/lib/suggestions. */
  getHistory(symbol: string, days: number): Promise<HistoryPoint[]>;

  /** Symbol search/autocomplete for the "add to portfolio" form. */
  search(query: string): Promise<SearchResult[]>;
}
