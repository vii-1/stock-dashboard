// Usage: npm run agent:run-intraday
//
// One pass of the intraday paper agent (5-minute bars, NSE only). Run it
// every 5 minutes during market hours, like runAgent.ts - single-pass on
// purpose, see the note at the top of that file.
//
// Separate paper account ("PAPER_INTRADAY") from the daily agent, so the
// two strategies' results never mix. Strategy: intradayStrategy.ts.
// Backtest it first: npm run agent:backtest-intraday.
//
// Order of operations each pass:
//   1. Exits for every open position (stop-loss / target / reversal /
//      15:15 square-off). Exits are NEVER blocked - not by trade-count
//      caps, not even by the kill switch - so nothing is carried
//      overnight just because a cap tripped.
//   2. Entries for the watchlist, each through checkTrade first.

import { prisma } from "@/lib/prisma";
import { getIntradayBars, NIFTY_WATCHLIST, type IntradayBar } from "@/lib/providers/yahooProvider";
import { createPaperBroker, INTRADAY_COST_PCT } from "./broker/paperBroker";
import { intradaySignal } from "./strategy/intradayStrategy";
import {
  checkTrade,
  INTRADAY_RISK_LIMITS,
  isNseMarketOpen,
  nseHoliday,
  recordTrade,
  resetDailyCounters,
  type RiskState,
} from "./riskManager";

const MODE = "PAPER_INTRADAY";
const broker = createPaperBroker(MODE, INTRADAY_COST_PCT);
// Latest completed bar older than this = Yahoo is lagging; don't act on it.
const MAX_BAR_AGE_MINUTES = 12;

async function loadState(): Promise<{ risk: RiskState; lastResetDate: Date }> {
  const row = await prisma.agentState.upsert({ where: { id: MODE }, create: { id: MODE }, update: {} });
  return {
    risk: {
      killSwitchActive: row.killSwitchActive,
      killSwitchReason: row.killSwitchReason,
      tradesToday: row.tradesToday,
      realizedLossToday: row.realizedLossToday,
    },
    lastResetDate: row.lastResetDate,
  };
}

async function saveState(risk: RiskState, lastResetDate: Date) {
  await prisma.agentState.update({ where: { id: MODE }, data: { ...risk, lastResetDate } });
}

async function record(params: {
  side: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  status: "FILLED" | "REJECTED";
  rejectReason?: string;
  reasons: string[];
}) {
  await prisma.order.create({
    data: {
      mode: MODE,
      side: params.side,
      assetClass: "IN_STOCK",
      symbol: params.symbol,
      quantity: params.quantity,
      price: params.price,
      status: params.status,
      rejectReason: params.rejectReason ?? null,
    },
  });
  // Only actionable decisions are logged - 30 HOLDs every 5 minutes
  // would bury the daily agent's DecisionLog (the table has no mode column).
  await prisma.decisionLog.create({
    data: {
      symbol: params.symbol,
      suggestion: `INTRADAY_${params.side}`,
      reasons: JSON.stringify(params.reasons),
      executed: params.status === "FILLED",
      blockReason: params.rejectReason ?? null,
    },
  });
}

