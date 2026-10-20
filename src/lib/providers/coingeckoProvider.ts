import { withCache } from "@/lib/cache/ttlCache";
import type { HistoryPoint, MarketDataProvider, Quote, SearchResult } from "./types";

// CoinGecko's public API is keyless on the free tier (~10-30 req/min is
// safe without a key). If you add COINGECKO_API_KEY later, send it as
// the `x-cg-demo-api-key` header for higher limits - see their docs.
const BASE_URL = "https://api.coingecko.com/api/v3";

async function cgFetch(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: process.env.COINGECKO_API_KEY
      ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY }
      : undefined,
    cache: "no-store", // see yahooFetch - withCache handles freshness
  });
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

interface CgMarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  last_updated: string;
}

function toQuote(coin: CgMarketCoin): Quote {
  return {
    symbol: coin.id,
    displayName: `${coin.name} (${coin.symbol.toUpperCase()})`,
    price: coin.current_price,
    changePercent: coin.price_change_percentage_24h ?? 0,
    currency: "USD",
    asOf: coin.last_updated ?? new Date().toISOString(),
  };
}

export const coingeckoProvider: MarketDataProvider = {
  async getQuote(symbol: string): Promise<Quote> {
    return withCache(`cg:quote:${symbol}`, 60, async () => {
      const coins: CgMarketCoin[] = await cgFetch(
        `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(symbol)}`
      );
      if (coins.length === 0) throw new Error(`Unknown coin id: ${symbol}`);
      return toQuote(coins[0]);
    });
  },

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const cacheKey = `cg:quotes:${[...symbols].sort().join(",")}`;
    return withCache(cacheKey, 60, async () => {
      const coins: CgMarketCoin[] = await cgFetch(
        `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(symbols.join(","))}`
      );
      return coins.map(toQuote);
    });
  },

  async getMovers(direction: "gainers" | "losers", limit = 10): Promise<Quote[]> {
    const cacheKey = `cg:movers:${direction}:${limit}`;
    return withCache(cacheKey, 120, async () => {
      // Pull a broad top-market-cap slice, then sort by 24h change
      // ourselves - CoinGecko's free tier doesn't expose a dedicated
      // "top movers" endpoint the way FMP does for equities.
      const coins: CgMarketCoin[] = await cgFetch(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h`
      );
      const sorted = [...coins].sort((a, b) => {
        const changeA = a.price_change_percentage_24h ?? 0;
        const changeB = b.price_change_percentage_24h ?? 0;
        return direction === "gainers" ? changeB - changeA : changeA - changeB;
      });
      return sorted.slice(0, limit).map(toQuote);
    });
  },

  async getHistory(symbol: string, days: number): Promise<HistoryPoint[]> {
    return withCache(`cg:history:${symbol}:${days}`, 3600, async () => {
      const result: { prices: [number, number][] } = await cgFetch(
        `/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}`
      );
      // CoinGecko returns multiple points per day for short ranges; keep
      // one point per day (last one seen) to match the equity providers'
      // daily-close shape that the suggestion engine expects.
      //
      // No high/low here on purpose: market_chart only returns a price
      // line, not OHLC - that's a separate /coins/{id}/ohlc endpoint with
      // a different granularity per day-range tier (30min candles under
      // 2 days, 4h under 30 days, 4-day candles beyond that on the free
      // tier), which doesn't line up with the one-point-per-day shape
      // every other indicator here assumes. Switching to it risks
      // destabilizing SMA/RSI/MACD/Bollinger for crypto to gain ADX, so
      // for now ADX (src/lib/suggestions/scoreHolding.ts) just returns
      // null for crypto - a known gap, not a bug.
      const byDay = new Map<string, number>();
      for (const [timestampMs, price] of result.prices) {
        const date = new Date(timestampMs).toISOString().slice(0, 10);
        byDay.set(date, price);
      }
      return Array.from(byDay.entries()).map(([date, close]) => ({ date, close }));
    });
  },

  async search(query: string): Promise<SearchResult[]> {
    const result: { coins: { id: string; name: string; symbol: string }[] } = await cgFetch(
      `/search?query=${encodeURIComponent(query)}`
    );
    return result.coins.map((c) => ({
      symbol: c.id,
      name: `${c.name} (${c.symbol.toUpperCase()})`,
    }));
  },
};
