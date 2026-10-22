import type { IntradayBar } from "@/lib/providers/yahooProvider";
import { calculateRSI } from "@/lib/suggestions/scoreHolding";

// Intraday (5-minute bar) long/short strategy for NSE - separate from the
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
//   SHORTS (allowShorts) are the exact mirror: EMA(9) crosses BELOW
//          EMA(21), price below VWAP, RSI 30-50, NIFTY below its open and
//          EMA(21); stop if price rises 1%, target a 2% fall. Same-day
//          MIS shorts - squared off at 15:15 like longs.

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
  // Filters added after the 2026-10-22 paper session (13 trades, 11
  // losers, Nifty -0.54% on its 3rd straight red day): every entry was a
  // long into a falling market, and most exits were 1-bar EMA wiggles.
  // Each is a switch so the backtest can compare them (see VARIANTS).
  //   marketFilter         only buy while NIFTY 50 is above both its
  //                        session open and its EMA(21) - don't fight the index
  //   reversalConfirmBars  EMA(9)<EMA(21) must hold this many closed
  //                        bars before the reversal exit fires (1 = old behaviour)
  //   minEmaGapPct         a crossover must clear EMA(21) by this % of
  //                        price - "436.27 vs 436.27" is noise, not a trend
  //   maxOpenPositions     cap on concurrent positions (enforced by the
  //                        callers) - 11 correlated longs is one big bet
  // Live values = the "all four" backtest variant: lowest loss both
  // in-sample and held-out (still not profitable - see the backtest).
  marketFilter: true,
  reversalConfirmBars: 2,
  minEmaGapPct: 0.03,
  maxOpenPositions: 5,
  allowShorts: true,
};

export type IntradayParams = typeof INTRADAY_PARAMS;

export type IntradayAction = "BUY" | "SELL" | "SHORT" | "COVER" | "HOLD";

/** Index bars (oldest-first, up to the same moment) for the market filter. */
export interface MarketContext {
  index: IntradayBar[];
}

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

/** Last `n` values of an EMA series (seeded with an SMA), oldest first, or null if too short. */
function lastEmas(closes: number[], period: number, n: number): number[] | null {
  if (closes.length < period + n - 1) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [ema];
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out.slice(-n);
}

/** Last two values of an EMA series, or null if too short. */
function lastTwoEma(closes: number[], period: number): [number, number] | null {
  if (closes.length < period + 1) return null;
  const [prev, cur] = lastEmas(closes, period, 2)!;
  return [prev, cur];
}

/**
 * Which way is the index leaning? Up = NIFTY 50 above both its session
 * open and its EMA(21) (supports longs); down = below both (supports
 * shorts); neither = mixed, no new entries either way. Index bars carry no volume on Yahoo, so no VWAP
 * here. Null = not enough index data to judge.
 */
