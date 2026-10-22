import { withCache } from "@/lib/cache/ttlCache";
import type { HistoryPoint, MarketDataProvider, Quote, SearchResult } from "./types";

type Market = "IN" | "US";

// A curated watchlist of large, liquid NSE stocks (Nifty 50 names, ".NS"
// suffix = NSE on Yahoo). Yahoo's predefined screeners (day_gainers,
// day_losers) are built for the US market and don't reliably scope to
// NSE via the `region` option, so for India we instead pull quotes for
// this list in one batch call and sort by change% ourselves. Swap this
// for a live NSE index-constituents source later if you want full
// market coverage instead of a fixed watchlist - see README exercises.
export const NIFTY_WATCHLIST = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
  "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "BAJFINANCE.NS",
  "KOTAKBANK.NS", "LT.NS", "HCLTECH.NS", "ASIANPAINT.NS", "AXISBANK.NS",
  "MARUTI.NS", "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS", "WIPRO.NS",
  "NESTLEIND.NS", "ONGC.NS", "NTPC.NS", "POWERGRID.NS", "TMPV.NS",
  "TATASTEEL.NS", "ADANIENT.NS", "ADANIPORTS.NS", "COALINDIA.NS", "JSWSTEEL.NS",
];

// This used to go through the `yahoo-finance2` npm package, but its
// quote()/screener() methods hit Yahoo's crumb-authenticated endpoints
// (v7/finance/quote, the screener API when called through the library),
// and that specific auth path has been persistently returning
// "Too Many Requests" regardless of actual request volume - a known
// issue with v2 of that library (EOL, no fix coming). Yahoo's *public*
// endpoints (chart, screener hit directly, search) work fine without any
// crumb/cookie dance, so we call those directly instead. The chart
// endpoint's `meta` block conveniently doubles as a full quote.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function yahooFetch(url: string): Promise<any> {
  // no-store: Next 14 otherwise persists fetch() responses in
  // .next/cache for a year - a weekend's empty screener result was
  // being served on Monday. Freshness is ttlCache's job (withCache).
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchChartMeta(symbol: string): Promise<any> {
  const body = await yahooFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
  );
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No chart data for ${symbol}`);
  return meta;
}

function metaToQuote(meta: any): Quote {
  return {
    symbol: meta.symbol,
    displayName: meta.longName ?? meta.shortName ?? meta.symbol,
    price: meta.regularMarketPrice ?? 0,
    changePercent: meta.regularMarketChangePercent ?? 0,
    currency: meta.currency ?? (meta.symbol?.endsWith(".NS") || meta.symbol?.endsWith(".BO") ? "INR" : "USD"),
    asOf: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
  };
}

// The screener endpoint, called directly with formatted=true, wraps
// numeric fields as { raw, fmt } instead of plain numbers.
function unwrapFormatted(field: any): number {
  if (field == null) return 0;
  return typeof field === "object" ? (field.raw ?? 0) : field;
}

function screenerResultToQuote(raw: any): Quote {
  return {
    symbol: raw.symbol,
    displayName: raw.longName ?? raw.shortName ?? raw.symbol,
    price: unwrapFormatted(raw.regularMarketPrice),
    changePercent: unwrapFormatted(raw.regularMarketChangePercent),
    currency: raw.currency ?? "USD",
    asOf: new Date().toISOString(),
  };
}

function createYahooProvider(market: Market): MarketDataProvider {
  return {
    async getQuote(symbol: string): Promise<Quote> {
      return withCache(`yahoo:quote:${symbol}`, 60, async () => {
        const meta = await fetchChartMeta(symbol);
        return metaToQuote(meta);
      });
    },

    async getQuotes(symbols: string[]): Promise<Quote[]> {
      if (symbols.length === 0) return [];
      const cacheKey = `yahoo:quotes:${[...symbols].sort().join(",")}`;
      return withCache(cacheKey, 60, async () => {
        const settled = await Promise.all(
          symbols.map((symbol) =>
            fetchChartMeta(symbol)
              .then(metaToQuote)
              .catch(() => null)
          )
        );
        return settled.filter((quote): quote is Quote => quote !== null);
      });
    },

    async getMovers(direction: "gainers" | "losers", limit = 10): Promise<Quote[]> {
      const cacheKey = `yahoo:movers:${market}:${direction}:${limit}`;
      return withCache(cacheKey, 120, async () => {
        if (market === "US") {
          const scrId = direction === "gainers" ? "day_gainers" : "day_losers";
          const body = await yahooFetch(
            `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&lang=en-US&scrIds=${scrId}&count=${limit}`
          );
          const quotes = body?.finance?.result?.[0]?.quotes ?? [];
          return quotes.map(screenerResultToQuote);
        }

        // India: fetch the watchlist one symbol at a time via the chart
        // endpoint (no batch quote endpoint without the broken crumb
        // auth) and sort by change% ourselves (see NIFTY_WATCHLIST
        // comment above for why a fixed watchlist instead of a screener).
        const settled = await Promise.all(
          NIFTY_WATCHLIST.map((symbol) =>
            fetchChartMeta(symbol)
              .then(metaToQuote)
              .catch(() => null)
          )
        );
        const quotes = settled.filter((quote): quote is Quote => quote !== null);
        quotes.sort((a, b) =>
          direction === "gainers"
            ? b.changePercent - a.changePercent
            : a.changePercent - b.changePercent
        );
        return quotes.slice(0, limit);
      });
    },

    async getHistory(symbol: string, days: number): Promise<HistoryPoint[]> {
      return withCache(`yahoo:history:${symbol}:${days}`, 3600, async () => {
        const period2 = Math.floor(Date.now() / 1000);
        const period1 = period2 - days * 24 * 60 * 60;

        const body = await yahooFetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`
        );
        const result = body?.chart?.result?.[0];
        const timestamps: number[] = result?.timestamp ?? [];
        const quote = result?.indicators?.quote?.[0] ?? {};
        const closes: (number | null)[] = quote.close ?? [];
        const highs: (number | null)[] = quote.high ?? [];
        const lows: (number | null)[] = quote.low ?? [];
        const volumes: (number | null)[] = quote.volume ?? [];

        return timestamps
          .map((t, i): HistoryPoint | null => {
            const close = closes[i];
            if (close == null) return null;
            const point: HistoryPoint = { date: new Date(t * 1000).toISOString().slice(0, 10), close };
            if (highs[i] != null) point.high = highs[i]!;
            if (lows[i] != null) point.low = lows[i]!;
            if (volumes[i] != null) point.volume = volumes[i]!;
            return point;
          })
          .filter((point): point is HistoryPoint => point !== null);
      });
    },

    async search(query: string): Promise<SearchResult[]> {
      const body = await yahooFetch(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`
      );
      const quotes = body?.quotes ?? [];
      return quotes
        .filter((q: any) => q.symbol)
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.shortname ?? q.longname ?? q.symbol,
        }));
    },
  };
}

export const yahooIndiaProvider = createYahooProvider("IN");
export const yahooUsProvider = createYahooProvider("US");

// --- Intraday bars (used by the intraday paper agent, src/agent) ---
// Not part of MarketDataProvider: only Yahoo supplies intraday OHLCV
// here, and only the agent needs it. Yahoo serves 5m bars for the last
// 60 days max.

export interface IntradayBar {
  time: number; // bar START, epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTRADAY_INTERVAL_SECONDS = 300; // 5m

/**
 * Completed 5-minute bars only, oldest first. Yahoo's response ends with
 * a still-forming bar plus a live tick (odd timestamp, zero volume) -
 * both are dropped, so the live agent sees exactly what the backtest
 * sees: bars that have closed.
 */
export async function getIntradayBars(symbol: string, range: "5d" | "60d" = "5d"): Promise<IntradayBar[]> {
  return withCache(`yahoo:intraday:${symbol}:${range}`, 60, async () => {
    const body = await yahooFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=${range}`
    );
    const result = body?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const nowSec = Date.now() / 1000;

    const bars: IntradayBar[] = [];
    timestamps.forEach((time, i) => {
      const [open, high, low, close] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
      if (open == null || high == null || low == null || close == null) return;
      if (time % INTRADAY_INTERVAL_SECONDS !== 0) return; // live tick
      if (time + INTRADAY_INTERVAL_SECONDS > nowSec) return; // still forming
      bars.push({ time, open, high, low, close, volume: q.volume?.[i] ?? 0 });
    });
    return bars;
  });
}
