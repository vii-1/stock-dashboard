"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import StockDetailPanel from "@/components/stock/StockDetailPanel";
import type { Suggestion } from "@/lib/suggestions/scoreHolding";
import SuggestionBadge from "@/components/SuggestionBadge";
import SymbolAvatar from "@/components/ui/SymbolAvatar";
import { displaySymbol, formatMoney, formatSigned } from "@/lib/format";
import { nativeCurrency } from "@/lib/fxConvert";
import BuyPriceInput, { type BuyPriceValue } from "@/components/BuyPriceInput";

const ASSET_CLASS_LABELS: Record<string, string> = {
  IN_STOCK: "India",
  US_STOCK: "US",
  CRYPTO: "Crypto",
};

export interface HoldingRow {
  id: string;
  assetClass: string;
  symbol: string;
  displayName: string | null;
  quantity: number;
  buyDateIso: string;
  // All money fields are in rupees (see InrView in lib/portfolio/enrich.ts).
  // null when there is no live price or no USD/INR rate.
  avgBuyPrice: number | null;
  invested: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  // Dollar figures for US stocks / crypto, shown under the rupee ones.
  native: { currency: string; avgBuyPrice: number; currentPrice: number | null } | null;
  quoteError: string | null;
  portfolioWeightPct: number | null;
  suggestion: Suggestion | null;
  reasons: string[];
  // Set when a connected broker reports the same stock - totals use the
  // broker's figures and skip this row, so it's tagged to explain why.
  countedBy?: string | null;
}

function EditRowForm({ row, onDone }: { row: HoldingRow; onDone: () => void }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(row.quantity));
  // Opens in rupees, matching the table: crypto as the total invested,
  // stocks as the per-unit price. Converting back uses the same buy-date
  // rate, so saving untouched leaves the stored price as it was. Falls
  // back to the native price if the rupee view was unavailable.
  const [price, setPrice] = useState<BuyPriceValue>(() => {
    const round = (n: number) => String(Math.round(n * 100) / 100);
    if (row.native && row.invested != null && row.assetClass === "CRYPTO") {
      return { amount: round(row.invested), currency: "INR", mode: "TOTAL" };
    }
    if (row.avgBuyPrice != null) return { amount: round(row.avgBuyPrice), currency: "INR", mode: "PER_UNIT" };
    return { amount: String(row.native?.avgBuyPrice ?? ""), currency: nativeCurrency(row.assetClass), mode: "PER_UNIT" };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: Number(quantity),
          avgBuyPrice: Number(price.amount),
          priceCurrency: price.currency,
          priceMode: price.mode,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update holding");
      }
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update holding");
    } finally {
      setSaving(false);
    }
  }

  return (
    <td colSpan={9} className="px-3 py-2">
      <div className="flex flex-wrap items-end gap-3">
        <span className="self-center font-medium">{row.symbol}</span>
        <label className="flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
          Qty
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-32 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
        <div className="w-full max-w-sm">
          <BuyPriceInput
            assetClass={row.assetClass}
            quantity={Number(quantity)}
            buyDate={row.buyDateIso.slice(0, 10)}
            value={price}
            onChange={setPrice}
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onDone}
          className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-loss">{error}</span>}
      </div>
    </td>
  );
}

export default function HoldingsTable({ rows, emptyText = "No holdings yet - add your first one above." }: { rows: HoldingRow[]; emptyText?: string }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Indian stocks expand into the Screener-style panel (one at a time).
  const [openId, setOpenId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Remove this holding?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete holding");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete holding");
    } finally {
      setDeletingId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="data-table [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Avg buy</th>
            <th className="px-3 py-2 text-right">LTP</th>
            <th className="px-3 py-2 text-right">Current value</th>
            <th className="px-3 py-2 text-right">Unrealized P&amp;L</th>
            <th className="px-3 py-2 text-right">Weight</th>
            <th className="px-3 py-2">Suggestion</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            editingId === row.id ? (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <EditRowForm row={row} onDone={() => setEditingId(null)} />
              </tr>
            ) : (
              <Fragment key={row.id}>
              <tr className={openId === row.id ? "bg-slate-50/80 dark:bg-slate-800/30" : undefined}>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    {row.assetClass === "IN_STOCK" ? (
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === row.id ? null : row.id)}
                        aria-expanded={openId === row.id}
                        aria-label={`${openId === row.id ? "Hide" : "Show"} fundamentals for ${row.symbol}`}
                        className="-ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <ChevronDown size={15} className={`transition-transform ${openId === row.id ? "rotate-180" : ""}`} />
                      </button>
                    ) : (
                      <span className="w-[19px]" aria-hidden />
                    )}
                    <SymbolAvatar ticker={displaySymbol({ symbol: row.symbol, displayName: row.symbol }).ticker} size="sm" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {displaySymbol({ symbol: row.symbol, displayName: row.symbol }).ticker.toUpperCase()}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {ASSET_CLASS_LABELS[row.assetClass] ?? row.assetClass}
                        </span>
                        {row.countedBy && (
                          <span
                            className="rounded bg-blue-100 px-1.5 py-px text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                            title={`Also held in ${row.countedBy} - totals count it once, using the broker's figures`}
                          >
                            via {row.countedBy}
                          </span>
                        )}
                        {row.displayName && <span className="max-w-[12rem] truncate">{row.displayName}</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{row.quantity}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.avgBuyPrice != null ? formatMoney(row.avgBuyPrice, "INR") : "--"}
                  {row.native && <div className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(row.native.avgBuyPrice, row.native.currency)}</div>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.currentPrice != null ? (
                    formatMoney(row.currentPrice, "INR")
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500" title={row.quoteError ?? undefined}>
                      --
                    </span>
                  )}
                  {row.native?.currentPrice != null && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(row.native.currentPrice, row.native.currency)}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.marketValue != null ? formatMoney(row.marketValue, "INR") : "--"}
                  {row.invested != null && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(row.invested, "INR")} invested</div>
                  )}
                </td>
                <td
                  className={`px-3 py-3 text-right tabular-nums font-medium ${
                    row.unrealizedPnl == null
                      ? "text-slate-400 dark:text-slate-500"
                      : row.unrealizedPnl >= 0
                        ? "text-gain dark:text-gain-dark"
                        : "text-loss"
                  }`}
                >
                  {row.unrealizedPnl != null && row.unrealizedPnlPct != null ? (
                    <>
                      {formatSigned(row.unrealizedPnl, "INR")}
                      <div className="text-xs">
                        {row.unrealizedPnlPct >= 0 ? "+" : ""}
                        {row.unrealizedPnlPct.toFixed(2)}%
                      </div>
                    </>
                  ) : (
                    "--"
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.portfolioWeightPct != null ? `${row.portfolioWeightPct.toFixed(1)}%` : "--"}
                </td>
                <td className="px-3 py-3">
                  {row.suggestion ? (
                    <SuggestionBadge suggestion={row.suggestion} reasons={row.reasons} />
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">--</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setEditingId(row.id)}
                      aria-label={`Edit ${row.symbol}`}
                      title="Edit"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(row.id)}
                      disabled={deletingId === row.id}
                      aria-label={`Remove ${row.symbol}`}
                      title="Remove"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-loss disabled:opacity-50 dark:hover:bg-red-500/10"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
              {openId === row.id && (
                <tr>
                  <td colSpan={9} className="!whitespace-normal bg-slate-50/60 px-3 py-4 dark:bg-slate-950/40">
                    {/* w-0 + min-w-full: fill the cell without widening the table */}
                    <div className="w-0 min-w-full">
                      <StockDetailPanel symbol={row.symbol} />
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
