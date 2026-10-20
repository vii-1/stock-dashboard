import type { Quote } from "@/lib/providers/types";

// INR uses the Indian lakh/crore grouping (1,24,500.00) like every Indian
// broker app; everything else uses standard grouping.
// Sub-1 prices (small-cap crypto) get 4 decimals unless `fixed` is set -
// P&L amounts always want 2.
export function formatMoney(
  value: number,
  currency: string | null = "INR",
  opts: { compact?: boolean; fixed?: boolean } = {}
): string {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const abs = Math.abs(value);
  const digits = !opts.fixed && abs !== 0 && abs < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: currency ? "currency" : "decimal",
      currency: currency ?? undefined,
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.compact ? 0 : 2,
      maximumFractionDigits: opts.compact ? 1 : digits,
    }).format(value);
  } catch {
    // Unknown currency code from a provider - fall back to plain number.
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

export function formatNumber(value: number, currency: string | null = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatSigned(value: number, currency: string | null = "INR"): string {
  return `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value), currency, { fixed: true })}`;
}

export function formatPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

// Providers hand back exchange-qualified ids (RELIANCE.NS, ^NSEI) or, for
// CoinGecko, a slug id with the ticker inside displayName ("Arbitrum (ARB)").
// This gives the short ticker + clean name a person would recognise.
export function displaySymbol(q: Pick<Quote, "symbol" | "displayName">): { ticker: string; name: string } {
  const paren = q.displayName.match(/^(.*)\s+\(([A-Z0-9.\-]+)\)$/);
  if (paren) return { ticker: paren[2], name: paren[1] };
  return { ticker: q.symbol.replace(/\.(NS|BO)$/, "").replace(/^\^/, ""), name: q.displayName };
}
