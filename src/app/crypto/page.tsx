import MoversTabs from "@/components/MoversTabs";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";

// Server Component: fetches directly through the provider at request time
// (no client-side fetch needed for the initial render). The equivalent
// API route (/api/crypto/movers) still exists for client-side refresh
// buttons, search-and-add flows, etc. No row sparklines here - 20 extra
// market_chart calls would blow through CoinGecko's keyless rate limit.
export default async function CryptoPage() {
  let gainers: Awaited<ReturnType<typeof coingeckoProvider.getMovers>> = [];
  let losers: Awaited<ReturnType<typeof coingeckoProvider.getMovers>> = [];
  let error: string | null = null;

  try {
    [gainers, losers] = await Promise.all([
      coingeckoProvider.getMovers("gainers", 10),
      coingeckoProvider.getMovers("losers", 10),
    ]);
  } catch (err) {
    error = "Couldn't reach CoinGecko right now. Try refreshing in a bit.";
    console.error(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Crypto</h1>
        <p className="page-subtitle">
          Top 100 coins by market cap, sorted by 24h change. "Add to portfolio" is a TODO
          exercise - see README.
        </p>
      </div>

      {error && <p className="text-loss">{error}</p>}

      <MoversTabs
        tabs={[
          { key: "gainers", label: "Top gainers", quotes: gainers },
          { key: "losers", label: "Top losers", quotes: losers },
        ]}
        details="expand"
        market="crypto"
        footnote="Click a coin for details · 24h change"
      />
    </div>
  );
}
