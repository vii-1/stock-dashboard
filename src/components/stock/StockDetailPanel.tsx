"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Maximize2 } from "lucide-react";
import type { KeyRatio, StockDetails } from "@/lib/fundamentals/stockDetails";
import SuggestionBadge from "@/components/SuggestionBadge";
import { formatBigMoney, formatMoney } from "@/lib/format";
import { detailPath } from "@/lib/fundamentals/paths";
import ChangeText from "@/components/ui/ChangeText";
import StatementTable from "./StatementTable";
import PriceChart from "./PriceChart";
import ProsConsCards from "./ProsConsCards";
import PriceLevelsCard from "./PriceLevelsCard";

const SECTIONS = [
  { key: "quarters", label: "Quarters" },
  { key: "profitLoss", label: "Profit & Loss" },
  { key: "balanceSheet", label: "Balance Sheet" },
  { key: "cashFlow", label: "Cash Flow" },
  { key: "ratios", label: "Ratios" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

// Unit line above each table - ₹ Crores for NSE/BSE, $ Millions for US.
function sectionNote(key: SectionKey, data: StockDetails): string {
  const unit = `Consolidated figures in ${data.scale.longLabel}`;
  if (key === "quarters") return `${unit} · latest quarter highlighted`;
  if (key === "profitLoss") return data.fiscalYearEnd ? `${unit} · financial years ending ${data.fiscalYearEnd}` : unit;
  if (key === "ratios") return "Computed from the statements above";
  return unit;
}

function formatRatio(r: KeyRatio, data: StockDetails): string {
  const locale = data.scale.locale;
  const sym = data.currency === "INR" ? "₹" : "$";
  const n = (x: number, d = 2) => x.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  if (r.value == null) return "--";
  switch (r.unit) {
    case "money":
      // India reads crores (₹ 3,01,339 Cr.); US reads compact ($3.81T).
      return data.currency === "INR"
        ? `₹ ${Math.round(r.value).toLocaleString(locale)} Cr.`
        : formatBigMoney(r.value * data.scale.divisor, "USD");
    case "price":
      return r.value2 != null ? `${sym} ${n(r.value, 0)} / ${n(r.value2, 0)}` : `${sym} ${n(r.value)}`;
    case "pct":
      return `${r.value.toFixed(2)} %`;
    case "x":
      return r.value.toFixed(2);
  }
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-5 sm:p-6 ${className}`}>{children}</div>;
}

/**
 * Screener-style stock view for one NSE/BSE or US symbol. `variant="inline"`
 * is the expanded row (statements behind tabs, link to full page);
 * `variant="page"` stacks every section like Screener's long page.
 */
export default function StockDetailPanel({
  symbol,
  variant = "inline",
  initial,
}: {
  symbol: string;
  variant?: "inline" | "page";
  initial?: StockDetails;
}) {
  const [data, setData] = useState<StockDetails | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("quarters");
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    fetch(`/api/fundamentals/stock/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load");
        if (!cancelled) setData(body);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [symbol, initial]);

  if (error) {
    return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading stock details">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
      </div>
    );
  }

  const inline = variant === "inline";
  const profile = data.profile;
  // ETFs / index funds have no company financials - hide empty tiles and
  // statement sections instead of showing a wall of "--".
  const ratios = data.keyRatios.filter((r) => r.value != null);
  const hasStatements = SECTIONS.some((s) => data[s.key].rows.length > 0);

  return (
    <div className="space-y-4">
      {/* Header + key ratios + about (Screener's top card) */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className={`font-semibold tracking-tight text-slate-900 dark:text-white ${inline ? "text-xl" : "text-3xl"}`}>{data.name}</h2>
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(data.price, data.currency)}
              </span>
              <ChangeText pct={data.changePercent} className="text-sm" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {data.exchange}: {data.ticker}
              </span>
              {profile?.sector && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{profile.sector}</span>}
              {profile?.industry && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{profile.industry}</span>}
              {profile?.website && (
                <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                  {profile.website.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.technical && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                Technical view
                <SuggestionBadge suggestion={data.technical.suggestion} reasons={data.technical.reasons} />
              </span>
            )}
            {inline && (
              <Link href={detailPath(data.market, data.symbol)} className="chip gap-1.5 !py-1 text-xs">
                <Maximize2 size={12} /> Full page
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          {/* Screener-style ratio grid. Inline (narrower) uses 2 columns so
              labels and values never wrap; the full page fits 3. */}
          <dl className={`grid grid-cols-1 gap-1.5 sm:grid-cols-2 ${inline ? "2xl:grid-cols-3" : "xl:grid-cols-3"}`}>
            {ratios.map((r) => (
              <div
                key={r.label}
                title={r.hint}
                className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm dark:bg-slate-800/40"
              >
                <dt className={`whitespace-nowrap text-slate-500 dark:text-slate-400 ${r.hint ? "cursor-help underline decoration-slate-300 decoration-dotted underline-offset-4 dark:decoration-slate-600" : ""}`}>
                  {r.label}
                </dt>
                <dd className="whitespace-nowrap font-semibold tabular-nums text-slate-900 dark:text-white">{formatRatio(r, data)}</dd>
              </div>
            ))}
          </dl>

          {profile?.businessSummary && (
            <div className="text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">About</h3>
              <p className={`mt-2 leading-relaxed text-slate-700 dark:text-slate-300 ${aboutOpen ? "" : "line-clamp-5"}`}>{profile.businessSummary}</p>
              <button onClick={() => setAboutOpen((o) => !o)} className="mt-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                {aboutOpen ? "Show less" : "Read more"}
              </button>
              {profile.employees != null && (
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{profile.employees.toLocaleString(data.scale.locale)} employees</p>
              )}
            </div>
          )}
        </div>

        {data.warnings.length > 0 && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{data.warnings.join(" ")}</p>
        )}
      </Card>

      {/* Price chart */}
      <Card>
        <PriceChart endpoint={`/api/fundamentals/stock/${encodeURIComponent(data.symbol)}/chart`} label={data.ticker} currency={data.currency} />
      </Card>

      {/* Support/resistance, volume profile, big buyers, buy zone */}
      <PriceLevelsCard symbol={data.symbol} />

      {/* Pros / Cons */}
      <ProsConsCards pros={data.pros} cons={data.cons} note="Pros and cons are generated by rules from the figures below - a starting point for research, not advice." />

      {/* Statements: tabs inline, stacked on the full page */}
      {!hasStatements ? (
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No company financial statements are available for {data.name}. This is common for ETFs and index funds,
            which hold a basket of assets rather than running a business - the price chart above is the main view.
          </p>
        </Card>
      ) : inline ? (
        <Card>
          <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Financial statements">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={section === s.key}
                onClick={() => setSection(s.key)}
                className={`chip !py-1 text-xs ${section === s.key ? "chip-active" : ""}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {SECTIONS.filter((s) => s.key === section).map((s) => (
            <StatementTable key={s.key} table={data[s.key]} unitNote={sectionNote(s.key, data)} />
          ))}
        </Card>
      ) : (
        SECTIONS.map((s) => (
          <Card key={s.key}>
            <h2 id={s.key} className="mb-1 scroll-mt-20 text-xl font-semibold tracking-tight">
              {s.label === "Quarters" ? "Quarterly Results" : s.label}
            </h2>
            <StatementTable table={data[s.key]} unitNote={sectionNote(s.key, data)} />
          </Card>
        ))
      )}

      <p className="text-xs text-slate-400">
        Data: Yahoo Finance (statements, valuation, prices). Some quarters may be missing where the source has gaps.
      </p>
    </div>
  );
}
