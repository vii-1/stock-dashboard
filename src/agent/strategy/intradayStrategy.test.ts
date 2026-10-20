import { describe, expect, it } from "vitest";
import type { IntradayBar } from "@/lib/providers/yahooProvider";
import { INTRADAY_PARAMS, intradaySignal, istClock, sessionVwap } from "./intradayStrategy";

// 2026-10-19 09:15 IST = 03:45 UTC
const SESSION_OPEN = Date.UTC(2026, 9, 19, 3, 45) / 1000;

function bars(closes: number[], startTime = SESSION_OPEN, volume = 1000): IntradayBar[] {
  return closes.map((close, i) => ({
    time: startTime + i * 300,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  }));
}

describe("istClock", () => {
  it("converts to IST day and minute", () => {
    expect(istClock(SESSION_OPEN)).toEqual({ day: "2026-10-19", minute: 9 * 60 + 15 });
  });
});

describe("sessionVwap", () => {
  it("only weights the latest IST session", () => {
    const yesterday = bars([500, 500], SESSION_OPEN - 86400);
    const today = bars([100, 102]);
    expect(sessionVwap([...yesterday, ...today])).toBeCloseTo(101);
  });
});

describe("intradaySignal", () => {
  it("squares off any position at 15:15 regardless of P&L", () => {
    // 72 bars from 09:15 -> last bar starts 15:10, closes 15:15
    const series = bars(new Array(72).fill(100));
    expect(intradaySignal(series, 100, { avgBuyPrice: 100 }).action).toBe("SELL");
  });

  it("hits the 1% stop-loss", () => {
    const series = bars(new Array(30).fill(100));
    const s = intradaySignal(series, 98.9, { avgBuyPrice: 100 });
    expect(s.action).toBe("SELL");
    expect(s.reasons[0]).toMatch(/Stop-loss/);
  });

  it("takes profit at +2%", () => {
    const series = bars(new Array(30).fill(100));
    expect(intradaySignal(series, 102.1, { avgBuyPrice: 100 }).reasons[0]).toMatch(/Target/);
  });

  it("does not open a position before 09:30", () => {
    const series = bars([100, 101, 102]);
    expect(intradaySignal(series, 102, null).action).toBe("HOLD");
  });

  // Flat at 100 for 40 bars (EMAs equal), then one bar up to 100.5:
  // fast EMA crosses above slow, price is above the ~100 session VWAP.
  // A single up-move on a flat series makes RSI 100, so the default
  // params must reject it as overbought; lifting rsiMax lets it through.
  const crossover = bars([...new Array(40).fill(100), 100.5]);

  it("buys a fresh EMA crossover above VWAP when RSI is in range", () => {
    const s = intradaySignal(crossover, 100.5, null, { ...INTRADAY_PARAMS, rsiMax: 100 });
    expect(s.action).toBe("BUY");
    expect(s.reasons.join(" ")).toMatch(/crossed above.*above VWAP/);
  });

  it("skips the same crossover when RSI is overbought", () => {
    const s = intradaySignal(crossover, 100.5, null);
    expect(s.action).toBe("HOLD");
    expect(s.reasons.join(" ")).toMatch(/RSI/);
  });

  it("skips a crossover below VWAP", () => {
    const s = intradaySignal(crossover, 99, null, { ...INTRADAY_PARAMS, rsiMax: 100 });
    expect(s.action).toBe("HOLD");
    expect(s.reasons.join(" ")).toMatch(/below session VWAP/);
  });

  it("never buys on a flat series (no crossover)", () => {
    const series = bars(new Array(40).fill(100));
    expect(intradaySignal(series, 100, null).action).toBe("HOLD");
  });
});
