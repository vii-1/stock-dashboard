// Client-safe helpers (no server imports) for recognising symbols and
// building links to the fundamentals pages.

// NSE/BSE: RELIANCE.NS / M&M.NS / 500228.BO.  US: AAPL / BRK-B / BF.B.
export const STOCK_SYMBOL = /^(?:[A-Z0-9&\-]{1,20}\.(?:NS|BO)|[A-Z][A-Z0-9\-]{0,9}(?:\.[A-Z])?)$/;

// CoinGecko ids: "bitcoin", "venice-token", "usd-coin".
export const COIN_ID = /^[a-z0-9][a-z0-9\-]{0,79}$/;

export function isIndianSymbol(symbol: string): boolean {
  return /\.(NS|BO)$/i.test(symbol);
}

export type DetailMarket = "india" | "us" | "crypto";

export function marketForAssetClass(assetClass: string): DetailMarket | null {
  if (assetClass === "IN_STOCK") return "india";
  if (assetClass === "US_STOCK") return "us";
  if (assetClass === "CRYPTO") return "crypto";
  return null;
}

/** Full-page URL for a stock or coin. */
export function detailPath(market: DetailMarket, symbol: string): string {
  const id = encodeURIComponent(symbol);
  if (market === "crypto") return `/crypto/${id}`;
  return `/stocks/${market}/${id}`;
}
