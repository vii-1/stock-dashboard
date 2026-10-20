import type { MarketDataProvider, Quote } from "@/lib/providers/types";

// Daily closes per symbol for row sparklines. Failures just leave that
// row without a sparkline. Goes through provider.getHistory, so repeat
// loads hit its cache rather than the network.
export async function loadSparks(
  provider: MarketDataProvider,
  quotes: Quote[],
  days = 30
): Promise<Record<string, number[]>> {
  const symbols = Array.from(new Set(quotes.map((q) => q.symbol)));
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const history = await provider.getHistory(symbol, days);
        return [symbol, history.map((p) => p.close)] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, number[]] => e !== null));
}
