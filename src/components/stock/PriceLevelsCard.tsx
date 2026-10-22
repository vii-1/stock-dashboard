"use client";

import { useEffect, useState } from "react";
import { Info, Target } from "lucide-react";
import type { StockLevels } from "@/lib/levels/stockLevels";
import { formatMoney, formatNumber } from "@/lib/format";

// "Price levels" card in the stock panel: long-term buy zone, a ladder of
// support/resistance/volume/big-buyer levels, and the NSE big-buyer list.
// Data: /api/fundamentals/stock/[symbol]/levels (lib/levels).

type Kind = "resistance" | "support" | "price" | "poc" | "buyers" | "sma200";

const KIND_STYLE: Record<Kind, { tag: string; label: string }> = {
  resistance: { tag: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300", label: "Resistance" },
  support: { tag: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300", label: "Support" },
  price: { tag: "bg-slate-900 text-white dark:bg-white dark:text-slate-900", label: "Now" },
  poc: { tag: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300", label: "Most traded" },
  buyers: { tag: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300", label: "Big buyers" },
  sma200: { tag: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", label: "200-day avg" },
};

interface Rung {
  kind: Kind;
  price: number;
  detail: string;
}

function pct(from: number, to: number): string {
  const p = ((to - from) / from) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export default function PriceLevelsCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<StockLevels | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/fundamentals/stock/${encodeURIComponent(symbol)}/levels`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load");
        if (!cancelled) setData(body);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (error) {
    return (
      <div className="card p-5 sm:p-6">
        <h3 className="card-title">Price levels</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" aria-busy="true" aria-label="Loading price levels" />;
  }

  const money = (n: number) => formatMoney(n, data.currency);
  const zone = data.buyZone;
  const buyers = data.bigBuyers;

  const rungs: Rung[] = [
    ...data.resistances.map((l) => ({ kind: "resistance" as const, price: l.price, detail: `${l.touches} touch${l.touches > 1 ? "es" : ""}, last ${l.lastTouched}` })),
    ...data.supports.map((l) => ({ kind: "support" as const, price: l.price, detail: `${l.touches} touch${l.touches > 1 ? "es" : ""}, last ${l.lastTouched}` })),
    { kind: "price", price: data.price, detail: `Close ${data.asOf}` },
  ];
  if (data.profile) rungs.push({ kind: "poc", price: data.profile.poc, detail: "Price with the most volume, last 12 months" });
  if (buyers?.avgPrice != null) rungs.push({ kind: "buyers", price: buyers.avgPrice, detail: `Avg cost of ${buyers.buyers.length > 1 ? "net buyers" : "the net buyer"} in NSE bulk/block deals` });
  if (data.sma200 != null) rungs.push({ kind: "sma200", price: data.sma200, detail: "Long-term trend line" });
  rungs.sort((a, b) => b.price - a.price);

  // 52-week bar positions
  const w = data.week52;
  const pos = (n: number) => (w ? Math.min(100, Math.max(0, ((n - w.low) / (w.high - w.low)) * 100)) : 0);

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="card-title">Price levels</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">2 years of daily prices · as of {data.asOf}</span>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          {/* Long-term buy zone */}
          <div className="rounded-xl border border-green-300 bg-green-50/50 p-4 dark:border-green-800 dark:bg-green-900/10">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-800 dark:text-green-300">
              <Target size={14} /> Long-term buy zone
            </div>
            {zone ? (
              <>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {money(zone.low)} – {money(zone.high)}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {zone.distancePct === 0 ? "Price is in this zone now." : `${zone.distancePct.toFixed(1)}% below the current price.`}
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
                  {zone.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                <p
                  className="mt-3 cursor-help text-xs text-slate-500 underline decoration-dotted underline-offset-4 dark:text-slate-400"
                  title="Each time the price fell into this zone over the last 2 years, did it close more than 3% below it within 20 sessions? The zone was found in the same data, so this flatters it - treat it as a best case."
                >
                  {zone.tests === 0
                    ? "Price hasn't come down into this zone in the last 2 years."
                    : `Held ${zone.holds} of ${zone.tests} past visits (2 years).`}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                No support levels below the current price in 2 years of data - the stock is at or near its lows, so there&apos;s no
                tested floor to point to.
              </p>
            )}
          </div>

          {/* 52-week range */}
          {w && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>52W low {money(w.low)}</span>
                <span>52W high {money(w.high)}</span>
              </div>
              <div className="relative mt-2 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                {zone && (
                  <div
                    className="absolute inset-y-0 rounded-full bg-green-400/60 dark:bg-green-500/50"
                    style={{ left: `${pos(zone.low)}%`, width: `${Math.max(1.5, pos(zone.high) - pos(zone.low))}%` }}
                    title={`Buy zone ${money(zone.low)} – ${money(zone.high)}`}
                  />
                )}
                <div
                  className="absolute -top-1 w-1 -translate-x-1/2 rounded-full bg-slate-900 dark:bg-white"
                  style={{ left: `${pos(data.price)}%`, height: "18px" }}
                  title={`Now ${money(data.price)}`}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Now {money(data.price)} · {pos(data.price).toFixed(0)}% of the way up its 52-week range
              </p>
            </div>
          )}
        </div>

        {/* Level ladder */}
        <div>
          <ol className="divide-y divide-slate-100 dark:divide-slate-800" aria-label="Price levels, highest first">
            {rungs.map((r, i) => (
              <li
                key={`${r.kind}-${i}`}
                className={`flex items-center gap-3 py-2 text-sm ${r.kind === "price" ? "font-semibold" : ""} ${
                  zone && r.kind !== "price" && r.price >= zone.low && r.price <= zone.high ? "bg-green-50/60 dark:bg-green-900/10" : ""
                }`}
              >
                <span className={`w-24 shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-medium ${KIND_STYLE[r.kind].tag}`}>
                  {KIND_STYLE[r.kind].label}
                </span>
                <span className="w-28 shrink-0 tabular-nums text-slate-900 dark:text-white">{money(r.price)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400" title={r.detail}>
                  {r.detail}
                </span>
                {r.kind !== "price" && (
                  <span className={`shrink-0 text-xs tabular-nums ${r.price >= data.price ? "text-gain dark:text-gain-dark" : "text-loss"}`}>
                    {pct(data.price, r.price)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {data.resistances.length === 0 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No resistance above - the price is near its 2-year high.</p>
          )}
        </div>
      </div>

      {/* Big buyers (NSE bulk/block deals) */}
      {buyers && (
        <div className="mt-6">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Big buyers · NSE bulk &amp; block deals, last 12 months
          </h4>
          {buyers.buyers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {buyers.dealCount === 0
                ? "No bulk or block deals were reported. That's normal for large companies: funds mostly buy in the open market, which isn't disclosed per buyer."
                : `${buyers.dealCount} deals were reported, but every client both bought and sold (${buyers.tradersExcluded} traders, e.g. high-frequency or arbitrage desks), so there's no long-term buyer price to show.`}
            </p>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Buyer</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Shares (net)</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Avg price</th>
                      <th className="py-1.5 pr-4 text-right font-medium">vs now</th>
                      <th className="py-1.5 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {buyers.buyers.map((b) => (
                      <tr key={b.client}>
                        <td className="max-w-[16rem] truncate py-1.5 pr-4" title={b.client}>
                          {b.client}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{formatNumber(b.quantity, data.currency).replace(/\.00$/, "")}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{money(b.avgPrice)}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${data.price >= b.avgPrice ? "text-gain dark:text-gain-dark" : "text-loss"}`}>
                          {pct(b.avgPrice, data.price)}
                        </td>
                        <td className="whitespace-nowrap py-1.5 text-xs text-slate-500 dark:text-slate-400">
                          {b.firstDate === b.lastDate ? b.firstDate : `${b.firstDate} → ${b.lastDate}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {buyers.avgPrice != null &&
                  (data.price < buyers.avgPrice
                    ? `The stock trades ${(((buyers.avgPrice - data.price) / buyers.avgPrice) * 100).toFixed(1)}% below these buyers' average cost of ${money(buyers.avgPrice)} - they are sitting on a loss. `
                    : `The stock trades above these buyers' average cost of ${money(buyers.avgPrice)}. `)}
                {buyers.tradersExcluded > 0 && `${buyers.tradersExcluded} client${buyers.tradersExcluded > 1 ? "s" : ""} who both bought and sold were left out as traders.`}
              </p>
            </>
          )}
        </div>
      )}

      {data.warnings.length > 0 && <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">{data.warnings.join(" ")}</p>}

      <p className="mt-4 flex gap-1.5 text-xs text-slate-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Levels show where buyers and sellers were active before - they are reference points, not predictions or a guaranteed
          floor. Big funds can and do sell below their buy price, and a broken support often becomes resistance.
        </span>
      </p>
    </div>
  );
}
