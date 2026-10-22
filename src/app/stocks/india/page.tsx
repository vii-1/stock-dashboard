import MoversTabs from "@/components/MoversTabs";
import { yahooIndiaProvider } from "@/lib/providers/yahooProvider";
import { loadSparks } from "@/lib/market/sparks";

// Server Component: fetches directly through the provider at request time
// (no client-side fetch needed for the initial render). The equivalent
// API route (/api/stocks/india/movers) still exists for client-side
// refresh buttons, search-and-add flows, etc.
export default async function IndiaStocksPage() {
  let gainers: Awaited<ReturnType<typeof yahooIndiaProvider.getMovers>> = [];
  let losers: Awaited<ReturnType<typeof yahooIndiaProvider.getMovers>> = [];
  let error: string | null = null;

  try {
    [gainers, losers] = await Promise.all([
      yahooIndiaProvider.getMovers("gainers", 10),
      yahooIndiaProvider.getMovers("losers", 10),
    ]);
  } catch (err) {
    error = "Couldn't reach Yahoo Finance right now. Try refreshing in a bit.";
    console.error(err);
  }
  const sparks = await loadSparks(yahooIndiaProvider, [...gainers, ...losers]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">India Stocks</h1>
        <p className="page-subtitle">
          NSE movers from a curated large-cap watchlist (see NIFTY_WATCHLIST in
          yahooProvider.ts). "Add to portfolio" is a TODO exercise - see README.
        </p>
      </div>

      {error && <p className="text-loss">{error}</p>}

      <MoversTabs
        tabs={[
          { key: "gainers", label: "Top gainers", quotes: gainers },
          { key: "losers", label: "Top losers", quotes: losers },
        ]}
        sparks={sparks}
        details="expand"
        market="india"
        footnote="Click a stock for fundamentals · Trend: last 30 days"
      />
    </div>
  );
}
