"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Maximize2 } from "lucide-react";
import type { CoinStat, CryptoDetails } from "@/lib/fundamentals/cryptoDetails";
import { formatBigMoney, formatMoney } from "@/lib/format";
import { detailPath } from "@/lib/fundamentals/paths";
import SuggestionBadge from "@/components/SuggestionBadge";
import ChangeText from "@/components/ui/ChangeText";
import PriceChart from "./PriceChart";
import ProsConsCards from "./ProsConsCards";

// Whole dollars once a price is in the thousands ($82,667), cents below,
// and enough decimals for sub-dollar coins.
function usdPrice(v: number): string {
  if (v >= 1000) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
  return formatMoney(v, "USD");
}

function formatStat(s: CoinStat): string {
  const v = s.value;
  if (v == null) return "--";
  if (typeof v === "string") return s.kind === "date" ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : v;
  switch (s.kind) {
    case "usd":
      return s.value2 != null ? `${usdPrice(v)} / ${usdPrice(s.value2)}` : usdPrice(v);
    case "usdBig":
      return formatBigMoney(v, "USD");
    case "pct":
      return `${v >= 0 && /Change|ATH/.test(s.label) ? "+" : ""}${v.toFixed(2)} %`;
    case "supply":
      return new Intl.NumberFormat("en-US", { notation: v >= 1e7 ? "compact" : "standard", maximumFractionDigits: v >= 1e7 ? 2 : 0 }).format(v);
    default:
      return String(v);
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5 sm:p-6">{children}</div>;
}

/**
 * Coin view in the same layout as StockDetailPanel: header, key stats +
 * About, price chart, pros/cons. Coins have no statements, so the stats
 * grid carries supply, valuation and all-time-high data instead.
 */
export default function CryptoDetailPanel({
  id,
  variant = "inline",
  initial,
}: {
  id: string; // CoinGecko id
  variant?: "inline" | "page";
  initial?: CryptoDetails;
}) {
  const [data, setData] = useState<CryptoDetails | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    fetch(`/api/fundamentals/crypto/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load");
        if (!cancelled) setData(body);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [id, initial]);

  if (error) {
    return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading coin details">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
      </div>
    );
  }

  const inline = variant === "inline";
  const stats = data.stats.filter((s) => s.value != null);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {data.image && (
              // CoinGecko-hosted logo; tiny, so a plain img is fine here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.image} alt="" width={inline ? 36 : 44} height={inline ? 36 : 44} className="mt-0.5 rounded-full" />
            )}
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className={`font-semibold tracking-tight text-slate-900 dark:text-white ${inline ? "text-xl" : "text-3xl"}`}>{data.name}</h2>
                <span className="text-lg font-semibold tabular-nums">{formatMoney(data.priceUsd, "USD")}</span>
                <ChangeText pct={data.changePercent} className="text-sm" />
                {data.priceInr != null && <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">≈ {formatMoney(data.priceInr, "INR")}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{data.ticker}</span>
                {data.rank != null && (
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Rank #{data.rank}</span>
                )}
                {data.categories.map((c) => (
                  <span key={c} className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                    {c}
                  </span>
                ))}
                {data.website && (
                  <a href={data.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                    {data.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} <ExternalLink size={11} />
                  </a>
                )}
              </div>
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
              <Link href={detailPath("crypto", data.id)} className="chip gap-1.5 !py-1 text-xs">
                <Maximize2 size={12} /> Full page
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          {/* Two columns until very wide screens - coin values (supplies, price
              pairs) are longer than the stock ratios, so 3 columns cramp them. */}
          <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} title={s.hint} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm dark:bg-slate-800/40">
                <dt
                  className={`whitespace-nowrap text-slate-500 dark:text-slate-400 ${s.hint ? "cursor-help underline decoration-slate-300 decoration-dotted underline-offset-4 dark:decoration-slate-600" : ""}`}
                >
                  {s.label}
                </dt>
                <dd
                  className={`whitespace-nowrap font-semibold tabular-nums ${
                    s.kind === "pct" && typeof s.value === "number" && /Change|ATH/.test(s.label)
                      ? s.value >= 0
                        ? "text-gain dark:text-gain-dark"
                        : "text-loss"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {formatStat(s)}
                </dd>
              </div>
            ))}
          </dl>

          {data.description && (
            <div className="text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">About</h3>
              <p className={`mt-2 whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-300 ${aboutOpen ? "" : "line-clamp-6"}`}>{data.description}</p>
              <button onClick={() => setAboutOpen((o) => !o)} className="mt-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                {aboutOpen ? "Show less" : "Read more"}
              </button>
            </div>
          )}
        </div>

        {data.warnings.length > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{data.warnings.join(" ")}</p>}
      </Card>

      <Card>
        <PriceChart endpoint={`/api/fundamentals/crypto/${encodeURIComponent(data.id)}/chart`} label={data.ticker} currency="USD" />
      </Card>

      <ProsConsCards
        pros={data.pros}
        cons={data.cons}
        note="Pros and cons are generated by rules from the stats above - a starting point for research, not advice."
      />

      <p className="text-xs text-slate-400">
        Data: CoinGecko (stats, up to 1 year of prices); Yahoo Finance for 3Y / 5Y / Max charts where its ticker matches this coin.
      </p>
    </div>
  );
}
