import Link from "next/link";
import { CheckCircle2, CircleDashed, Plus, AlertTriangle } from "lucide-react";
import { loadAllBrokers } from "@/lib/brokers";
import { getAngelSession, isAngelConfigured } from "@/lib/brokers/angel";
import { totalQuantity, type BrokerId, type BrokerStatus } from "@/lib/brokers/types";
import { getMargins } from "@/lib/kite/client";
import { getValidKiteSession } from "@/lib/kite/session";
import { loadMutualFunds } from "@/lib/kite/mutualFunds";
import { formatMoney, formatSigned } from "@/lib/format";
import AngelLoginForm from "@/components/brokers/AngelLoginForm";
import BrokerLogoutButton from "@/components/brokers/BrokerLogoutButton";

export const dynamic = "force-dynamic";

const code = "rounded bg-slate-200 px-1 font-mono text-[0.85em] dark:bg-slate-800";

// The broker registry for this page. Adding a broker = an adapter in
// src/lib/brokers (producing BrokerHolding) + an entry here describing
// how to connect it. Holdings themselves show on Portfolio / Dashboard.
const BROKERS: {
  id: BrokerId;
  name: string;
  product: string;
  initials: string;
  tint: string;
  logoutEndpoint: string;
  validity: string;
  setup: React.ReactNode;
}[] = [
  {
    id: "kite",
    name: "Zerodha",
    product: "Kite Connect · stocks, ETFs and Coin mutual funds",
    initials: "Z",
    tint: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    logoutEndpoint: "/api/kite/logout",
    validity: "valid for today only",
    setup: (
      <>
        Create a Connect app at <code className={code}>developers.kite.trade</code> with redirect URL{" "}
        <code className={code}>http://localhost:3000/api/kite/callback</code>, then add <code className={code}>KITE_API_KEY</code> and{" "}
        <code className={code}>KITE_API_SECRET</code> to <code className={code}>.env</code> and restart the dev server.
      </>
    ),
  },
  {
    id: "angel",
    name: "Angel One",
    product: "SmartAPI · stocks and ETFs",
    initials: "A1",
    tint: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    logoutEndpoint: "/api/brokers/angel/logout",
    validity: "valid until 5 AM tomorrow",
    setup: (
      <>
        Create an app at <code className={code}>smartapi.angelone.in</code> (type <b>Trading APIs</b>, redirect URL{" "}
        <code className={code}>http://localhost:3000/brokers</code>), add its key to <code className={code}>.env</code> as{" "}
        <code className={code}>ANGEL_API_KEY</code> and restart the dev server. Then enable TOTP at{" "}
        <code className={code}>smartapi.angelone.in/enable-totp</code> - those 6-digit codes are what you log in with each day.
      </>
    ),
  },
];

function StatusPill({ status }: { status: BrokerStatus }) {
  const map = {
    connected: { icon: CheckCircle2, text: "Connected", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    disconnected: { icon: CircleDashed, text: "Not connected today", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
    unconfigured: { icon: CircleDashed, text: "Not set up", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
    error: { icon: AlertTriangle, text: "Error", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  }[status.state];
  const Icon = map.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${map.cls}`}>
      <Icon size={12} /> {map.text}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/40">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

const tone = (x: number) => (x >= 0 ? "text-gain dark:text-gain-dark" : "text-loss");

// Read-only connections hub. No orders are placed through anything here.
export default async function BrokersPage({
  searchParams,
}: {
  searchParams: { connected?: string; broker?: string; error?: string };
}) {
  const [statuses, kiteSession, angelSession] = await Promise.all([
    loadAllBrokers(),
    getValidKiteSession(),
    isAngelConfigured() ? getAngelSession() : Promise.resolve(null),
  ]);
  // Kite-only extras: Coin funds + cash balance (optional - failures just hide them).
  const kiteConnected = statuses.kite.state === "connected";
  const [mf, margins] = kiteConnected
    ? await Promise.all([loadMutualFunds(), getMargins().catch(() => null)])
    : [null, null];

  const sessions: Record<BrokerId, { since: Date; name: string } | null> = {
    kite: kiteSession ? { since: kiteSession.fetchedAt, name: kiteSession.kiteUserId } : null,
    angel: angelSession ? { since: angelSession.fetchedAt, name: angelSession.userName ? `${angelSession.userName} (${angelSession.userId})` : angelSession.userId } : null,
  };

  const connectedCount = Object.values(statuses).filter((s) => s.state === "connected").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">Broker Connect</h1>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          Read-only - no orders placed
        </span>
      </div>
      <p className="page-subtitle !mt-0">
        Connect your broker accounts to pull holdings into Portfolio and the Dashboard automatically. Broker logins expire
        daily, so reconnect each day you want fresh data. {connectedCount} of {BROKERS.length} connected.
      </p>

      {searchParams.connected && (
        <p className="rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800 dark:bg-green-900/40 dark:text-green-300">Connected successfully.</p>
      )}
      {searchParams.error && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-300">
          {searchParams.error === "login_failed" ? "Login failed or was cancelled." : searchParams.error}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {BROKERS.map((b) => {
          const status = statuses[b.id];
          const session = sessions[b.id];
          const holdings = status.state === "connected" ? status.holdings : [];
          const invested = holdings.reduce((s, h) => s + h.averagePrice * totalQuantity(h), 0);
          const current = holdings.reduce((s, h) => s + h.lastPrice * totalQuantity(h), 0);
          const day = holdings.reduce((s, h) => s + (h.lastPrice - h.closePrice) * totalQuantity(h), 0);

          return (
            <section key={b.id} id={b.id} className="card scroll-mt-6 space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${b.tint}`}>{b.initials}</span>
                  <div>
                    <h2 className="font-semibold text-slate-900 dark:text-white">{b.name}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{b.product}</p>
                  </div>
                </div>
                <StatusPill status={status} />
              </div>

              {status.state === "unconfigured" && (
                <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  {b.setup}
                </p>
              )}

              {status.state === "error" && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{status.message}</p>
              )}

              {status.state === "connected" && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label={`Stocks (${holdings.length})`} value={formatMoney(current, "INR")} />
                    <Stat label="Total P&L" value={formatSigned(current - invested, "INR")} tone={tone(current - invested)} />
                    <Stat label="Today" value={formatSigned(day, "INR")} tone={tone(day)} />
                    {b.id === "kite" && mf?.state === "ok" ? (
                      <Stat label={`Mutual funds (${mf.rows.length})`} value={formatMoney(mf.current, "INR")} />
                    ) : (
                      <Stat label="Invested" value={formatMoney(invested, "INR")} />
                    )}
                  </div>
                  {b.id === "kite" && margins && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Equity cash available: <span className="font-medium tabular-nums">{formatMoney(margins.equity.net, "INR")}</span>
                    </p>
                  )}
                </>
              )}

              {/* Connect / reconnect / logout - per broker login style */}
              {status.state !== "unconfigured" && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                  {session && status.state === "connected" ? (
                    <>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Connected as <span className="font-medium text-slate-700 dark:text-slate-200">{session.name}</span> since{" "}
                        {session.since.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {b.validity}
                      </div>
                      <div className="flex gap-2">
                        {b.id === "kite" && (
                          <a href="/api/kite/login" className="chip">
                            Re-connect
                          </a>
                        )}
                        <BrokerLogoutButton endpoint={b.logoutEndpoint} />
                      </div>
                    </>
                  ) : b.id === "kite" ? (
                    <a href="/api/kite/login" className="chip chip-active">
                      Connect Zerodha
                    </a>
                  ) : (
                    <div className="w-full">
                      <AngelLoginForm />
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        <section className="card flex flex-col justify-center gap-2 border-dashed p-5 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <Plus size={16} /> More brokers
          </div>
          <p>
            Upstox, Groww, Dhan and Fyers also offer personal APIs with holdings. Each one is a small adapter in{" "}
            <code className={code}>src/lib/brokers</code> plus a card here - and needs its own API key from that broker.
          </p>
        </section>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Holdings from connected brokers appear on <Link href="/portfolio" className="underline">Portfolio</Link> (Stocks and
        Mutual Funds tabs) and in the Dashboard total.
      </p>
    </div>
  );
}
