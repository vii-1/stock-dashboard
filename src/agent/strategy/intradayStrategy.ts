import type { IntradayBar } from "@/lib/providers/yahooProvider";
import { calculateRSI } from "@/lib/suggestions/scoreHolding";

// Intraday (5-minute bar) long-only strategy for NSE - separate from the
// daily scoreHolding strategy, whose SMA(50)/ADX signals barely move
// within a session. Pure functions, no I/O: shared verbatim by the
// intraday backtest and the live paper runner (runIntraday.ts), same
// split as decisionEngine/runBacktest/runAgent.
//
// The setup is a textbook trend-following entry, nothing proprietary:
//   ENTRY  EMA(9) crosses above EMA(21) on the latest closed bar
//          AND close is above the session VWAP (trading with the day's
//              volume-weighted consensus, not against it)
//          AND RSI(14) is 50-70 (momentum up, not already overbought)
//          AND it's 09:30-14:45 IST (skip the opening auction noise and
//              don't open what can't be given time before square-off)
//   EXIT   stop-loss 1% / target 2% (2:1 reward:risk), or EMA(9) back
//          below EMA(21), or forced square-off at 15:15 IST like an MIS
//          order - nothing is ever carried overnight.

export const INTRADAY_PARAMS = {
  fastEma: 9,
  slowEma: 21,
  rsiPeriod: 14,
  rsiMin: 50,
  rsiMax: 70,
  stopLossPct: 1,
  targetPct: 2,
  firstEntryMinute: 9 * 60 + 30,
  lastEntryMinute: 14 * 60 + 45,
  squareOffMinute: 15 * 60 + 15,
  exitOnTrendReversal: true,
};

export type IntradayParams = typeof INTRADAY_PARAMS;

export type IntradayAction = "BUY" | "SELL" | "HOLD";

export interface IntradaySignal {
  action: IntradayAction;
  reasons: string[];
}

const IST_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** IST calendar day ("2026-10-19") and minutes since IST midnight. */
export function istClock(epochSeconds: number): { day: string; minute: number } {
  const parts = IST_FORMAT.formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Last two values of an EMA series (seeded with an SMA), or null if too short. */
function lastTwoEma(closes: number[], period: number): [number, number] | null {
  if (closes.length < period + 1) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let prev = ema;
  for (let i = period; i < closes.length; i++) {
    prev = ema;
    ema = closes[i] * k + ema * (1 - k);
  }
  return [prev, ema];
}

/**
 * Session VWAP: typical price (H+L+C)/3 weighted by volume, over bars
 * from the same IST day as the last bar. Null if the session has no
 * volume yet (Yahoo reports 0 on some bars).
 */
export function sessionVwap(bars: IntradayBar[]): number | null {
  if (bars.length === 0) return null;
  const day = istClock(bars[bars.length - 1].time).day;
  let pv = 0;
  let vol = 0;
  for (let i = bars.length - 1; i >= 0 && istClock(bars[i].time).day === day; i--) {
    const b = bars[i];
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    vol += b.volume;
  }
  return vol > 0 ? pv / vol : null;
}

/**
 * Decide on the latest CLOSED bar. `bars` must be oldest-first and may
 * span previous sessions (EMAs/RSI warm up across days, VWAP doesn't).
 * `price` is what an order would fill at - the bar close in the
 * backtest, the live quote in the runner.
 */
export function intradaySignal(
  bars: IntradayBar[],
  price: number,
  position: { avgBuyPrice: number } | null,
  params: IntradayParams = INTRADAY_PARAMS
): IntradaySignal {
  const last = bars[bars.length - 1];
  if (!last) return { action: "HOLD", reasons: ["No bars."] };
  // Bar START + 5 min = the moment this bar closed, i.e. "now".
  const { minute } = istClock(last.time + 300);
  const closes = bars.map((b) => b.close);
  const fast = lastTwoEma(closes, params.fastEma);
  const slow = lastTwoEma(closes, params.slowEma);

  if (position) {
    const changePct = ((price - position.avgBuyPrice) / position.avgBuyPrice) * 100;
    if (minute >= params.squareOffMinute) {
      return { action: "SELL", reasons: [`Square-off time (15:15 IST) - closing intraday position at ${changePct.toFixed(2)}%.`] };
    }
    if (changePct <= -params.stopLossPct) {
      return { action: "SELL", reasons: [`Stop-loss: ${changePct.toFixed(2)}% from entry (limit -${params.stopLossPct}%).`] };
    }
    if (changePct >= params.targetPct) {
      return { action: "SELL", reasons: [`Target hit: +${changePct.toFixed(2)}% from entry (target +${params.targetPct}%).`] };
    }
    if (params.exitOnTrendReversal && fast && slow && fast[1] < slow[1]) {
      return {
        action: "SELL",
        reasons: [`EMA(${params.fastEma}) fell back below EMA(${params.slowEma}) - trend reversed, exiting at ${changePct.toFixed(2)}%.`],
      };
    }
    return { action: "HOLD", reasons: [`In position, ${changePct.toFixed(2)}% from entry - no exit condition yet.`] };
  }

  if (minute < params.firstEntryMinute || minute > params.lastEntryMinute) {
    return { action: "HOLD", reasons: ["Outside the 09:30-14:45 IST entry window."] };
  }
  if (!fast || !slow) return { action: "HOLD", reasons: ["Not enough bars for EMAs yet."] };

  const crossedUp = fast[0] <= slow[0] && fast[1] > slow[1];
  if (!crossedUp) return { action: "HOLD", reasons: ["No fresh EMA crossover on this bar."] };

  const vwap = sessionVwap(bars);
  const rsi = calculateRSI(closes, params.rsiPeriod);
  if (vwap === null || rsi === null) return { action: "HOLD", reasons: ["VWAP/RSI unavailable."] };

  const reasons = [
    `EMA(${params.fastEma}) crossed above EMA(${params.slowEma}) (${fast[1].toFixed(2)} vs ${slow[1].toFixed(2)}).`,
  ];
  if (price <= vwap) {
    return { action: "HOLD", reasons: [...reasons, `But price ${price.toFixed(2)} is below session VWAP ${vwap.toFixed(2)} - skipping.`] };
  }
  if (rsi < params.rsiMin || rsi > params.rsiMax) {
    return { action: "HOLD", reasons: [...reasons, `But RSI(14) ${rsi.toFixed(0)} is outside ${params.rsiMin}-${params.rsiMax} - skipping.`] };
  }
  return {
    action: "BUY",
    reasons: [...reasons, `Price ${price.toFixed(2)} above VWAP ${vwap.toFixed(2)}.`, `RSI(14) ${rsi.toFixed(0)}.`],
  };
}
