import { describe, expect, it } from "vitest";
import type { HistoryPoint } from "@/lib/providers/types";
import { bigBuyers, buyZone, supportResistance, volumeProfile, zoneTests, type Deal } from "./priceLevels";

function day(i: number, close: number, opts: { low?: number; high?: number; volume?: number } = {}): HistoryPoint {
  const date = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  return { date, close, low: opts.low ?? close, high: opts.high ?? close, volume: opts.volume ?? 1000 };
}

// Bounces between ~100 and ~120 three times, then trades at 110:
// clear support at 100, clear resistance at 120.
function range(): HistoryPoint[] {
  const path: number[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let k = 0; k <= 10; k++) path.push(110 - k); // 110 -> 100
    for (let k = 1; k <= 20; k++) path.push(100 + k); // -> 120
    for (let k = 1; k <= 10; k++) path.push(120 - k); // -> 110
  }
  for (let k = 0; k < 10; k++) path.push(110);
  return path.map((c, i) => day(i, c));
}

describe("supportResistance", () => {
  it("finds the repeated floor and ceiling, split around the current price", () => {
    const { supports, resistances } = supportResistance(range(), 110);
    expect(supports[0].price).toBe(100);
    expect(supports[0].touches).toBe(3);
    expect(resistances[0].price).toBe(120);
    expect(resistances[0].touches).toBe(3);
  });

  it("ignores levels the price is currently inside", () => {
    const { supports, resistances } = supportResistance(range(), 100);
    expect([...supports, ...resistances].some((l) => l.low <= 100 && l.high >= 100)).toBe(false);
  });
});

describe("volumeProfile", () => {
  it("puts the point of control where the volume traded", () => {
    const history = [
      ...Array.from({ length: 30 }, (_, i) => day(i, 50, { volume: 10_000 })),
      ...Array.from({ length: 30 }, (_, i) => day(30 + i, 80, { volume: 100 })),
    ];
    const vp = volumeProfile(history)!;
    expect(vp.poc).toBeGreaterThan(49);
    expect(vp.poc).toBeLessThan(51);
    expect(vp.valueAreaLow).toBeLessThanOrEqual(50);
  });

  it("returns null without volume data", () => {
    expect(volumeProfile(range().map(({ volume, ...p }) => p))).toBeNull();
  });
});

describe("bigBuyers", () => {
  const d = (client: string, side: "BUY" | "SELL", quantity: number, price: number, date = "2026-05-01"): Deal => ({
    client,
    side,
    quantity,
    price,
    date,
    kind: "bulk",
  });

  it("excludes clients who bought and sold (traders), keeps net buyers", () => {
    const s = bigBuyers([
      d("FUND A", "BUY", 1000, 100),
      d("FUND A", "BUY", 1000, 110, "2026-06-01"),
      d("HFT FIRM", "BUY", 5000, 90),
      d("HFT FIRM", "SELL", 5000, 91),
    ]);
    expect(s.tradersExcluded).toBe(1);
    expect(s.buyers.map((b) => b.client)).toEqual(["FUND A"]);
    expect(s.buyers[0].avgPrice).toBeCloseTo(105);
    expect(s.avgPrice).toBeCloseTo(105);
    expect(s.buyers[0].firstDate).toBe("2026-05-01");
  });

  it("has no average when nobody net-bought", () => {
    expect(bigBuyers([d("X", "SELL", 10, 100)]).avgPrice).toBeNull();
  });
});

describe("zoneTests", () => {
  it("counts each drop into the zone once and whether it held", () => {
    // Two dips into 100-102 that bounce, then one that collapses to 90
    // (>3% below the zone). Gaps exceed the 20-session lookahead so each
    // dip is its own episode.
    const closes = [110, 101, ...new Array(25).fill(110), 101, ...new Array(25).fill(110), 101, 90, ...new Array(20).fill(90)];
    expect(zoneTests(closes.map((c, i) => day(i, c)), 100, 102)).toEqual({ tests: 3, holds: 2 });
  });
});

describe("buyZone", () => {
  const fmt = (n: number) => n.toFixed(0);

  it("picks the level where several signals agree, below the price", () => {
    const history = range();
    const { supports } = supportResistance(history, 110);
    const zone = buyZone({ history, currentPrice: 110, supports, profile: null, bigBuyerAvg: 101, formatPrice: fmt })!;
    expect(zone.low).toBeLessThanOrEqual(100);
    expect(zone.high).toBeGreaterThanOrEqual(101);
    expect(zone.high).toBeLessThan(110);
    expect(zone.evidence.join(" ")).toMatch(/Big buyers/);
    expect(zone.distancePct).toBeGreaterThan(0);
  });

  it("returns null when nothing sits below the price", () => {
    expect(buyZone({ history: range(), currentPrice: 50, supports: [], profile: null, bigBuyerAvg: null, formatPrice: fmt })).toBeNull();
  });

  it("reports distance 0 when price is already in the zone", () => {
    const zone = buyZone({ history: range(), currentPrice: 100.5, supports: [], profile: null, bigBuyerAvg: 100, formatPrice: fmt })!;
    expect(zone.distancePct).toBe(0);
  });
});