async function main() {
  if (!isNseMarketOpen(new Date())) {
    const holiday = nseHoliday(new Date());
    console.log(holiday ? `NSE holiday (${holiday}) - nothing to do.` : "NSE closed - nothing to do.");
    return;
  }

  let { risk, lastResetDate } = await loadState();
  if (new Date().toDateString() !== lastResetDate.toDateString()) {
    risk = resetDailyCounters(risk);
    lastResetDate = new Date();
  }

  const positions = await broker.getPositions();
  const symbols = [...new Set([...positions.map((p) => p.symbol), ...NIFTY_WATCHLIST])];

  const barsBySymbol = new Map<string, IntradayBar[]>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const bars = await getIntradayBars(symbol, "5d");
        const last = bars[bars.length - 1];
        if (last && Date.now() / 1000 - (last.time + 300) <= MAX_BAR_AGE_MINUTES * 60) {
          barsBySymbol.set(symbol, bars);
        } else {
          console.log(`${symbol}: latest bar is stale or missing, skipping.`);
        }
      } catch (err) {
        console.error(`${symbol}: failed to fetch bars:`, err instanceof Error ? err.message : err);
      }
    })
  );

  const cash0 = await broker.getCashBalance();
  const lastClose = (symbol: string) => barsBySymbol.get(symbol)?.at(-1)?.close;
  const portfolioValue = () =>
    cash0 + positions.reduce((s, p) => s + p.quantity * (lastClose(p.symbol) ?? p.avgBuyPrice), 0);

  // --- 1. Exits ---
  for (const position of positions) {
    const bars = barsBySymbol.get(position.symbol);
    if (!bars) continue;
    const price = bars[bars.length - 1].close;
    const signal = intradaySignal(bars, price, position);
    if (signal.action !== "SELL") continue;

    const result = await broker.placeOrder({ symbol: position.symbol, assetClass: "IN_STOCK", side: "SELL", quantity: position.quantity, price });
    await record({ side: "SELL", symbol: position.symbol, quantity: position.quantity, price, status: result.status, rejectReason: result.rejectReason, reasons: signal.reasons });
    if (result.status === "FILLED") {
      console.log(`${position.symbol}: SELL ${position.quantity} @ ${price.toFixed(2)} (P&L ${result.realizedPnl?.toFixed(2)}) - ${signal.reasons[0]}`);
      risk = recordTrade(risk, result.realizedPnl ?? 0, INTRADAY_RISK_LIMITS, portfolioValue());
    } else {
      console.log(`${position.symbol}: SELL REJECTED - ${result.rejectReason}`);
    }
  }

  // --- 2. Entries ---
  if (risk.killSwitchActive) {
    console.log(`Kill switch active (${risk.killSwitchReason}) - exits only, no new entries.`);
  } else {
    const held = new Set((await broker.getPositions()).map((p) => p.symbol));
    for (const symbol of NIFTY_WATCHLIST) {
      const bars = barsBySymbol.get(symbol);
      if (!bars || held.has(symbol)) continue;
      const price = bars[bars.length - 1].close;
      const signal = intradaySignal(bars, price, null);
      if (signal.action !== "BUY") continue;

      const cash = await broker.getCashBalance();
      const value = portfolioValue();
      const budget = Math.min(value * (INTRADAY_RISK_LIMITS.maxPositionPct / 100), cash);
      const quantity = Math.floor(budget / (price * (1 + INTRADAY_COST_PCT / 100)));
      if (quantity < 1) {
        console.log(`${symbol}: BUY signal but not enough cash for one share.`);
        continue;
      }
      const check = checkTrade({ action: "BUY", quantity, price, portfolioValue: value, existingPositionValue: 0 }, risk, INTRADAY_RISK_LIMITS);
      if (!check.allowed) {
        console.log(`${symbol}: BUY BLOCKED - ${check.blockReason}`);
        await record({ side: "BUY", symbol, quantity, price, status: "REJECTED", rejectReason: check.blockReason ?? undefined, reasons: signal.reasons });
        continue;
      }

      const result = await broker.placeOrder({ symbol, assetClass: "IN_STOCK", side: "BUY", quantity, price });
      await record({ side: "BUY", symbol, quantity, price, status: result.status, rejectReason: result.rejectReason, reasons: signal.reasons });
      if (result.status === "FILLED") {
        console.log(`${symbol}: BUY ${quantity} @ ${price.toFixed(2)} - ${signal.reasons.join(" ")}`);
        risk = recordTrade(risk, 0, INTRADAY_RISK_LIMITS, value);
      } else {
        console.log(`${symbol}: BUY REJECTED - ${result.rejectReason}`);
      }
    }
  }

  await saveState(risk, lastResetDate);
  const open = await broker.getPositions();
  console.log(`Pass complete. Cash ${(await broker.getCashBalance()).toFixed(2)}, open positions: ${open.length ? open.map((p) => `${p.symbol}x${p.quantity}`).join(", ") : "none"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
