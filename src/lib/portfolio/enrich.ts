import type { Holding } from "@prisma/client";
import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";
import type { MarketDataProvider, Quote } from "@/lib/providers/types";
import { getUsdInrRate } from "@/lib/fx";
import { nativeCurrency } from "@/lib/fxConvert";

export function providerForAssetClass(assetClass: string): MarketDataProvider {
  switch (assetClass) {
    case "IN_STOCK":
      return yahooIndiaProvider;
    case "US_STOCK":
      return yahooUsProvider;
    case "CRYPTO":
      return coingeckoProvider;
    default:
      throw new Error(`Unknown assetClass: ${assetClass}`);
  }
}

// Rupee view of a holding. Cost basis converts at the USD/INR rate on the
// buy date (what you actually paid in ₹), market value at today's rate -
// so P&L in ₹ includes currency moves since purchase, exactly as it would
// on a rupee bank statement. INR holdings pass straight through (rates 1).
export interface InrView {
  avgBuyPrice: number;
  invested: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  buyRate: number; // ₹ per unit of native currency on the buy date
}

export interface EnrichedHolding extends Holding {
  quote: Quote | null;
  // Native currency (INR for IN_STOCK, USD for US_STOCK/CRYPTO) - what
  // the price provider quotes and what scoreHolding's indicators use.
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  quoteError: string | null;
  // Everything converted to rupees - use this for totals, weights and
  // anything summed across holdings. null only if the FX rate failed.
  inr: InrView | null;
}

async function inrView(holding: Holding, quote: Quote | null, liveUsdInr: number | null): Promise<InrView | null> {
  const isInr = nativeCurrency(holding.assetClass) === "INR";
  let buyRate = 1;
  let liveRate: number | null = 1;
  if (!isInr) {
    try {
      buyRate = (await getUsdInrRate(holding.buyDate)).rate;
    } catch (err) {
      console.error(`USD/INR rate for ${holding.symbol}'s buy date unavailable`, err);
      return null;
    }
    liveRate = liveUsdInr;
  }

  const avgBuyPrice = holding.avgBuyPrice * buyRate;
  const invested = avgBuyPrice * holding.quantity;
  const currentPrice = quote && liveRate != null ? quote.price * liveRate : null;
  const marketValue = currentPrice != null ? currentPrice * holding.quantity : null;
  const unrealizedPnl = marketValue != null ? marketValue - invested : null;
  return {
    avgBuyPrice,
    invested,
    currentPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct: unrealizedPnl != null && invested > 0 ? (unrealizedPnl / invested) * 100 : null,
    buyRate,
  };
}

// Fetches a live quote per holding and computes unrealized P&L, both in
// the holding's native currency and in rupees (see InrView). Errors are
// caught per-holding (one rate-limited provider shouldn't blank the whole
// page) - the row just shows "--" for anything quote-dependent.
export async function enrichHoldings(holdings: Holding[]): Promise<EnrichedHolding[]> {
  const needsFx = holdings.some((h) => nativeCurrency(h.assetClass) !== "INR");
  const liveUsdInr = needsFx
    ? await getUsdInrRate()
        .then((r) => r.rate)
        .catch((err) => {
          console.error("Live USD/INR rate unavailable", err);
          return null;
        })
    : null;

  return Promise.all(
    holdings.map(async (holding): Promise<EnrichedHolding> => {
      try {
        const provider = providerForAssetClass(holding.assetClass);
        const quote = await provider.getQuote(holding.symbol);
        const marketValue = quote.price * holding.quantity;
        const unrealizedPnl = (quote.price - holding.avgBuyPrice) * holding.quantity;
        const unrealizedPnlPct =
          holding.avgBuyPrice > 0
            ? ((quote.price - holding.avgBuyPrice) / holding.avgBuyPrice) * 100
            : 0;

        return {
          ...holding,
          quote,
          marketValue,
          unrealizedPnl,
          unrealizedPnlPct,
          quoteError: null,
          inr: await inrView(holding, quote, liveUsdInr),
        };
      } catch (err) {
        console.error(`Failed to fetch quote for ${holding.symbol}`, err);
        return {
          ...holding,
          quote: null,
          marketValue: null,
          unrealizedPnl: null,
          unrealizedPnlPct: null,
          quoteError: "Couldn't fetch a live price.",
          inr: await inrView(holding, null, liveUsdInr),
        };
      }
    })
  );
}
