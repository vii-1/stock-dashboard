// Mirrors src/app/stocks/india/page.tsx with yahooUsProvider (Yahoo's
// day_gainers / day_losers screener). The screener is empty outside US
// trading days, so "No data available" on a weekend is expected.
import MoversTabs from "@/components/MoversTabs";
import { yahooUsProvider } from "@/lib/providers/yahooProvider";
import { loadSparks } from "@/lib/market/sparks";

export default async function UsStocksPage() {
  let gainers: Awaited<ReturnType<typeof yahooUsProvider.getMovers>> = [];
  let losers: Awaited<ReturnType<typeof yahooUsProvider.getMovers>> = [];
  let error: string | null = null;

  try {
    [gainers, losers] = await Promise.all([
      yahooUsProvider.getMovers("gainers", 10),
      yahooUsProvider.getMovers("losers", 10),
    ]);
  } catch (err) {
    error = "Couldn't reach Yahoo Finance right now. Try refreshing in a bit.";
    console.error(err);
  }
  const sparks = await loadSparks(yahooUsProvider, [...gainers, ...losers]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">US Stocks</h1>
        <p className="page-subtitle">
          US movers from Yahoo's day_gainers / day_losers screener. "Add to portfolio" is a
          TODO exercise - see README.
        </p>
      </div>

      {error && <p className="text-loss">{error}</p>}

      <MoversTabs
        tabs={[
          { key: "gainers", label: "Top gainers", quotes: gainers },
          { key: "losers", label: "Top losers", quotes: losers },
        ]}
        sparks={sparks}
        footnote="Trend: last 30 days"
      />
    </div>
  );
}
