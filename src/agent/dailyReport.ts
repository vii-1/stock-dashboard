// Usage: npm run agent:report [-- 2026-10-23]
//
// Post-market report for one NSE session (default: today, IST). Run by
// the "StockDashboardPaperReport" scheduled task at 15:45 and written
// to reports/paper-YYYY-MM-DD.md - the starting point for the daily
// review: what each paper agent did, what it earned against simple
// benchmarks, and automatic flags for behaviour worth questioning.
// Read-only: never touches accounts, positions or agent state.
//
// Benchmarks are the honest bar to clear, not other traders (whose
// trades aren't public):
//   - NIFTY 50 open->close (what an index long did today)
//   - watchlist equal-weight open->close (buy all 30 at the open)
//   - NIFTY high-low range (what was on the table intraday - a ceiling,
//     not a target)
// The gap from the previous close is shown separately: it happens
// before 09:15, so no intraday strategy can capture it.

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getIntradayBars, NIFTY_WATCHLIST, type IntradayBar } from "@/lib/providers/yahooProvider";
import { INTRADAY_COST_PCT, TRANSACTION_COST_PCT } from "./broker/paperBroker";
import { istClock, INTRADAY_PARAMS } from "./strategy/intradayStrategy";
import { nseHoliday } from "./riskManager";

const NIFTY_INDEX = "^NSEI";
const STARTING_VALUE = 100_000;

interface Fill {
  side: string;
  symbol: string;
  quantity: number;
  price: number;
  time: number; // epoch seconds
}

interface RoundTrip {
  symbol: string;
  direction: "LONG" | "SHORT";
  quantity: number;
  entry: Fill;
  exit: Fill | null; // null = still open
  pnl: number | null; // net of both fees
  entryReason: string;
  exitReason: string;
  niftyAtEntryPct: number | null; // NIFTY % from open at entry time
}

const hhmm = (epoch: number) => {
  const { minute } = istClock(epoch);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};
