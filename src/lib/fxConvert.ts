// Pure FX/price maths, safe to import from client components (the
// rate lookup that needs Yahoo/Prisma lives in fx.ts).
//
// Holdings store avgBuyPrice in the asset's *native* quote currency (the
// one its price provider reports): INR for NSE/BSE, USD for US stocks and
// CoinGecko crypto. The add/edit forms let you type what you actually
// paid in rupees - often the total, not a per-unit price - and this
// converts it into that native per-unit price.

export type Currency = "INR" | "USD";
export type PriceMode = "PER_UNIT" | "TOTAL";

export function nativeCurrency(assetClass: string): Currency {
  return assetClass === "IN_STOCK" ? "INR" : "USD";
}

/**
 * amount (in `inputCurrency`, per unit or total) -> per-unit price in
 * `native` currency. `usdInr` is rupees per dollar.
 */
export function toNativeUnitPrice(params: {
  amount: number;
  mode: PriceMode;
  quantity: number;
  inputCurrency: Currency;
  native: Currency;
  usdInr: number | null;
}): number {
  const { amount, mode, quantity, inputCurrency, native, usdInr } = params;
  if (!(quantity > 0)) throw new Error("quantity must be a positive number");
  const perUnit = mode === "TOTAL" ? amount / quantity : amount;
  if (inputCurrency === native) return perUnit;
  if (!usdInr || !(usdInr > 0)) throw new Error("USD/INR rate unavailable");
  return inputCurrency === "INR" ? perUnit / usdInr : perUnit * usdInr;
}
