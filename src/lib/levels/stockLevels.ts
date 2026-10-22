import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { formatMoney } from "@/lib/format";
import { isIndianSymbol } from "@/lib/fundamentals/paths";
import { getNseDeals } from "./nseDeals";
import {
  bigBuyers,
  buyZone,
  sma,
  supportResistance,
  volumeProfile,
  type BigBuyerSummary,
  type BuyZone,
  type Level,
  type VolumeProfile,
} from "./priceLevels";

// Server-side assembly for the "Price levels" card - see priceLevels.ts
// for the maths and its caveats.

const HISTORY_DAYS = 730; // 2 years of daily bars for swings + zone tests
const PROFILE_DAYS = 365; // volume profile over the last year only

export interface StockLevels {
  symbol: string;
  currency: "INR" | "USD";
  price: number;
  asOf: string; // last bar date
  supports: Level[];
  resistances: Level[];
  profile: VolumeProfile | null;
  // null = not applicable (US / BSE-only symbol); summary with 0 buyers = NSE had no qualifying deals
  bigBuyers: BigBuyerSummary | null;
  sma200: number | null;
  week52: { low: number; high: number } | null;
  buyZone: BuyZone | null;
  warnings: string[];
}

export async function getStockLevels(symbol: string): Promise<StockLevels> {
  const upper = symbol.toUpperCase();
  const india = isIndianSymbol(upper);
  const currency = india ? "INR" : "USD";
  const provider = india ? yahooIndiaProvider : yahooUsProvider;
  const warnings: string[] = [];

  const nseTicker = upper.endsWith(".NS") ? upper.slice(0, -3) : null;
  const [history, deals] = await Promise.all([
    provider.getHistory(upper, HISTORY_DAYS),
    nseTicker
      ? getNseDeals(nseTicker).catch((err) => {
          console.error(`NSE deals failed for ${nseTicker}`, err);
          warnings.push("NSE bulk/block deal data couldn't be loaded right now (NSE rate-limits automated requests) - big-buyer levels are missing.");
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (history.length < 60) throw new Error(`Not enough price history for ${upper}`);

  const price = history[history.length - 1].close;
  const lastYear = history.slice(-Math.round((PROFILE_DAYS / 365) * 250));
  const { supports, resistances } = supportResistance(history, price);
  const profile = volumeProfile(lastYear);
  if (!profile) warnings.push("No volume data from the price source, so the volume profile is unavailable.");
  const buyers = deals ? bigBuyers(deals) : null;
  if (!india) warnings.push("Big-buyer prices come from NSE bulk/block deal disclosures, which only exist for NSE-listed stocks.");
  else if (!nseTicker) warnings.push("Big-buyer prices use NSE deal data; this is a BSE symbol.");

  const week52 = lastYear.length
    ? { low: Math.min(...lastYear.map((p) => p.low ?? p.close)), high: Math.max(...lastYear.map((p) => p.high ?? p.close)) }
    : null;

  return {
    symbol: upper,
    currency,
    price,
    asOf: history[history.length - 1].date,
    supports,
    resistances,
    profile,
    bigBuyers: buyers,
    sma200: sma(history, 200),
    week52,
    buyZone: buyZone({
      history,
      currentPrice: price,
      supports,
      profile,
      bigBuyerAvg: buyers?.avgPrice ?? null,
      formatPrice: (n) => formatMoney(n, currency),
    }),
    warnings,
  };
}