const pct = (x: number | null, digits = 2) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`);
const inr = (x: number | null) => (x == null ? "n/a" : `${x >= 0 ? "+" : "−"}₹${Math.abs(x).toFixed(2)}`);

function todayIst(): string {
  return istClock(Date.now() / 1000).day;
}

/** Session bars for `day` only, oldest first. */
function sessionBars(bars: IntradayBar[], day: string): IntradayBar[] {
  return bars.filter((b) => istClock(b.time).day === day);
}

function openToClosePct(bars: IntradayBar[]): number | null {
  if (bars.length === 0) return null;
  return ((bars[bars.length - 1].close - bars[0].open) / bars[0].open) * 100;
}

/** Reason text the agent logged for this fill (DecisionLog, within 10s). */
async function reasonFor(symbol: string, suggestion: string, at: Date): Promise<string> {
  const row = await prisma.decisionLog.findFirst({
    where: {
      symbol,
      suggestion,
      createdAt: { gte: new Date(at.getTime() - 10_000), lte: new Date(at.getTime() + 10_000) },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!row) return "";
  try {
    return (JSON.parse(row.reasons) as string[]).join(" ");
  } catch {
    return row.reasons;
  }
}

async function fillsFor(mode: string, day: string) {
  // Generous UTC window, then exact IST-day filter.
  const [y, m, d] = day.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - 6 * 3600_000);
  const to = new Date(Date.UTC(y, m - 1, d) + 30 * 3600_000);
  const orders = await prisma.order.findMany({
    where: { mode, createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: "asc" },
  });
  return orders.filter((o) => istClock(o.createdAt.getTime() / 1000).day === day);
}

function niftyPctAt(index: IntradayBar[], epoch: number): number | null {
  if (index.length === 0) return null;
  const upTo = index.filter((b) => b.time + 300 <= epoch + 1);
  if (upTo.length === 0) return null;
  return ((upTo[upTo.length - 1].close - index[0].open) / index[0].open) * 100;
}

async function intradayTrips(day: string, index: IntradayBar[]) {
  const orders = await fillsFor("PAPER_INTRADAY", day);
  const filled = orders.filter((o) => o.status === "FILLED");
  const rejected = orders.filter((o) => o.status === "REJECTED");
  const fee = INTRADAY_COST_PCT / 100;

  const open = new Map<string, RoundTrip>();
  const trips: RoundTrip[] = [];
  for (const o of filled) {
    const fill: Fill = { side: o.side, symbol: o.symbol, quantity: o.quantity, price: o.price, time: o.createdAt.getTime() / 1000 };
    if (o.side === "BUY" || o.side === "SHORT") {
      const trip: RoundTrip = {
        symbol: o.symbol,
        direction: o.side === "SHORT" ? "SHORT" : "LONG",
        quantity: o.quantity,
        entry: fill,
        exit: null,
        pnl: null,
        entryReason: await reasonFor(o.symbol, `INTRADAY_${o.side}`, o.createdAt),
        exitReason: "",
        niftyAtEntryPct: niftyPctAt(index, fill.time),
      };
      open.set(o.symbol, trip);
      trips.push(trip);
    } else {
      const trip = open.get(o.symbol);
      if (!trip) continue; // exit of a position opened on an earlier day
      trip.exit = fill;
      // Selling leg minus buying leg, each with its fee - same for both directions.
      const [sellPx, buyPx] = trip.direction === "LONG" ? [fill.price, trip.entry.price] : [trip.entry.price, fill.price];
      trip.pnl = trip.quantity * (sellPx * (1 - fee) - buyPx * (1 + fee));
      trip.exitReason = await reasonFor(o.symbol, `INTRADAY_${o.side}`, o.createdAt);
      open.delete(o.symbol);
    }
  }
  return { trips, rejected };
}

function exitBucket(reason: string): string {
  if (/^Stop-loss/.test(reason)) return "stop-loss";
  if (/^Target/.test(reason)) return "target";
  if (/^Square-off/.test(reason)) return "15:15 square-off";
  if (/^EMA/.test(reason)) return "trend reversal";
  return reason ? "other" : "still open";
}

/** Read today's section of the runner log: passes, gaps, data errors. */
function logHealth(file: string, day: string) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const start = text.lastIndexOf(`session started ${day}`);
  if (start < 0) return null;
  const section = text.slice(start);
  const passes = [...section.matchAll(/^--- (\d\d):(\d\d):\d\d ---$/gm)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  const gaps: string[] = [];
  for (let i = 1; i < passes.length; i++) {
    if (passes[i] - passes[i - 1] > 7) {
      const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      gaps.push(`${f(passes[i - 1])}→${f(passes[i])}`);
    }
  }
  const count = (re: RegExp) => (section.match(re) ?? []).length;
  return {
    passes: passes.length,
    gaps,
    fetchFailed: count(/failed to fetch/g),
    stale: count(/stale or missing/g),
    crashes: count(/^(Error|TypeError|PrismaClient\w*Error)/gm),
    capSkips: count(/already at \d+ open positions/g),
    blocked: count(/BLOCKED/g),
    noCash: count(/not enough cash/g),
    marketFiltered: count(/market is (weak|not weak)/g),
  };
}

function flags(trips: RoundTrip[], niftyDayPct: number | null, health: ReturnType<typeof logHealth>): string[] {
  const out: string[] = [];
  const closed = trips.filter((t) => t.pnl != null);

  // 1. Fighting the index: long while NIFTY was red at entry (or short while green).
  const against = trips.filter(
    (t) => t.niftyAtEntryPct != null && (t.direction === "LONG" ? t.niftyAtEntryPct < 0 : t.niftyAtEntryPct > 0)
  );
  if (against.length) {
    out.push(
      `**Traded against the index ${against.length}×** - ${against.map((t) => `${t.direction} ${t.symbol.replace(".NS", "")} @${hhmm(t.entry.time)} (NIFTY ${pct(t.niftyAtEntryPct)})`).join(", ")}. The market filter should prevent this; if it's on, check why it let these through.`
    );
  }

  // 2. Churn: closed within 10 minutes of opening.
  const churn = closed.filter((t) => t.exit && t.exit.time - t.entry.time <= 10 * 60);
  if (churn.length) {
    out.push(
      `**${churn.length} trade(s) closed within 10 min** (${churn.map((t) => `${t.symbol.replace(".NS", "")} ${inr(t.pnl)}`).join(", ")}) - entry and exit signals disagreeing almost immediately = noise entries or a hair-trigger exit.`
    );
  }

  // 3. Clustered entries: 3+ entries inside 15 minutes = one correlated bet.
  const entries = [...trips].sort((a, b) => a.entry.time - b.entry.time);
  for (let i = 0; i + 2 < entries.length; i++) {
    if (entries[i + 2].entry.time - entries[i].entry.time <= 15 * 60) {
      out.push(`**Clustered entries** from ${hhmm(entries[i].entry.time)}: 3+ positions opened within 15 min - these move together, so it's one big bet, not three.`);
      break;
    }
  }

  // 4. Re-entering a symbol that just lost.
  const seen = new Map<string, RoundTrip>();
  for (const t of entries) {
    const prev = seen.get(t.symbol);
    if (prev && prev.pnl != null && prev.pnl < 0 && prev.exit && t.entry.time - prev.exit.time <= 30 * 60) {
      out.push(`**Revenge re-entry**: ${t.symbol.replace(".NS", "")} re-opened ${Math.round((t.entry.time - prev.exit.time) / 60)} min after a ${inr(prev.pnl)} loss.`);
    }
    seen.set(t.symbol, t);
  }

  // 5. Losers vs winners shape.
  const wins = closed.filter((t) => t.pnl! > 0);
  const losses = closed.filter((t) => t.pnl! <= 0);
  if (wins.length && losses.length) {
    const avgW = wins.reduce((s, t) => s + t.pnl!, 0) / wins.length;
    const avgL = -losses.reduce((s, t) => s + t.pnl!, 0) / losses.length;
    if (avgW < avgL) out.push(`**Average win (₹${avgW.toFixed(0)}) is smaller than average loss (₹${avgL.toFixed(0)})** - winners cut early or losers left to run; the 2:1 target isn't being reached.`);
  }

  // 6. Fees eating the edge.
  const fees = closed.reduce((s, t) => s + t.quantity * (t.entry.price + t.exit!.price) * (INTRADAY_COST_PCT / 100), 0);
  const gross = closed.reduce((s, t) => s + t.pnl!, 0) + fees;
  if (closed.length && fees > Math.abs(gross)) out.push(`**Fees (₹${fees.toFixed(0)}) exceeded the gross result (${inr(gross)})** - trading too often for the size of the moves it catches.`);

  // 7. Sat out a trending day.
  if (trips.length === 0 && niftyDayPct != null && Math.abs(niftyDayPct) >= 0.7) {
    out.push(`**No trades on a ${pct(niftyDayPct)} NIFTY day** - filters may be too strict to catch a real trend.`);
  }

  // 8. Left open after square-off.
  const stillOpen = trips.filter((t) => !t.exit);
  if (stillOpen.length) out.push(`**${stillOpen.length} intraday position(s) still open** after the session (${stillOpen.map((t) => t.symbol).join(", ")}) - square-off didn't run; check the log for missed passes.`);

  // 9. Plumbing.
  if (health) {
    if (health.gaps.length) out.push(`**Missed passes**: gaps ${health.gaps.join(", ")} - PC asleep, task skipped or a pass ran >5 min.`);
    if (health.fetchFailed) out.push(`**${health.fetchFailed} bar fetches failed** - network/Yahoo trouble; those passes acted on partial data.`);
    if (health.crashes) out.push(`**${health.crashes} crash line(s)** in the log - read them.`);
  }
  return out;
}

