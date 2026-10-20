import { prisma } from "@/lib/prisma";
import { providerForAssetClass } from "@/lib/portfolio/enrich";
import { baseSymbol, loadAllPositions } from "@/lib/portfolio/combined";
import { scoreBrokerHoldings, type ScoredBrokerHolding } from "@/lib/brokers";
import { BROKER_LABELS, type BrokerId } from "@/lib/brokers/types";
import BrokerHoldingsTable from "@/components/BrokerHoldingsTable";
import { scoreHolding } from "@/lib/suggestions/scoreHolding";
import AddHoldingForm from "@/components/AddHoldingForm";
import HoldingsTable, { type HoldingRow } from "@/components/HoldingsTable";
import { nativeCurrency } from "@/lib/fxConvert";
import MutualFundsSection from "@/components/MutualFundsSection";
import SummaryTiles, { type SummaryTotals } from "@/components/ui/SummaryTiles";
import Link from "next/link";

const HISTORY_DAYS = 120;

// Each tab is its own URL (/portfolio?view=crypto) so it can be
// bookmarked and the back button works like separate pages.
const VIEWS = [
  { key: "stocks", label: "Stocks", classes: ["IN_STOCK", "US_STOCK"], addAs: "IN_STOCK" },
  { key: "crypto", label: "Crypto", classes: ["CRYPTO"], addAs: "CRYPTO" },
  { key: "funds", label: "Mutual Funds", classes: [], addAs: null },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export default async function PortfolioPage({ searchParams }: { searchParams: { view?: string } }) {
  const view = VIEWS.find((v) => v.key === searchParams.view) ?? VIEWS[0];
  const holdings = await prisma.holding.findMany({ orderBy: { createdAt: "desc" } });
  // Manual holdings + every connected broker + Kite mutual funds, already
  // de-duplicated (a manual stock a broker also reports counts once) -
  // the same loader the dashboard uses, so both pages agree.
  const all = await loadAllPositions(holdings);
  const { enriched, brokers, mutualFunds: mf, positions } = all;
  const countedBy = new Map(all.replacedManual.map((r) => [r.symbol, BROKER_LABELS[r.by]]));

  // Weights in rupees (see InrView in enrich.ts) so INR and USD holdings
  // are actually comparable.
  const totalValue = enriched.reduce((sum, h) => sum + (h.inr?.marketValue ?? 0), 0);

  const rows: HoldingRow[] = await Promise.all(
    enriched.map(async (holding): Promise<HoldingRow> => {
      const inr = holding.inr;
      const portfolioWeightPct =
        inr?.marketValue != null && totalValue > 0 ? (inr.marketValue / totalValue) * 100 : 0;
      const native = nativeCurrency(holding.assetClass);

      let suggestion: HoldingRow["suggestion"] = null;
      let reasons: string[] = [];

      if (holding.quote) {
        try {
          const provider = providerForAssetClass(holding.assetClass);
          const history = await provider.getHistory(holding.symbol, HISTORY_DAYS);
          const result = scoreHolding({
            avgBuyPrice: holding.avgBuyPrice,
            currentPrice: holding.quote.price,
            history,
            portfolioWeightPct,
          });
          suggestion = result.suggestion;
          reasons = result.reasons;
        } catch (err) {
          console.error(`Failed to score ${holding.symbol}`, err);
        }
      }

      return {
        id: holding.id,
        assetClass: holding.assetClass,
        symbol: holding.symbol,
        displayName: holding.displayName,
        quantity: holding.quantity,
        buyDateIso: holding.buyDate.toISOString(),
        avgBuyPrice: inr?.avgBuyPrice ?? null,
        invested: inr?.invested ?? null,
        currentPrice: inr?.currentPrice ?? null,
        marketValue: inr?.marketValue ?? null,
        unrealizedPnl: inr?.unrealizedPnl ?? null,
        unrealizedPnlPct: inr?.unrealizedPnlPct ?? null,
        native:
          native === "INR"
            ? null
            : { currency: native, avgBuyPrice: holding.avgBuyPrice, currentPrice: holding.quote?.price ?? null },
        quoteError: inr ? holding.quoteError : "Couldn't fetch the USD/INR rate.",
        portfolioWeightPct: inr?.marketValue != null ? portfolioWeightPct : null,
        suggestion,
        reasons,
        countedBy: holding.assetClass === "IN_STOCK" ? countedBy.get(baseSymbol(holding.symbol)) ?? null : null,
      };
    })
  );

  // Per-tab totals in rupees. Only holdings with a live price count, so
  // invested and current value always cover the same set. Today's P&L
  // for USD holdings uses the asset's own day move (ignores USD/INR).
  function totalsFor(classes: readonly string[]): SummaryTotals & { count: number } {
    const inView = positions.filter((p) => classes.includes(p.assetClass));
    const current = inView.reduce((s, p) => s + p.value, 0);
    const day = inView.reduce((s, p) => s + p.dayPnl, 0);
    const prev = current - day;
    return {
      count: inView.length,
      invested: inView.reduce((s, p) => s + p.invested, 0),
      current,
      extra: { label: "Today's P&L", value: day, signed: true, pct: prev > 0 ? (day / prev) * 100 : null },
    };
  }
  const counts: Record<ViewKey, number> = {
    stocks: totalsFor(VIEWS[0].classes).count,
    crypto: totalsFor(VIEWS[1].classes).count,
    funds: mf.state === "ok" ? mf.rows.length : 0,
  };
  const viewRows = rows.filter((r) => (view.classes as readonly string[]).includes(r.assetClass));

  // Broker accounts (Stocks tab only), scored for suggestion badges.
  const brokerSections =
    view.key === "stocks"
      ? await Promise.all(
          (Object.keys(brokers) as BrokerId[]).map(async (id) => {
            const status = brokers[id];
            const scored: ScoredBrokerHolding[] = status.state === "connected" ? await scoreBrokerHoldings(status.holdings) : [];
            return { id, status, holdings: scored };
          })
        )
      : [];
  const BROKER_PAGES: Record<BrokerId, string> = { kite: "/brokers#kite", angel: "/brokers#angel" };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="page-title">Portfolio</h1>
        {view.addAs && <AddHoldingForm key={view.key} defaultAssetClass={view.addAs} />}
      </div>

      <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800" aria-label="Portfolio sections">
        {VIEWS.map((v) => {
          const active = v.key === view.key;
          return (
            <Link
              key={v.key}
              href={v.key === "stocks" ? "/portfolio" : `/portfolio?view=${v.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300"
                  : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {v.label}
              <span
                className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${
                  active ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                {counts[v.key]}
              </span>
            </Link>
          );
        })}
      </nav>

      {view.key === "funds" ? (
        <MutualFundsSection mf={mf} showHeading={false} />
      ) : (
        <section className="space-y-4">
          <SummaryTiles totals={totalsFor(view.classes)} />

          {brokerSections.map(({ id, status, holdings: bh }) =>
            status.state === "unconfigured" ? null : (
              <div key={id} className="space-y-2">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  {BROKER_LABELS[id]}
                  {status.state === "connected" && (
                    <span className="rounded-full bg-green-100 px-2 py-px text-[11px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                      Live
                    </span>
                  )}
                </h2>
                {status.state === "connected" ? (
                  <BrokerHoldingsTable holdings={bh} emptyText={`No stocks in your ${BROKER_LABELS[id]} account.`} />
                ) : (
                  <div className="card flex flex-wrap items-center justify-between gap-3 border-dashed p-4 text-sm text-slate-600 dark:text-slate-300">
                    <span>
                      {status.state === "error"
                        ? `Couldn't load ${BROKER_LABELS[id]}: ${status.message}`
                        : `${BROKER_LABELS[id]} isn't connected today, so its holdings aren't shown or counted.`}
                    </span>
                    <Link href={BROKER_PAGES[id]} className="chip chip-active">
                      Connect
                    </Link>
                  </div>
                )}
              </div>
            )
          )}

          <div className="space-y-2">
            {view.key === "stocks" && <h2 className="text-base font-semibold">Added manually</h2>}
            <HoldingsTable rows={viewRows} emptyText={`No ${view.label.toLowerCase()} added manually - use the button above.`} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live prices and suggestions refresh on page load. All amounts are in rupees
            {view.key === "crypto" || viewRows.some((r) => r.native)
              ? ": dollar-priced holdings convert at the USD/INR rate on their buy date (cost) and today's rate (value), with the dollar price underneath."
              : "."}{" "}
            Weight is each holding's share of your manually added stocks and crypto.
            {all.replacedManual.length > 0 &&
              " Manual entries tagged with a broker are already counted from that broker, so totals include them once."}
          </p>
        </section>
      )}
    </div>
  );
}
