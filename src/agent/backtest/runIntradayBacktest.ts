// Usage: npm run agent:backtest-intraday [-- SYMBOL.NS ...]
//
// Replays intradayStrategy over Yahoo's last ~60 days of 5-minute bars
// as ONE portfolio across the whole watchlist (default: NIFTY_WATCHLIST)
// - shared cash, the same risk caps and cost model as the live intraday
// paper agent - rather than per-symbol runs that would each pretend to
// have the full ₹1,00,000. No DB writes.
//
// Fills are at the 5-minute bar CLOSE, including stop-losses - that's
// what the live runner can actually do (it checks once per closed bar),
// so stops here can fill worse than -1%, same as they will live.
//
// Also prints a walk-forward table: each strategy variant on the first
// two-thirds of sessions (where you'd choose between them) and on the
// last third (held out - the honest estimate). Pick on in-sample, judge
// on out-of-sample; a variant that only wins in-sample is overfit.

import { getIntradayBars, NIFTY_WATCHLIST, type IntradayBar } from "@/lib/providers/yahooProvider";
import { INTRADAY_PARAMS, intradaySignal, istClock, type IntradayParams } from "../strategy/intradayStrategy";
import { INTRADAY_COST_PCT } from "../broker/paperBroker";
import { positionValue, type PositionSide } from "../broker/types";
import { checkTrade, freshRiskState, INTRADAY_RISK_LIMITS, recordTrade, type RiskState } from "../riskManager";

const STARTING_CASH = 100_000;
// EMA(21)/RSI(14) only need a few dozen bars; capping the window keeps
// the replay fast without changing any signal.
const WINDOW_BARS = 200;
const IN_SAMPLE_FRACTION = 2 / 3;

// The 2026-10-22 filters (see INTRADAY_PARAMS), alone and combined.
// BASE is the pre-10-22 strategy, so the table stays comparable no
// matter what INTRADAY_PARAMS is currently set to.
const BASE: IntradayParams = { ...INTRADAY_PARAMS, marketFilter: false, reversalConfirmBars: 1, minEmaGapPct: 0, maxOpenPositions: 30, allowShorts: false };
const ALL_FOUR: IntradayParams = { ...BASE, marketFilter: true, reversalConfirmBars: 2, minEmaGapPct: 0.03, maxOpenPositions: 5 };
const VARIANTS: { name: string; params: IntradayParams }[] = [
  { name: "baseline (pre 10-22)", params: BASE },
  { name: "no reversal exit", params: { ...BASE, exitOnTrendReversal: false } },
  { name: "+ market filter", params: { ...BASE, marketFilter: true } },
  { name: "+ 2-bar reversal confirm", params: { ...BASE, reversalConfirmBars: 2 } },
  { name: "+ min EMA gap 0.03%", params: { ...BASE, minEmaGapPct: 0.03 } },
  { name: "+ max 5 positions", params: { ...BASE, maxOpenPositions: 5 } },
  { name: "market + 2-bar", params: { ...BASE, marketFilter: true, reversalConfirmBars: 2 } },
  { name: "market + 2-bar + max 5", params: { ...BASE, marketFilter: true, reversalConfirmBars: 2, maxOpenPositions: 5 } },
  { name: "all four (long only)", params: ALL_FOUR },
  { name: "all four + shorts", params: { ...ALL_FOUR, allowShorts: true } },
  { name: "baseline + shorts", params: { ...BASE, allowShorts: true } },
  { name: "current INTRADAY_PARAMS", params: INTRADAY_PARAMS },
];

const NIFTY_INDEX = "^NSEI";

interface OpenPosition {
  quantity: number;
  // Same convention as paperBroker: LONG cost/share incl. fee, SHORT
  // proceeds/share net of fee.
  avgBuyPrice: number;
  side: PositionSide;
  entryTime: number;
}

interface ClosedTrade {
  symbol: string;
  side: PositionSide;
  entryTime: number;
  exitTime: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
}

