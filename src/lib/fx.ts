import { yahooIndiaProvider } from "@/lib/providers/yahooProvider";
import { nativeCurrency, toNativeUnitPrice, type Currency, type PriceMode } from "@/lib/fxConvert";

const FX_SYMBOL = "USDINR=X";

/**
 * Rupees per US dollar. With a past `date`, uses the last daily close on
 * or before that date (what you'd actually have paid around then); for
 * today/future or if history is unavailable, the live rate.
 */
export async function getUsdInrRate(date?: Date): Promise<{ rate: number; asOf: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const target = date && !isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : today;

  if (target < today) {
    const daysBack = Math.ceil((Date.now() - new Date(target).getTime()) / 86_400_000) + 7;
    try {
      const history = await yahooIndiaProvider.getHistory(FX_SYMBOL, daysBack);
      const onOrBefore = history.filter((p) => p.date <= target);
      const point = onOrBefore[onOrBefore.length - 1];
      if (point) return { rate: point.close, asOf: point.date };
    } catch (err) {
      console.error("USD/INR history lookup failed, falling back to live rate", err);
    }
  }

  const quote = await yahooIndiaProvider.getQuote(FX_SYMBOL);
  return { rate: quote.price, asOf: quote.asOf.slice(0, 10) };
}

/**
 * Shared by POST/PATCH /api/portfolio: validates the optional
 * priceCurrency/priceMode fields and returns the native per-unit price
 * plus the rate used, if any conversion was needed.
 */
export async function resolveAvgBuyPrice(params: {
  amount: unknown;
  priceCurrency: unknown;
  priceMode: unknown;
  quantity: number;
  assetClass: string;
  buyDate: Date;
}): Promise<{ avgBuyPrice: number; fx: { rate: number; asOf: string } | null }> {
  const { amount, quantity, assetClass, buyDate } = params;
  if (typeof amount !== "number" || !(amount > 0)) throw new Error("avgBuyPrice must be a positive number");

  const native = nativeCurrency(assetClass);
  const inputCurrency = (params.priceCurrency ?? native) as Currency;
  const mode = (params.priceMode ?? "PER_UNIT") as PriceMode;
  if (inputCurrency !== "INR" && inputCurrency !== "USD") throw new Error("priceCurrency must be INR or USD");
  if (mode !== "PER_UNIT" && mode !== "TOTAL") throw new Error("priceMode must be PER_UNIT or TOTAL");

  const fx = inputCurrency === native ? null : await getUsdInrRate(buyDate);
  const avgBuyPrice = toNativeUnitPrice({ amount, mode, quantity, inputCurrency, native, usdInr: fx?.rate ?? null });
  return { avgBuyPrice, fx };
}