export function marketTrend(index: IntradayBar[], slowEma = 21): { up: boolean; down: boolean; detail: string } | null {
  const last = index[index.length - 1];
  if (!last) return null;
  const day = istClock(last.time).day;
  const sessionOpen = index.find((b) => istClock(b.time).day === day)!.open;
  const ema = lastTwoEma(index.map((b) => b.close), slowEma);
  if (!ema) return null;
  return {
    up: last.close > sessionOpen && last.close > ema[1],
    down: last.close < sessionOpen && last.close < ema[1],
    detail: `NIFTY ${last.close.toFixed(1)} vs open ${sessionOpen.toFixed(1)}, EMA(${slowEma}) ${ema[1].toFixed(1)}`,
  };
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

/** An open intraday position as the strategy sees it. */
export interface SignalPosition {
  // LONG: cost/share incl. fee. SHORT: proceeds/share net of fee.
  avgBuyPrice: number;
  side?: "LONG" | "SHORT"; // default LONG
}

/**
 * Decide on the latest CLOSED bar. `bars` must be oldest-first and may
 * span previous sessions (EMAs/RSI warm up across days, VWAP doesn't).
 * `price` is what an order would fill at - the bar close in the
 * backtest, the live quote in the runner.
 *
 * Actions: BUY / SELL open and close a long, SHORT / COVER open and
 * close a short. With a position only its closing action can come back.
 */
export function intradaySignal(
  bars: IntradayBar[],
  price: number,
  position: SignalPosition | null,
  params: IntradayParams = INTRADAY_PARAMS,
  market?: MarketContext
): IntradaySignal {
  const last = bars[bars.length - 1];
  if (!last) return { action: "HOLD", reasons: ["No bars."] };
  // Bar START + 5 min = the moment this bar closed, i.e. "now".
  const { minute } = istClock(last.time + 300);
  const closes = bars.map((b) => b.close);
  const fast = lastTwoEma(closes, params.fastEma);
  const slow = lastTwoEma(closes, params.slowEma);

  if (position) {
    const short = position.side === "SHORT";
    const exit: IntradayAction = short ? "COVER" : "SELL";
    // Signed so that + is always profit, whichever the direction.
    const changePct = ((short ? position.avgBuyPrice - price : price - position.avgBuyPrice) / position.avgBuyPrice) * 100;
    if (minute >= params.squareOffMinute) {
      return { action: exit, reasons: [`Square-off time (15:15 IST) - closing intraday ${short ? "short" : "position"} at ${changePct.toFixed(2)}%.`] };
    }
    if (changePct <= -params.stopLossPct) {
      return { action: exit, reasons: [`Stop-loss: ${changePct.toFixed(2)}% from entry (limit -${params.stopLossPct}%).`] };
    }
    if (changePct >= params.targetPct) {
      return { action: exit, reasons: [`Target hit: +${changePct.toFixed(2)}% from entry (target +${params.targetPct}%).`] };
    }
    const n = Math.max(1, params.reversalConfirmBars);
    const fastN = lastEmas(closes, params.fastEma, n);
    const slowN = lastEmas(closes, params.slowEma, n);
    const reversed = !!fastN && !!slowN && fastN.every((f, i) => (short ? f > slowN[i] : f < slowN[i]));
    if (params.exitOnTrendReversal && reversed) {
      return {
        action: exit,
        reasons: [
          `EMA(${params.fastEma}) ${short ? "rose back above" : "fell back below"} EMA(${params.slowEma}) - trend reversed, exiting at ${changePct.toFixed(2)}%.`,
        ],
      };
    }
    return { action: "HOLD", reasons: [`In ${short ? "short" : "position"}, ${changePct.toFixed(2)}% from entry - no exit condition yet.`] };
  }

  if (minute < params.firstEntryMinute || minute > params.lastEntryMinute) {
    return { action: "HOLD", reasons: ["Outside the 09:30-14:45 IST entry window."] };
  }
  if (!fast || !slow) return { action: "HOLD", reasons: ["Not enough bars for EMAs yet."] };

  const crossedUp = fast[0] <= slow[0] && fast[1] > slow[1];
  const crossedDown = params.allowShorts && fast[0] >= slow[0] && fast[1] < slow[1];
  if (!crossedUp && !crossedDown) return { action: "HOLD", reasons: ["No fresh EMA crossover on this bar."] };
  const short = crossedDown;

  const gapPct = (Math.abs(fast[1] - slow[1]) / price) * 100;
  if (gapPct < params.minEmaGapPct) {
    return { action: "HOLD", reasons: [`EMA crossover too marginal (${gapPct.toFixed(3)}% < ${params.minEmaGapPct}%) - skipping.`] };
  }

  const vwap = sessionVwap(bars);
  const rsi = calculateRSI(closes, params.rsiPeriod);
  if (vwap === null || rsi === null) return { action: "HOLD", reasons: ["VWAP/RSI unavailable."] };

  const reasons = [
    `EMA(${params.fastEma}) crossed ${short ? "below" : "above"} EMA(${params.slowEma}) (${fast[1].toFixed(2)} vs ${slow[1].toFixed(2)}).`,
  ];
  if (short ? price >= vwap : price <= vwap) {
    return {
      action: "HOLD",
      reasons: [...reasons, `But price ${price.toFixed(2)} is ${short ? "above" : "below"} session VWAP ${vwap.toFixed(2)} - skipping.`],
    };
  }
  // Shorts mirror the long band: 50-70 for longs -> 30-50 for shorts
  // (momentum down, not already oversold).
  const [rsiMin, rsiMax] = short ? [100 - params.rsiMax, 100 - params.rsiMin] : [params.rsiMin, params.rsiMax];
  if (rsi < rsiMin || rsi > rsiMax) {
    return { action: "HOLD", reasons: [...reasons, `But RSI(14) ${rsi.toFixed(0)} is outside ${rsiMin}-${rsiMax} - skipping.`] };
  }
  const extra: string[] = [];
  if (params.marketFilter) {
    const m = market ? marketTrend(market.index, params.slowEma) : null;
    if (!m) return { action: "HOLD", reasons: [...reasons, "But NIFTY data unavailable for the market filter - skipping."] };
    if (short ? !m.down : !m.up) {
      return { action: "HOLD", reasons: [...reasons, `But the market is ${short ? "not weak" : "weak"} (${m.detail}) - skipping.`] };
    }
    extra.push(`Market ${short ? "down" : "up"} (${m.detail}).`);
  }
  return {
    action: short ? "SHORT" : "BUY",
    reasons: [...reasons, `Price ${price.toFixed(2)} ${short ? "below" : "above"} VWAP ${vwap.toFixed(2)}.`, `RSI(14) ${rsi.toFixed(0)}.`, ...extra],
  };
}
