import Link from "next/link";
import { ArrowRight, Link2, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { loadAllPositions, type AllPositions } from "@/lib/portfolio/combined";
import { BROKER_LABELS, type BrokerId, type BrokerStatus } from "@/lib/brokers/types";
import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";
import { getIndexSnapshots } from "@/lib/market/indices";
import { formatMoney, formatNumber, formatSigned } from "@/lib/format";
import MoversTable from "@/components/MoversTable";
import ChangeText from "@/components/ui/ChangeText";
import Sparkline from "@/components/ui/Sparkline";

const MARKETS = [
  { key: "India", href: "/stocks/india", provider: yahooIndiaProvider },
  { key: "US", href: "/stocks/us", provider: yahooUsProvider },
  { key: "Crypto", href: "/crypto", provider: coingeckoProvider },
];

// Fixed order -> fixed categorical slot (series-1..4), so a class keeps
// its colour even when another class is absent. Dark-surface steps of
// categorical slots 1-4 (the hero band is always dark).
const ASSET_CLASSES = [
  { key: "IN_STOCK", label: "India Stocks", swatch: "bg-[#3987e5]" },
  { key: "US_STOCK", label: "US Stocks", swatch: "bg-[#d95926]" },
  { key: "CRYPTO", label: "Crypto", swatch: "bg-[#199e70]" },
  { key: "MUTUAL_FUND", label: "Mutual Funds", swatch: "bg-[#c98500]" },
];

// Lines under the hero numbers saying which brokers the totals include,
// so a lapsed token (they expire daily) never silently shrinks the total.
const BROKER_PAGES: Record<BrokerId, string> = { kite: "/brokers#kite", angel: "/brokers#angel" };

function BrokersNote({ data }: { data: Pick<AllPositions, "brokers" | "mutualFunds" | "replacedManual"> }) {
  const included: string[] = [];
  const missing: { id: BrokerId; text: string }[] = [];
  for (const [id, status] of Object.entries(data.brokers) as [BrokerId, BrokerStatus][]) {
    const label = BROKER_LABELS[id];
    if (status.state === "connected") {
      const n = status.holdings.length;
      const funds = id === "kite" && data.mutualFunds.state === "ok" ? ` + ${data.mutualFunds.rows.length} mutual funds` : "";
      included.push(`${label}: ${n} stock${n === 1 ? "" : "s"}${funds}`);
    } else if (status.state === "disconnected") {
      missing.push({ id, text: `${label} not connected today${id === "kite" ? " (incl. mutual funds)" : ""}` });
    } else if (status.state === "error") {
      missing.push({ id, text: `${label} error: ${status.message}` });
    }
  }
  const replaced = data.replacedManual.map((r) => r.symbol);
  return (
    <div className="space-y-1 text-xs leading-relaxed">
      {included.length > 0 && (
        <p className="text-slate-400">
          <Link2 size={12} className="-mt-0.5 mr-1 inline" />
          Includes {included.join(" · ")}
          {replaced.length > 0 && <> · {replaced.join(", ")} counted once (broker figures used)</>}
        </p>
      )}
      {missing.map((m) => (
        <p key={m.id} className="text-amber-300">
          <Link2 size={12} className="-mt-0.5 mr-1 inline" />
          {m.text} - not in the total.{" "}
          <Link href={BROKER_PAGES[m.id]} className="underline hover:text-amber-200">
            Connect
          </Link>
        </p>
      ))}
    </div>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date())
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const holdings = await prisma.holding.findMany();
  const [all, indices, topMovers] = await Promise.all([
    loadAllPositions(holdings),
    getIndexSnapshots(),
    Promise.all(
      MARKETS.map(async (market) => {
        try {
          const quotes = await market.provider.getMovers("gainers", 5);
          return { ...market, quotes, error: null as string | null };
        } catch (err) {
          console.error(`Failed to fetch top movers for ${market.key}`, err);
          return { ...market, quotes: [], error: "Couldn't fetch live movers right now." };
        }
      })
    ),
  ]);

  const { positions } = all;
  // Everything in rupees: manual holdings via their InrView (USD ones at
  // buy-date / today's USD/INR) plus Kite stocks and mutual funds when
  // connected, de-duplicated - see lib/portfolio/combined.ts.
  const currency = "INR";
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  const invested = positions.reduce((sum, p) => sum + p.invested, 0);
  const totalPnl = totalValue - invested;
  const todaysPnl = positions.reduce((sum, p) => sum + p.dayPnl, 0);
  const prevValue = totalValue - todaysPnl;
  const todaysPct = prevValue > 0 ? (todaysPnl / prevValue) * 100 : 0;
  const totalPct = invested > 0 ? (totalPnl / invested) * 100 : 0;

  const allocation = ASSET_CLASSES.map((cls) => {
    const value = positions.filter((p) => p.assetClass === cls.key).reduce((sum, p) => sum + p.value, 0);
    return { ...cls, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 };
  }).filter((a) => a.value > 0);

  const hasHoldings = positions.length > 0 || holdings.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">
            {new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date())}
          </p>
          <h1 className="page-title mt-1">{greeting()}</h1>
        </div>
        <Link href="/portfolio" className="chip gap-1.5">
          <Plus size={14} /> Manage holdings
        </Link>
      </div>

      {/* Hero band - portfolio summary on an always-dark surface. */}
      {hasHoldings ? (
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-6 text-white shadow-lg ring-1 ring-white/5 sm:p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-teal-400/10 blur-3xl" />

          <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="text-sm text-slate-400">Portfolio value</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{formatMoney(totalValue, currency)}</div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <ChangeText pct={todaysPct} prefix={formatSigned(todaysPnl, currency)} onDark />
                <span className="text-slate-400">today</span>
              </div>

              <dl className="mt-6 grid max-w-md grid-cols-2 gap-4 border-t border-white/10 pt-5 text-sm">
                <div>
                  <dt className="text-slate-400">Invested</dt>
                  <dd className="mt-1 font-medium tabular-nums">{formatMoney(invested, currency)}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Total returns</dt>
                  <dd className="mt-1">
                    <ChangeText pct={totalPct} prefix={formatSigned(totalPnl, currency)} onDark />
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <BrokersNote data={all} />
              </div>
            </div>

            <div className="rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="text-sm text-slate-400">Allocation</div>
              <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={allocation.map((a) => `${a.label} ${a.pct.toFixed(0)}%`).join(", ")}>
                {allocation.map((a) => (
                  <div key={a.key} className={`${a.swatch} first:rounded-l-full last:rounded-r-full`} style={{ width: `${a.pct}%` }} title={`${a.label}: ${a.pct.toFixed(1)}%`} />
                ))}
              </div>
              <ul className="mt-4 space-y-2.5 text-sm">
                {allocation.map((a) => (
                  <li key={a.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-slate-300">
                      <span className={`h-2.5 w-2.5 rounded-sm ${a.swatch}`} />
                      {a.label}
                    </span>
                    <span className="tabular-nums text-slate-400">
                      {formatMoney(a.value, currency, { compact: true })}
                      <span className="ml-2 inline-block w-10 text-right font-medium text-white">{a.pct.toFixed(0)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <div className="card flex flex-col items-start gap-3 p-6 text-sm text-slate-600 dark:text-slate-300">
          <div className="card-title">Start tracking your portfolio</div>
          <p>Add a holding to see your total value, today&apos;s P&amp;L, and allocation here.</p>
          <Link href="/portfolio" className="chip chip-active gap-1.5">
            <Plus size={14} /> Add holding
          </Link>
        </div>
      )}

      {/* Market indices - Tickertape's "Market and sectors" strip. */}
      {indices.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Markets today</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {indices.slice(0, 6).map((idx) => (
              <div key={idx.symbol} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{idx.label}</div>
                </div>
                <div className="mt-1.5 text-lg font-semibold tabular-nums">{formatNumber(idx.quote.price, idx.quote.currency)}</div>
                <ChangeText pct={idx.quote.changePercent} className="text-xs" />
                <div className="mt-2">
                  <Sparkline values={idx.closes} width={140} height={36} label={idx.label} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Top gainers</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {topMovers.map((market) => (
            <div key={market.key} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h3 className="card-title">{market.key}</h3>
                <Link
                  href={market.href}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  View all <ArrowRight size={12} />
                </Link>
              </div>
              {market.error ? (
                <p className="px-4 py-6 text-sm text-loss">{market.error}</p>
              ) : (
                <MoversTable quotes={market.quotes} compact details="link" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
