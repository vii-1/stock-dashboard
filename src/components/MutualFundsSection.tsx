import Link from "next/link";
import type { MutualFundsResult } from "@/lib/kite/mutualFunds";
import SummaryTiles from "@/components/ui/SummaryTiles";
import KiteMfTable from "@/components/KiteMfTable";

// "Mutual funds & SIPs" block - summary tiles + fund table. Used on /kite
// and /portfolio. Renders nothing when Kite isn't set up at all, and a
// reconnect prompt (instead of silently vanishing) when today's token
// has lapsed.
export default function MutualFundsSection({ mf, showHeading = true }: { mf: MutualFundsResult; showHeading?: boolean }) {
  if (mf.state === "unconfigured") return null;

  return (
    <section className="space-y-3">
      <div className={showHeading ? undefined : "sr-only"}>
        <h2 className="text-lg font-semibold tracking-tight">Mutual funds &amp; SIPs</h2>
        <p className="page-subtitle !mt-0.5">From Zerodha Coin via Kite (read-only) - NAVs update once a day.</p>
      </div>

      {mf.state === "disconnected" && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-dashed p-5 text-sm text-slate-600 dark:text-slate-300">
          <span>Kite isn&apos;t connected today, so your mutual funds can&apos;t be loaded.</span>
          <Link href="/brokers#kite" className="chip chip-active">
            Connect Kite
          </Link>
        </div>
      )}

      {mf.state === "error" && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-300">
          Couldn&apos;t load mutual funds: {mf.error}
        </p>
      )}

      {mf.state === "ok" && (
        <>
          <SummaryTiles
            totals={{
              invested: mf.invested,
              current: mf.current,
              extra: { label: "Monthly SIP", value: mf.monthlySip, note: "Active SIPs, weekly/quarterly converted to a monthly amount" },
            }}
          />
          <KiteMfTable rows={mf.rows} orphanSips={mf.orphanSips} />
        </>
      )}
    </section>
  );
}