async function main() {
  const day = process.argv[2] ?? todayIst();
  const [y, m, d] = day.split("-").map(Number);
  const noonIst = new Date(Date.UTC(y, m - 1, d, 6, 30));
  const weekday = noonIst.getUTCDay();
  const holiday = nseHoliday(noonIst);
  if (weekday === 0 || weekday === 6 || holiday) {
    console.log(`${day}: NSE closed (${holiday ?? "weekend"}) - no report.`);
    return;
  }

  // --- Market context ---
  const indexAll = await getIntradayBars(NIFTY_INDEX, "5d").catch(() => [] as IntradayBar[]);
  const index = sessionBars(indexAll, day);
  const niftyDay = openToClosePct(index);
  const prevClose = indexAll.filter((b) => istClock(b.time).day < day).at(-1)?.close ?? null;
  const niftyGap = prevClose && index.length ? ((index[0].open - prevClose) / prevClose) * 100 : null;
  const niftyVsPrev = prevClose && index.length ? ((index[index.length - 1].close - prevClose) / prevClose) * 100 : null;
  const niftyHigh = index.length ? Math.max(...index.map((b) => b.high)) : null;
  const niftyLow = index.length ? Math.min(...index.map((b) => b.low)) : null;
  const moves: { symbol: string; pct: number }[] = [];
  await Promise.all(
    NIFTY_WATCHLIST.map(async (s) => {
      const p = openToClosePct(sessionBars(await getIntradayBars(s, "5d").catch(() => []), day));
      if (p != null) moves.push({ symbol: s.replace(".NS", ""), pct: p });
    })
  );
  moves.sort((a, b) => b.pct - a.pct);
  const ewPct = moves.length ? moves.reduce((s, x) => s + x.pct, 0) / moves.length : null;
  const breadthUp = moves.filter((x) => x.pct > 0).length;

  // --- Intraday agent ---
  const { trips, rejected } = await intradayTrips(day, index);
  const closed = trips.filter((t) => t.pnl != null);
  const realized = closed.reduce((s, t) => s + t.pnl!, 0);
  const intradayAcct = await prisma.paperAccount.findUnique({ where: { mode: "PAPER_INTRADAY" } });
  const startValue = intradayAcct ? intradayAcct.cash - realized : null; // valid when flat at close
  const dayPct = startValue ? (realized / startValue) * 100 : null;
  const health = logHealth("agent-intraday.log", day);

  // --- Daily agent ---
  const dailyOrders = (await fillsFor("PAPER", day)).filter((o) => o.status === "FILLED");
  const dailyAcct = await prisma.paperAccount.findUnique({ where: { mode: "PAPER" } });
  const dailyPositions = await prisma.paperPosition.findMany({ where: { mode: "PAPER" } });
  let dailyValue = dailyAcct?.cash ?? 0;
  const dailyLines: string[] = [];
  for (const p of dailyPositions) {
    const last = (await getIntradayBars(p.symbol, "5d").catch(() => [])).at(-1)?.close ?? p.avgBuyPrice;
    dailyValue += p.quantity * last;
    dailyLines.push(`| ${p.symbol.replace(".NS", "")} | ${p.quantity} | ${p.avgBuyPrice.toFixed(2)} | ${last.toFixed(2)} | ${pct(((last - p.avgBuyPrice) / p.avgBuyPrice) * 100)} |`);
  }

  // --- Markdown ---
  const L: string[] = [];
  L.push(`# Paper trading report: ${day}`, "");
  L.push(`_Auto-generated after the close by \`npm run agent:report\`. Paper money only._`, "");
  L.push("## Market");
  const rangePct = niftyHigh && niftyLow && index.length ? ((niftyHigh - niftyLow) / index[0].open) * 100 : null;
  const dayType =
    niftyDay == null || rangePct == null
      ? ""
      : Math.abs(niftyDay) >= 0.6 && Math.abs(niftyDay) >= rangePct * 0.6
        ? ` - **trend day (${niftyDay > 0 ? "up" : "down"})**`
        : Math.abs(niftyDay) < 0.25
          ? " - **range-bound / choppy day** (hard for trend-following entries)"
          : " - mixed day";
  L.push(`- **NIFTY 50:** ${pct(niftyVsPrev)} vs previous close = gap ${pct(niftyGap)} at the open + ${pct(niftyDay)} during the session${dayType}`);
  L.push(`- **Intraday range:** ${niftyLow?.toFixed(0) ?? "?"}–${niftyHigh?.toFixed(0) ?? "?"} (${pct(rangePct)} of the open)`);
  L.push(`- **Watchlist (30):** ${breadthUp} up / ${moves.length - breadthUp} down, equal-weight ${pct(ewPct)}`);
  if (moves.length) {
    L.push(`- **Best:** ${moves.slice(0, 3).map((x) => `${x.symbol} ${pct(x.pct, 1)}`).join(", ")}  **Worst:** ${moves.slice(-3).reverse().map((x) => `${x.symbol} ${pct(x.pct, 1)}`).join(", ")}`);
  }
  L.push("");

  L.push("## Scorecard vs benchmarks (intraday agent)");
  L.push("| | Today |", "|---|---|");
  L.push(`| **Intraday bot** | **${pct(dayPct)}** (${inr(realized)}) |`);
  L.push(`| NIFTY long (open→close) | ${pct(niftyDay)} |`);
  L.push(`| Buy all 30 at open | ${pct(ewPct)} |`);
  L.push(`| NIFTY high-low range (ceiling, not a target) | ${pct(rangePct)} |`);
  L.push(`| Did nothing | +0.00% |`);
  L.push("");
  const verdict =
    dayPct == null || niftyDay == null
      ? "Not enough data for a verdict."
      : dayPct > Math.max(0, niftyDay)
        ? "Beat both the index and sitting in cash."
        : dayPct > 0
          ? "Made money but trailed the index."
          : dayPct > niftyDay
            ? "Lost less than the index, but sitting in cash would have been better."
            : "Lost money and trailed the index.";
  L.push(`**Verdict:** ${verdict}`, "");

  L.push(`## Intraday trades (${closed.length} closed${trips.length > closed.length ? `, ${trips.length - closed.length} open` : ""})`);
  if (trips.length === 0) {
    L.push("No trades.");
  } else {
    const wins = closed.filter((t) => t.pnl! > 0).length;
    L.push(`Win rate ${closed.length ? ((wins / closed.length) * 100).toFixed(0) : 0}% · longs ${trips.filter((t) => t.direction === "LONG").length} · shorts ${trips.filter((t) => t.direction === "SHORT").length} · rejected orders ${rejected.length}`, "");
    L.push("| In | Out | Stock | Side | Qty | Entry | Exit | P&L | Held | NIFTY at entry | Exit reason |");
    L.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const t of trips) {
      L.push(
        `| ${hhmm(t.entry.time)} | ${t.exit ? hhmm(t.exit.time) : "—"} | ${t.symbol.replace(".NS", "")} | ${t.direction} | ${t.quantity} | ${t.entry.price.toFixed(2)} | ${t.exit?.price.toFixed(2) ?? "—"} | ${inr(t.pnl)} | ${t.exit ? Math.round((t.exit.time - t.entry.time) / 60) + "m" : "—"} | ${pct(t.niftyAtEntryPct)} | ${exitBucket(t.exitReason)} |`
      );
    }
    L.push("");
    const buckets = new Map<string, { n: number; pnl: number }>();
    for (const t of closed) {
      const b = buckets.get(exitBucket(t.exitReason)) ?? { n: 0, pnl: 0 };
      b.n++;
      b.pnl += t.pnl!;
      buckets.set(exitBucket(t.exitReason), b);
    }
    L.push("**By exit reason:** " + [...buckets].map(([k, v]) => `${k} ${v.n} (${inr(v.pnl)})`).join(" · "), "");
  }

  L.push("## Behaviour flags");
  const f = flags(trips, niftyDay, health);
  L.push(...(f.length ? f.map((x) => `- ${x}`) : ["- None raised automatically - still read the trades above."]), "");

  if (health) {
    L.push("## Plumbing");
    L.push(
      `${health.passes} passes · gaps: ${health.gaps.length ? health.gaps.join(", ") : "none"} · failed fetches ${health.fetchFailed} · stale bars ${health.stale} · ` +
        `entries skipped: position cap ${health.capSkips}, risk blocks ${health.blocked}, no cash ${health.noCash}, market filter ${health.marketFiltered}`,
      ""
    );
  }

  L.push("## Daily (swing) agent");
  L.push(dailyOrders.length ? dailyOrders.map((o) => `- ${hhmm(o.createdAt.getTime() / 1000)} ${o.side} ${o.quantity} ${o.symbol} @ ${o.price.toFixed(2)}`).join("\n") : "- No trades today.");
  if (dailyLines.length) {
    L.push("", "| Holding | Qty | Avg (incl. fee) | Last | P&L |", "|---|---|---|---|---|", ...dailyLines);
  }
  L.push("", `Account value ₹${dailyValue.toFixed(2)} (${pct(((dailyValue - STARTING_VALUE) / STARTING_VALUE) * 100)} since start, fee ${TRANSACTION_COST_PCT}%/side).`, "");

  L.push("## Settings in force");
  const p = INTRADAY_PARAMS;
  L.push(
    `EMA ${p.fastEma}/${p.slowEma}, RSI ${p.rsiMin}-${p.rsiMax}, stop ${p.stopLossPct}% / target ${p.targetPct}%, market filter ${p.marketFilter ? "on" : "off"}, reversal confirm ${p.reversalConfirmBars} bar(s), min EMA gap ${p.minEmaGapPct}%, max ${p.maxOpenPositions} positions, shorts ${p.allowShorts ? "on" : "off"}.`
  );

  const md = L.join("\n") + "\n";
  fs.mkdirSync("reports", { recursive: true });
  const file = path.join("reports", `paper-${day}.md`);
  fs.writeFileSync(file, md, "utf8");
  console.log(md);
  console.log(`Written to ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
