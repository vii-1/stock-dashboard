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
  // Entry-rule tests isolate EMA/VWAP/RSI - the 10-22 filters are off
  // here and get their own tests below.
  const BASE = { ...INTRADAY_PARAMS, marketFilter: false, reversalConfirmBars: 1, minEmaGapPct: 0, maxOpenPositions: 30, allowShorts: false };

  it("buys a fresh EMA crossover above VWAP when RSI is in range", () => {
    const s = intradaySignal(crossover, 100.5, null, { ...BASE, rsiMax: 100 });
    expect(s.action).toBe("BUY");
    expect(s.reasons.join(" ")).toMatch(/crossed above.*above VWAP/);
  });

  it("skips the same crossover when RSI is overbought", () => {
    const s = intradaySignal(crossover, 100.5, null, BASE);
    expect(s.action).toBe("HOLD");
    expect(s.reasons.join(" ")).toMatch(/RSI/);
  });

  it("skips a crossover below VWAP", () => {
    const s = intradaySignal(crossover, 99, null, { ...BASE, rsiMax: 100 });
    expect(s.action).toBe("HOLD");
    expect(s.reasons.join(" ")).toMatch(/below session VWAP/);
  });

  it("never buys on a flat series (no crossover)", () => {
    const series = bars(new Array(40).fill(100));
    expect(intradaySignal(series, 100, null).action).toBe("HOLD");
  });

  describe("short side", () => {
    // Mirror of `crossover`: flat then one bar DOWN (RSI 0, so the
    // short band 100-rsiMax..100-rsiMin is opened down to 0 via rsiMax: 100).
    const crossunder = bars([...new Array(40).fill(100), 99.5]);
    const shorts = { ...BASE, allowShorts: true, rsiMax: 100 };

    it("shorts a fresh EMA cross-under below VWAP", () => {
      const s = intradaySignal(crossunder, 99.5, null, shorts);
      expect(s.action).toBe("SHORT");
      expect(s.reasons.join(" ")).toMatch(/crossed below.*below VWAP/);
    });

    it("never shorts with allowShorts off", () => {
      expect(intradaySignal(crossunder, 99.5, null, { ...shorts, allowShorts: false }).action).toBe("HOLD");
    });

    it("needs NIFTY below its open and EMA(21) under the market filter", () => {
      const p = { ...shorts, marketFilter: true };
      const niftyDown = { index: bars([...new Array(40).fill(20000), 19900]) };
      const niftyUp = { index: bars([...new Array(40).fill(20000), 20100]) };
      expect(intradaySignal(crossunder, 99.5, null, p, niftyDown).action).toBe("SHORT");
      expect(intradaySignal(crossunder, 99.5, null, p, niftyUp).action).toBe("HOLD");
    });

    it("stops out a short when price RISES 1%, takes profit on a 2% fall", () => {
      const flat = bars(new Array(30).fill(100));
      const pos = { avgBuyPrice: 100, side: "SHORT" as const };
      const stop = intradaySignal(flat, 101.1, pos, shorts);
      expect(stop.action).toBe("COVER");
      expect(stop.reasons[0]).toMatch(/Stop-loss/);
      expect(intradaySignal(flat, 97.9, pos, shorts).reasons[0]).toMatch(/Target/);
      expect(intradaySignal(flat, 99, pos, shorts).action).toBe("HOLD");
    });

    it("covers when EMA(9) rises back above EMA(21), and squares off at 15:15", () => {
      const pos = { avgBuyPrice: 100, side: "SHORT" as const };
      const pop = bars([...new Array(40).fill(100), 100.5]);
      expect(intradaySignal(pop, 100.5, pos, shorts).action).toBe("COVER");
      expect(intradaySignal(bars(new Array(72).fill(100)), 100, pos, shorts).action).toBe("COVER");
    });
  });

  describe("2026-10-22 filters", () => {
    const loose = { ...BASE, rsiMax: 100 };
    const niftyUp = { index: bars([...new Array(40).fill(20000), 20100]) };
    const niftyDown = { index: bars([...new Array(40).fill(20000), 19900]) };

    it("market filter: buys only while NIFTY is above its open and EMA(21)", () => {
      const p = { ...loose, marketFilter: true };
      expect(intradaySignal(crossover, 100.5, null, p, niftyUp).action).toBe("BUY");
      const down = intradaySignal(crossover, 100.5, null, p, niftyDown);
      expect(down.action).toBe("HOLD");
      expect(down.reasons.join(" ")).toMatch(/market is weak/);
    });

    it("market filter: no index data means no entry", () => {
      expect(intradaySignal(crossover, 100.5, null, { ...loose, marketFilter: true }).action).toBe("HOLD");
    });

    it("skips a crossover that barely clears EMA(21)", () => {
      // 100 -> 100.5 leaves EMA(9) ~0.055% above EMA(21).
      expect(intradaySignal(crossover, 100.5, null, { ...loose, minEmaGapPct: 0.03 }).action).toBe("BUY");
      const s = intradaySignal(crossover, 100.5, null, { ...loose, minEmaGapPct: 0.1 });
      expect(s.action).toBe("HOLD");
      expect(s.reasons[0]).toMatch(/too marginal/);
    });

    it("reversal exit waits for confirmation bars", () => {
      // One down bar: EMA(9) dips under EMA(21) on the last bar only.
      const dip = bars([...new Array(40).fill(100), 99.5]);
      expect(intradaySignal(dip, 99.5, { avgBuyPrice: 100 }, BASE).action).toBe("SELL");
      expect(intradaySignal(dip, 99.5, { avgBuyPrice: 100 }, { ...BASE, reversalConfirmBars: 2 }).action).toBe("HOLD");
      const twoDown = bars([...new Array(40).fill(100), 99.6, 99.5]);
      expect(intradaySignal(twoDown, 99.5, { avgBuyPrice: 100 }, { ...BASE, reversalConfirmBars: 2 }).action).toBe("SELL");
    });
  });
});
