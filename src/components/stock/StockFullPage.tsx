import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getStockDetails, type StockDetails } from "@/lib/fundamentals/stockDetails";
import { isIndianSymbol, STOCK_SYMBOL } from "@/lib/fundamentals/paths";
import StockDetailPanel from "@/components/stock/StockDetailPanel";

const NAV = [
  { href: "#top", label: "Overview" },
  { href: "#quarters", label: "Quarters" },
  { href: "#profitLoss", label: "Profit & Loss" },
  { href: "#balanceSheet", label: "Balance Sheet" },
  { href: "#cashFlow", label: "Cash Flow" },
  { href: "#ratios", label: "Ratios" },
];

// Full Screener-style page for one stock, shared by /stocks/india/[symbol]
// (NSE/BSE, ₹ crores) and /stocks/us/[symbol] (US, $ millions). Server-
// fetches the details so the page arrives filled in; the chart still
// loads client-side per range.
export default async function StockFullPage({ market, rawSymbol }: { market: "india" | "us"; rawSymbol: string }) {
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();
  // The URL's market must match the symbol (no RELIANCE.NS under /stocks/us).
  if (!STOCK_SYMBOL.test(symbol) || isIndianSymbol(symbol) !== (market === "india")) notFound();
  const back = market === "india" ? { href: "/stocks/india", label: "India Stocks" } : { href: "/stocks/us", label: "US Stocks" };

  let details: StockDetails | null = null;
  let error: string | null = null;
  try {
    details = await getStockDetails(symbol);
  } catch (err) {
    console.error(`Stock page failed for ${symbol}`, err);
    error = "Couldn't load this stock right now. Try again in a bit.";
  }

  return (
    <div id="top" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={back.href} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
          <ArrowLeft size={14} /> {back.label}
        </Link>
      </div>
      <nav className="sticky top-0 z-20 -mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
            {n.label}
          </a>
        ))}
      </nav>
      {error || !details ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
      ) : (
        <StockDetailPanel symbol={symbol} variant="page" initial={details} />
      )}
    </div>
  );
}
