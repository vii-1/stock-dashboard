"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ScoredBrokerHolding } from "@/lib/brokers";
import { totalQuantity, yahooSymbol } from "@/lib/brokers/types";
import { formatMoney, formatSigned } from "@/lib/format";
import StockDetailPanel from "@/components/stock/StockDetailPanel";
import SymbolAvatar from "@/components/ui/SymbolAvatar";
import SuggestionBadge from "@/components/SuggestionBadge";

// Read-only demat holdings from any connected broker (Kite, Angel One),
// shown as the broker reports them; nothing here edits or trades them.
// Each row expands into the Screener-style fundamentals panel.
export default function BrokerHoldingsTable({
  holdings,
  emptyText = "No holdings in this account.",
}: {
  holdings: ScoredBrokerHolding[];
  emptyText?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (holdings.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="data-table [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Avg buy</th>
            <th className="text-right">LTP</th>
            <th className="text-right">Current value</th>
            <th className="text-right">Day</th>
            <th className="text-right">P&amp;L</th>
            <th>Suggestion</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const qty = totalQuantity(h);
            const invested = h.averagePrice * qty;
            const pnlPct = invested > 0 ? (h.pnl / invested) * 100 : 0;
            const key = `${h.broker}:${h.exchange}:${h.tradingsymbol}`;
            const expanded = open === key;
            return (
              <Fragment key={key}>
                <tr className={expanded ? "bg-slate-50/80 dark:bg-slate-800/30" : undefined}>
                  <td>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : key)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} fundamentals for ${h.tradingsymbol}`}
                      className="flex items-center gap-3 text-left"
                    >
                      <ChevronDown size={15} aria-hidden className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                      <SymbolAvatar ticker={h.tradingsymbol} size="sm" />
                      <span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{h.tradingsymbol}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{h.exchange}</span>
                      </span>
                    </button>
                  </td>
                  <td className="text-right tabular-nums">
                    {h.quantity}
                    {h.t1Quantity > 0 && (
                      <span className="text-xs text-slate-500 dark:text-slate-400" title="T1 - bought, not yet settled">
                        {" "}
                        +{h.t1Quantity} T1
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(h.averagePrice, "INR")}</td>
                  <td className="text-right tabular-nums">{formatMoney(h.lastPrice, "INR")}</td>
                  <td className="text-right tabular-nums">
                    {formatMoney(h.lastPrice * qty, "INR")}
                    <div className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(invested, "INR")} invested</div>
                  </td>
                  <td className={`text-right tabular-nums ${h.dayChangePct >= 0 ? "text-gain dark:text-gain-dark" : "text-loss"}`}>
                    {h.dayChangePct >= 0 ? "+" : ""}
                    {h.dayChangePct.toFixed(2)}%
                  </td>
                  <td className={`text-right tabular-nums font-medium ${h.pnl >= 0 ? "text-gain dark:text-gain-dark" : "text-loss"}`}>
                    {formatSigned(h.pnl, "INR")}
                    <div className="text-xs">
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(2)}%
                    </div>
                  </td>
                  <td>
                    {h.score ? (
                      <SuggestionBadge suggestion={h.score.suggestion} reasons={h.score.reasons} />
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500" title="No price history from Yahoo">
                        --
                      </span>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={8} className="!whitespace-normal bg-slate-50/60 px-3 py-4 dark:bg-slate-950/40">
                      {/* w-0 + min-w-full: fill the cell without widening the table */}
                      <div className="w-0 min-w-full">
                        <StockDetailPanel symbol={yahooSymbol(h)} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