interface SimResult {
  finalValue: number;
  returnPct: number;
  maxDrawdownPct: number;
  closed: ClosedTrade[];
  feesPaid: number;
  sessions: number;
  dailyPnl: Map<string, number>;
  killSwitchDays: number;
  firstTime: number;
  lastTime: number;
}

function fmtTime(epoch: number): string {
  const { day, minute } = istClock(epoch);
  return `${day} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function exitBucket(reason: string): string {
  if (reason.startsWith("Stop-loss")) return "stop-loss";
  if (reason.startsWith("Target")) return "target";
  if (reason.startsWith("Square-off")) return "square-off";
  if (reason.startsWith("EMA")) return "trend reversal";
  return "end-of-day (missing bars)";
}

function simulate(
  barsBySymbol: Map<string, IntradayBar[]>,
  params: IntradayParams,
  sessionDays: Set<string>,
  indexBars: IntradayBar[] = []
): SimResult {
  const indexByTime = new Map<string, Map<number, number>>();
  const allTimes = new Set<number>();
  for (const [symbol, bars] of barsBySymbol) {
    const m = new Map<number, number>();
    bars.forEach((b, i) => {
      if (!sessionDays.has(istClock(b.time).day)) return;
      m.set(b.time, i);
      allTimes.add(b.time);
    });
    indexByTime.set(symbol, m);
  }
  const times = [...allTimes].sort((a, b) => a - b);

  let cash = STARTING_CASH;
  const positions = new Map<string, OpenPosition>();
  const lastPrice = new Map<string, number>();
  const closed: ClosedTrade[] = [];
  let feesPaid = 0;
  let risk: RiskState = freshRiskState();
  let currentDay = "";
  let peak = STARTING_CASH;
  let maxDrawdownPct = 0;
  let killSwitchDays = 0;
  const dailyPnl = new Map<string, number>();

  const equity = () =>
    cash + [...positions].reduce((s, [sym, p]) => s + positionValue(p, lastPrice.get(sym) ?? p.avgBuyPrice), 0);

  function sell(symbol: string, price: number, time: number, reason: string) {
    const p = positions.get(symbol)!;
    const gross = p.quantity * price;
    const fee = gross * (INTRADAY_COST_PCT / 100);
    const basis = p.avgBuyPrice * p.quantity;
    // Long: proceeds - cost. Short (cover): held margin - buy-back cost.
    const pnl = p.side === "SHORT" ? basis - gross - fee : gross - fee - basis;
    cash += p.side === "SHORT" ? basis + pnl : gross - fee;
    feesPaid += fee;
    positions.delete(symbol);
    closed.push({ symbol, side: p.side, entryTime: p.entryTime, exitTime: time, pnl, pnlPct: (pnl / (p.avgBuyPrice * p.quantity)) * 100, exitReason: reason });
    const day = istClock(time).day;
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + pnl);
    const before = risk.killSwitchActive;
    risk = recordTrade(risk, pnl, INTRADAY_RISK_LIMITS, equity());
    if (!before && risk.killSwitchActive) killSwitchDays++;
  }

  let indexEnd = 0; // indexBars[0..indexEnd) have time <= current bar
  for (const time of times) {
    while (indexEnd < indexBars.length && indexBars[indexEnd].time <= time) indexEnd++;
    const market = { index: indexBars.slice(Math.max(0, indexEnd - WINDOW_BARS), indexEnd) };
    const day = istClock(time).day;
    if (day !== currentDay) {
      // Safety net: anything still open from the previous session (a
      // symbol with missing late bars) is closed at its last price.
      for (const symbol of [...positions.keys()]) sell(symbol, lastPrice.get(symbol)!, time, "End-of-day forced close");
      // Kill switch + counters reset each morning - stands in for the
      // manual `agent:reset-kill-switch` a human would run.
      risk = freshRiskState();
      currentDay = day;
    }

    for (const [symbol, bars] of barsBySymbol) {
      const i = indexByTime.get(symbol)!.get(time);
      if (i === undefined) continue;
      const bar = bars[i];
      lastPrice.set(symbol, bar.close);
      // Window may reach into sessions outside sessionDays - that's just
      // indicator warmup, the same history the live runner would have.
      const window = bars.slice(Math.max(0, i - WINDOW_BARS + 1), i + 1);
      const position = positions.get(symbol) ?? null;
      const signal = intradaySignal(window, bar.close, position, params, market);

      // Exits are protective - never blocked by trade-count or kill-switch caps.
      if ((signal.action === "SELL" || signal.action === "COVER") && position) {
        sell(symbol, bar.close, time, signal.reasons[0]);
        continue;
      }
      if ((signal.action !== "BUY" && signal.action !== "SHORT") || position) continue;
      if (positions.size >= params.maxOpenPositions) continue;

      const portfolioValue = equity();
      const budget = Math.min(portfolioValue * (INTRADAY_RISK_LIMITS.maxPositionPct / 100), cash);
      const quantity = Math.floor(budget / (bar.close * (1 + INTRADAY_COST_PCT / 100)));
      if (quantity < 1) continue;
      const check = checkTrade(
        { action: "BUY", quantity, price: bar.close, portfolioValue, existingPositionValue: 0 },
        risk,
        INTRADAY_RISK_LIMITS
      );
      if (!check.allowed) continue;

      const gross = quantity * bar.close;
      const fee = gross * (INTRADAY_COST_PCT / 100);
      feesPaid += fee;
      if (signal.action === "SHORT") {
        cash -= gross - fee; // margin held = net proceeds, as paperBroker
        positions.set(symbol, { quantity, avgBuyPrice: (gross - fee) / quantity, side: "SHORT", entryTime: time });
      } else {
        cash -= gross + fee;
        positions.set(symbol, { quantity, avgBuyPrice: (gross + fee) / quantity, side: "LONG", entryTime: time });
      }
      risk = recordTrade(risk, 0, INTRADAY_RISK_LIMITS, portfolioValue);
    }

    const eq = equity();
    peak = Math.max(peak, eq);
    maxDrawdownPct = Math.min(maxDrawdownPct, ((eq - peak) / peak) * 100);
  }
  const lastTime = times[times.length - 1];
  for (const symbol of [...positions.keys()]) sell(symbol, lastPrice.get(symbol)!, lastTime, "End-of-day forced close");

  return {
    finalValue: cash,
    returnPct: ((cash - STARTING_CASH) / STARTING_CASH) * 100,
    maxDrawdownPct,
    closed,
    feesPaid,
    sessions: sessionDays.size,
    dailyPnl,
    killSwitchDays,
    firstTime: times[0],
    lastTime,
  };
}

function profitFactor(closed: ClosedTrade[]): number | null {
  const grossWin = closed.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -closed.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  return grossLoss > 0 ? grossWin / grossLoss : null;
}

function printReport(name: string, r: SimResult, symbolCount: number) {
  const wins = r.closed.filter((t) => t.pnl > 0);
  const losses = r.closed.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const days = [...r.dailyPnl.values()];
  const pf = profitFactor(r.closed);

  console.log(`\n=== Intraday backtest [${name}]: ${symbolCount} symbols, ${r.sessions} sessions (${fmtTime(r.firstTime)} -> ${fmtTime(r.lastTime)}) ===`);
  console.log(`Starting cash:      ${STARTING_CASH.toFixed(2)}`);
  console.log(`Final value:        ${r.finalValue.toFixed(2)}`);
  console.log(`Return:             ${r.returnPct.toFixed(2)}%  (before fees: ${(((r.finalValue + r.feesPaid - STARTING_CASH) / STARTING_CASH) * 100).toFixed(2)}%)`);
  console.log(`Max drawdown:       ${r.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Round trips:        ${r.closed.length} (${(r.closed.length / r.sessions).toFixed(1)}/day)`);
  console.log(`Win rate:           ${r.closed.length ? ((wins.length / r.closed.length) * 100).toFixed(1) : "0"}%`);
  console.log(`Avg win / loss:     ${wins.length ? (grossWin / wins.length).toFixed(2) : "0"} / -${losses.length ? (grossLoss / losses.length).toFixed(2) : "0"}`);
  console.log(`Profit factor:      ${pf != null ? pf.toFixed(2) : "n/a"}  (gross wins / gross losses, >1 = profitable)`);
  console.log(`Fees paid (${INTRADAY_COST_PCT}%/side): ${r.feesPaid.toFixed(2)} - already included above.`);
  console.log(`Green / red days:   ${days.filter((d) => d > 0).length} / ${days.filter((d) => d <= 0).length}  (best ${Math.max(0, ...days).toFixed(2)}, worst ${Math.min(0, ...days).toFixed(2)})`);
  console.log(`Kill-switch days:   ${r.killSwitchDays}`);
  for (const side of ["LONG", "SHORT"] as const) {
    const t = r.closed.filter((c) => c.side === side);
    if (t.length) console.log(`  ${side.padEnd(6)} ${String(t.length).padStart(4)} trades  win ${((t.filter((c) => c.pnl > 0).length / t.length) * 100).toFixed(0)}%  P&L ${t.reduce((s, c) => s + c.pnl, 0).toFixed(2)}`);
  }

  const buckets = new Map<string, { n: number; pnl: number }>();
  for (const t of r.closed) {
    const b = buckets.get(exitBucket(t.exitReason)) ?? { n: 0, pnl: 0 };
    b.n++;
    b.pnl += t.pnl;
    buckets.set(exitBucket(t.exitReason), b);
  }
  console.log("By exit reason:");
  for (const [bucket, b] of buckets) console.log(`  ${bucket.padEnd(26)} ${String(b.n).padStart(4)} trades  P&L ${b.pnl.toFixed(2)}`);
}

async function main() {
  const symbols = process.argv.slice(2).length ? process.argv.slice(2) : NIFTY_WATCHLIST;
  console.log(`Fetching 60 days of 5-minute bars for ${symbols.length} symbols...`);

  const barsBySymbol = new Map<string, IntradayBar[]>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const bars = await getIntradayBars(symbol, "60d");
        if (bars.length > 0) barsBySymbol.set(symbol, bars);
      } catch (err) {
        console.error(`  ${symbol}: skipped (${err instanceof Error ? err.message : err})`);
      }
    })
  );

  let indexBars: IntradayBar[] = [];
  try {
    indexBars = await getIntradayBars(NIFTY_INDEX, "60d");
  } catch (err) {
    console.error(`  ${NIFTY_INDEX}: unavailable - market-filter variants will never buy (${err instanceof Error ? err.message : err})`);
  }

  const allDays = [...new Set([...barsBySymbol.values()].flatMap((bars) => bars.map((b) => istClock(b.time).day)))].sort();
  // Skip the first session: indicators need prior bars to warm up.
  const tradable = allDays.slice(1);
  const cut = Math.floor(tradable.length * IN_SAMPLE_FRACTION);
  const inSample = new Set(tradable.slice(0, cut));
  const outOfSample = new Set(tradable.slice(cut));

  for (const v of VARIANTS) printReport(v.name, simulate(barsBySymbol, v.params, new Set(tradable), indexBars), barsBySymbol.size);

  console.log(`\n=== Walk-forward: in-sample ${[...inSample][0]}..${[...inSample].at(-1)} (${inSample.size}d) | out-of-sample ${[...outOfSample][0]}..${[...outOfSample].at(-1)} (${outOfSample.size}d) ===`);
  console.log(`${"variant".padEnd(30)} ${"in-sample".padStart(10)} ${"PF".padStart(5)}   ${"held-out".padStart(10)} ${"PF".padStart(5)}`);
  for (const v of VARIANTS) {
    const a = simulate(barsBySymbol, v.params, inSample, indexBars);
    const b = simulate(barsBySymbol, v.params, outOfSample, indexBars);
    const pf = (r: SimResult) => (profitFactor(r.closed)?.toFixed(2) ?? "n/a").padStart(5);
    console.log(`${v.name.padEnd(30)} ${(a.returnPct.toFixed(2) + "%").padStart(10)} ${pf(a)}   ${(b.returnPct.toFixed(2) + "%").padStart(10)} ${pf(b)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
