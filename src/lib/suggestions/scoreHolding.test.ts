import { describe, expect, it } from "vitest";
import { calculateADX, calculateBollingerBands, calculateMACD } from "./scoreHolding";
import type { HistoryPoint } from "@/lib/providers/types";

function trendingHistory(length: number): HistoryPoint[] {
  return Array.from({ length }, (_, i) => {
    const close = 100 + i * 2;
    return { date: `2026-01-${i + 1}`, close, high: close + 1, low: close - 1 };
  });
}

function choppyHistory(length: number): HistoryPoint[] {
  return Array.from({ length }, (_, i) => {
    const close = 100 + (i % 2 === 0 ? 1 : -1);
    return { date: `2026-01-${i + 1}`, close, high: close + 0.5, low: close - 0.5 };
  });
}

describe("calculateBollingerBands", () => {
  it("returns null without enough history", () => {
    expect(calculateBollingerBands([1, 2, 3], 20)).toBeNull();
  });

  it("matches the textbook population-stddev example (mean 5, stddev 2)", () => {
    // [2,4,4,4,5,5,7,9]: mean 5, population variance 4, stddev 2 - the
    // standard worked example for population standard deviation.
    const closes = [2, 4, 4, 4, 5, 5, 7, 9];
    const bands = calculateBollingerBands(closes, 8, 1);
    expect(bands).not.toBeNull();
    expect(bands!.middle).toBeCloseTo(5);
    expect(bands!.upper).toBeCloseTo(7);
    expect(bands!.lower).toBeCloseTo(3);
  });

  it("collapses to a zero-width band on a perfectly flat price series", () => {
    const closes = new Array(20).fill(42);
    const bands = calculateBollingerBands(closes, 20);
    expect(bands).toEqual({ upper: 42, middle: 42, lower: 42 });
  });

  it("widens with a larger stdDevMultiplier", () => {
    const closes = [2, 4, 4, 4, 5, 5, 7, 9];
    const narrow = calculateBollingerBands(closes, 8, 1)!;
    const wide = calculateBollingerBands(closes, 8, 2)!;
    expect(wide.upper).toBeGreaterThan(narrow.upper);
    expect(wide.lower).toBeLessThan(narrow.lower);
  });
});

describe("calculateMACD", () => {
  it("returns null without enough history for the signal line", () => {
    expect(calculateMACD(new Array(20).fill(100))).toBeNull();
  });

  it("settles to ~zero MACD/signal/histogram on a perfectly flat price series", () => {
    // Fast EMA and slow EMA both converge to the flat price, so their
    // spread (the MACD line) and its own EMA (the signal line) should
    // both land on ~0 - this is what actually exercises the EMA seeding
    // and smoothing math, not just the subtraction at the end.
    const closes = new Array(60).fill(100);
    const result = calculateMACD(closes);
    expect(result).not.toBeNull();
    expect(result!.macd).toBeCloseTo(0, 6);
    expect(result!.signal).toBeCloseTo(0, 6);
    expect(result!.histogram).toBeCloseTo(0, 6);
  });

  it("goes positive (bullish) on a sustained uptrend", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const result = calculateMACD(closes)!;
    expect(result.macd).toBeGreaterThan(0);
  });

  it("goes negative (bearish) on a sustained downtrend", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 200 - i);
    const result = calculateMACD(closes)!;
    expect(result.macd).toBeLessThan(0);
  });
});

describe("calculateADX", () => {
  it("returns null without enough history", () => {
    expect(calculateADX(trendingHistory(10))).toBeNull();
  });

  it("returns null when history lacks high/low (e.g. crypto via CoinGecko)", () => {
    const closesOnly = trendingHistory(40).map((p) => ({ date: p.date, close: p.close }));
    expect(calculateADX(closesOnly)).toBeNull();
  });

  it("reads well above the trend threshold on a steady, strong uptrend", () => {
    const adx = calculateADX(trendingHistory(40));
    expect(adx).not.toBeNull();
    expect(adx!).toBeGreaterThan(25);
  });

  it("reads low on a choppy, directionless series", () => {
    const adx = calculateADX(choppyHistory(40));
    expect(adx).not.toBeNull();
    expect(adx!).toBeLessThan(25);
  });

  it("rates a strong trend higher than chop", () => {
    const trending = calculateADX(trendingHistory(40))!;
    const choppy = calculateADX(choppyHistory(40))!;
    expect(trending).toBeGreaterThan(choppy);
  });
});
