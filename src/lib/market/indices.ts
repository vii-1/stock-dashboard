import { yahooIndiaProvider } from "@/lib/providers/yahooProvider";
import type { Quote } from "@/lib/providers/types";

// Benchmarks for the header ticker tape and the dashboard's market strip.
// All go through Yahoo's public chart endpoint (same path as stock quotes),
// so they share its 60s quote cache / 1h history cache.
export const INDICES = [
  { symbol: "^NSEI", label: "NIFTY 50" },
  { symbol: "^BSESN", label: "SENSEX" },
  { symbol: "^NSEBANK", label: "NIFTY BANK" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "NASDAQ" },
  { symbol: "BTC-USD", label: "BITCOIN" },
  { symbol: "USDINR=X", label: "USD/INR" },
] as const;

export interface IndexSnapshot {
  symbol: string;
  label: string;
  quote: Quote;
  closes: number[];
}

export async function getIndexQuotes(): Promise<{ label: string; quote: Quote }[]> {
  const quotes = await yahooIndiaProvider.getQuotes(INDICES.map((i) => i.symbol));
  return INDICES.flatMap((index) => {
    const quote = quotes.find((q) => q.symbol === index.symbol);
    return quote ? [{ label: index.label, quote }] : [];
  });
}

// Quote + ~1 month of daily closes for sparklines. Per-index failures
// drop that card rather than the whole strip.
export async function getIndexSnapshots(days = 35): Promise<IndexSnapshot[]> {
  const settled = await Promise.all(
    INDICES.map(async (index): Promise<IndexSnapshot | null> => {
      try {
        const [quote, history] = await Promise.all([
          yahooIndiaProvider.getQuote(index.symbol),
          yahooIndiaProvider.getHistory(index.symbol, days),
        ]);
        return { symbol: index.symbol, label: index.label, quote, closes: history.map((p) => p.close) };
      } catch (err) {
        console.error(`Failed to load index ${index.symbol}`, err);
        return null;
      }
    })
  );
  return settled.filter((s): s is IndexSnapshot => s !== null);
}
