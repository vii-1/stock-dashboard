export interface PaperPositionRow {
  symbol: string;
  assetClass: string;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number | null;
  currency: string | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  quoteError: string | null;
}

// Read-only by design - unlike HoldingsTable, nothing here is user-
// editable. The agent owns these positions; a human clicking "edit" on
// a simulated position it's actively managing would just be confusing.
export default function PaperPositionsTable({ rows }: { rows: PaperPositionRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No open paper positions - the agent hasn&apos;t bought anything yet.
      </p>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="px-4 py-2">Symbol</th>
            <th className="px-4 py-2">Class</th>
            <th className="px-4 py-2 text-right">Qty</th>
            <th className="px-4 py-2 text-right">Avg buy</th>
            <th className="px-4 py-2 text-right">Current</th>
            <th className="px-4 py-2 text-right">Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
            >
              <td className="px-4 py-3 font-mono">{row.symbol}</td>
              <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{row.assetClass}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.quantity.toFixed(4)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.avgBuyPrice.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.currentPrice != null ? (
                  <>
                    {row.currency} {row.currentPrice.toFixed(2)}
                  </>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500" title={row.quoteError ?? undefined}>
                    --
                  </span>
                )}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums font-medium ${
                  row.unrealizedPnl == null
                    ? "text-slate-400 dark:text-slate-500"
                    : row.unrealizedPnl >= 0
                      ? "text-gain dark:text-gain-dark"
                      : "text-loss"
                }`}
              >
                {row.unrealizedPnl != null && row.unrealizedPnlPct != null ? (
                  <>
                    {row.unrealizedPnl >= 0 ? "+" : ""}
                    {row.unrealizedPnl.toFixed(2)} ({row.unrealizedPnlPct >= 0 ? "+" : ""}
                    {row.unrealizedPnlPct.toFixed(1)}%)
                  </>
                ) : (
                  "--"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
