import { formatMoney, formatSigned } from "@/lib/format";

export interface SummaryTotals {
  invested: number;
  current: number;
  // Optional 4th tile: today's P&L (stocks/crypto) or monthly SIP (funds).
  extra?: { label: string; value: number; signed?: boolean; pct?: number | null; note?: string };
}

/**
 * Overview row shared by every portfolio section (Stocks, Crypto, Mutual
 * Funds): Invested · Current value · Total P&L (with %) · one extra tile.
 * All amounts in rupees.
 */
export default function SummaryTiles({ totals }: { totals: SummaryTotals }) {
  const pnl = totals.current - totals.invested;
  const pnlPct = totals.invested > 0 ? (pnl / totals.invested) * 100 : 0;
  const tone = (x: number) => (x >= 0 ? "text-gain dark:text-gain-dark" : "text-loss");
  const extra = totals.extra;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="card p-4">
        <div className="text-xs text-slate-500 dark:text-slate-400">Invested</div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(totals.invested, "INR")}</div>
      </div>
      <div className="card p-4">
        <div className="text-xs text-slate-500 dark:text-slate-400">Current value</div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(totals.current, "INR")}</div>
      </div>
      <div className="card p-4">
        <div className="text-xs text-slate-500 dark:text-slate-400">Total P&amp;L</div>
        <div className={`mt-1 text-lg font-semibold tabular-nums ${tone(pnl)}`}>
          {formatSigned(pnl, "INR")}
          <span className="ml-1.5 text-sm font-medium">
            ({pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(2)}%)
          </span>
        </div>
      </div>
      {extra && (
        <div className="card p-4" title={extra.note}>
          <div className="text-xs text-slate-500 dark:text-slate-400">{extra.label}</div>
          <div className={`mt-1 text-lg font-semibold tabular-nums ${extra.signed ? tone(extra.value) : ""}`}>
            {extra.signed ? formatSigned(extra.value, "INR") : formatMoney(extra.value, "INR")}
            {extra.pct != null && (
              <span className="ml-1.5 text-sm font-medium">
                ({extra.pct >= 0 ? "+" : ""}
                {extra.pct.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
