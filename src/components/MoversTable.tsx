"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { Quote } from "@/lib/providers/types";
import { displaySymbol, formatMoney } from "@/lib/format";
import SymbolAvatar from "@/components/ui/SymbolAvatar";
import ChangeText from "@/components/ui/ChangeText";
import Sparkline from "@/components/ui/Sparkline";
import StockDetailPanel from "@/components/stock/StockDetailPanel";

const isIndian = (symbol: string) => /\.(NS|BO)$/.test(symbol);

// Groww-style movers list: logo tile, name over ticker, optional trend
// sparkline, price stacked over change. `compact` drops the sparkline
// column and tightens rows for the dashboard's three-up cards.
//
// `details` (Indian stocks only, for now):
//   "expand" - clicking a row opens the Screener-style panel in place
//   "link"   - the row links to the full stock page (narrow layouts)
export default function MoversTable({
  quotes,
  sparks,
  compact = false,
  details,
}: {
  quotes: Quote[];
  sparks?: Record<string, number[]>;
  compact?: boolean;
  details?: "expand" | "link";
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (quotes.length === 0) {
    return <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No data available right now.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {quotes.map((q, i) => {
        const { ticker, name } = displaySymbol(q);
        const spark = sparks?.[q.symbol];
        const mode = details && isIndian(q.symbol) ? details : null;
        const expanded = mode === "expand" && open === q.symbol;

        const content = (
          <>
            {!compact && <span className="w-5 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</span>}
            <SymbolAvatar ticker={ticker} size={compact ? "sm" : "md"} />
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={name}>
                {name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{ticker}</div>
            </div>
            {!compact && spark && (
              <div className="hidden px-4 sm:block">
                <Sparkline values={spark} width={120} height={32} label={ticker} />
              </div>
            )}
            <div className={`shrink-0 text-right ${compact ? "" : "w-28"}`}>
              <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
                {formatMoney(q.price, q.currency)}
              </div>
              <ChangeText pct={q.changePercent} className="text-xs" />
            </div>
            {mode === "expand" && (
              <ChevronDown
                size={16}
                aria-hidden
                className={`shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            )}
          </>
        );

        const rowClass = `flex w-full items-center gap-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
          compact ? "px-4 py-2.5" : "px-5 py-3"
        }`;

        return (
          <Fragment key={q.symbol}>
            <li className={expanded ? "bg-slate-50/60 dark:bg-slate-800/20" : undefined}>
              {mode === "expand" ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`detail-${q.symbol}`}
                  onClick={() => setOpen(expanded ? null : q.symbol)}
                  className={rowClass}
                >
                  {content}
                </button>
              ) : mode === "link" ? (
                <Link href={`/stocks/india/${encodeURIComponent(q.symbol)}`} className={rowClass}>
                  {content}
                </Link>
              ) : (
                <div className={rowClass}>{content}</div>
              )}
              {expanded && (
                <div id={`detail-${q.symbol}`} className="border-t border-slate-100 bg-slate-50/60 px-3 py-4 dark:border-slate-800 dark:bg-slate-950/40 sm:px-5">
                  <StockDetailPanel symbol={q.symbol} />
                </div>
              )}
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
