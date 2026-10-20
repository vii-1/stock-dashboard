import { prisma } from "@/lib/prisma";
import { providerForAssetClass } from "@/lib/portfolio/enrich";
import type { Quote } from "@/lib/providers/types";
import PaperPositionsTable, { type PaperPositionRow } from "@/components/PaperPositionsTable";

const MODE = "PAPER";

const SUGGESTION_STYLES: Record<string, string> = {
  STRONG_BUY: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  HOLD: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  TRIM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SELL_REVIEW: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  STOP_LOSS: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// Batched per asset class (getQuotes, not N x getQuote) - CoinGecko's
// free tier rate-limits aggressively enough that one request per symbol
// tripped a 429 on every single one of them when the trading agent did
// this the naive way. Same fix here, from the start.
async function fetchQuotesBySymbol(positions: { symbol: string; assetClass: string }[]) {
  const symbolsByAssetClass = new Map<string, string[]>();
  for (const p of positions) {
    const list = symbolsByAssetClass.get(p.assetClass) ?? [];
    list.push(p.symbol);
    symbolsByAssetClass.set(p.assetClass, list);
  }

  const quotes = new Map<string, Quote>();
  for (const [assetClass, symbols] of symbolsByAssetClass) {
    try {
      const results = await providerForAssetClass(assetClass).getQuotes(symbols);
      for (const quote of results) quotes.set(quote.symbol, quote);
    } catch (err) {
      console.error(`Failed to fetch quotes for ${assetClass}`, err);
    }
  }
  return quotes;
}

export default async function AgentPage() {
  const [account, positions, state, recentOrders, recentDecisions] = await Promise.all([
    prisma.paperAccount.findUnique({ where: { mode: MODE } }),
    prisma.paperPosition.findMany({ where: { mode: MODE } }),
    prisma.agentState.findUnique({ where: { id: MODE } }),
    prisma.order.findMany({ where: { mode: MODE }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.decisionLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const quotes = await fetchQuotesBySymbol(positions);

  const positionRows: PaperPositionRow[] = positions.map((p) => {
    const quote = quotes.get(p.symbol) ?? null;
    if (!quote) {
      return {
        symbol: p.symbol,
        assetClass: p.assetClass,
        quantity: p.quantity,
        avgBuyPrice: p.avgBuyPrice,
        currentPrice: null,
        currency: null,
        unrealizedPnl: null,
        unrealizedPnlPct: null,
        quoteError: "Couldn't fetch a live price.",
      };
    }
    return {
      symbol: p.symbol,
      assetClass: p.assetClass,
      quantity: p.quantity,
      avgBuyPrice: p.avgBuyPrice,
      currentPrice: quote.price,
      currency: quote.currency,
      unrealizedPnl: (quote.price - p.avgBuyPrice) * p.quantity,
      unrealizedPnlPct: p.avgBuyPrice > 0 ? ((quote.price - p.avgBuyPrice) / p.avgBuyPrice) * 100 : 0,
      quoteError: null,
    };
  });

  const positionsValue = positions.reduce((sum, p) => {
    const quote = quotes.get(p.symbol);
    return sum + (quote ? p.quantity * quote.price : p.quantity * p.avgBuyPrice);
  }, 0);
  const cash = account?.cash ?? 0;
  const totalValue = cash + positionsValue;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="page-title">Paper Trading Agent</h1>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Simulated - not real money
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Runs via <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">npm run agent:run</code>, separate
          from your real holdings on <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">/portfolio</code>
          . See <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">TRADING_AGENT_DESIGN.md</code> for how
          it decides.
        </p>
      </div>

      {!account ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          No paper account yet - run <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">npm run agent:run</code>{" "}
          at least once to create one.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Cash</div>
            <div className="mt-1.5 text-2xl font-semibold">{cash.toFixed(2)}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total value (cash + positions)
            </div>
            <div className="mt-1.5 text-2xl font-semibold">{totalValue.toFixed(2)}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Kill switch</div>
            <div
              className={`mt-1.5 text-lg font-semibold ${state?.killSwitchActive ? "text-loss" : "text-gain dark:text-gain-dark"}`}
            >
              {state?.killSwitchActive ? "ACTIVE" : "Inactive"}
            </div>
            {state?.killSwitchActive && (
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{state.killSwitchReason}</div>
            )}
            {state && (
              <div className="mt-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Trades today: {state.tradesToday} · Realized loss today: {state.realizedLossToday.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-2 font-medium">Open positions</h2>
        <PaperPositionsTable rows={positionRows} />
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recent orders</h2>
        {recentOrders.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No orders placed yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Side</th>
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr
                    key={o.id}
                  >
                    <td className="px-4 py-3 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      {o.createdAt.toLocaleString()}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium ${o.side === "BUY" ? "text-gain dark:text-gain-dark" : "text-loss"}`}
                    >
                      {o.side}
                    </td>
                    <td className="px-4 py-3 font-mono">{o.symbol}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.quantity.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.price.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {o.status === "FILLED" ? (
                        <span className="text-gain dark:text-gain-dark">FILLED</span>
                      ) : (
                        <span className="text-loss" title={o.rejectReason ?? undefined}>
                          REJECTED
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recent decisions</h2>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Every decision the agent makes, including HOLD - this is the audit trail worth reviewing during the
          paper-trading weeks, not just the trades that happened.
        </p>
        {recentDecisions.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No decisions logged yet.</p>
        ) : (
          <div className="space-y-2">
            {recentDecisions.map((d) => {
              const reasons: string[] = JSON.parse(d.reasons);
              return (
                <div
                  key={d.id}
                  className="card p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{d.symbol}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          SUGGESTION_STYLES[d.suggestion] ?? SUGGESTION_STYLES.HOLD
                        }`}
                      >
                        {d.suggestion.replace("_", " ")}
                      </span>
                      {d.executed && (
                        <span className="text-xs font-medium text-gain dark:text-gain-dark">executed</span>
                      )}
                      {d.blockReason && (
                        <span className="text-xs font-medium text-loss">blocked</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {d.createdAt.toLocaleString()}
                    </span>
                  </div>
                  <ul className="mt-1 list-inside list-disc text-xs text-slate-500 dark:text-slate-400">
                    {reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                    {d.blockReason && <li className="text-loss">Blocked: {d.blockReason}</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
