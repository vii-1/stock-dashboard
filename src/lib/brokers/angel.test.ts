import { describe, expect, it, vi } from "vitest";

// angel.ts imports prisma for session storage; the mapping tested here
// is pure, so stub the client out.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { mapAngelHolding, normaliseAngelSymbol } = await import("./angel");

describe("normaliseAngelSymbol", () => {
  it("drops Angel's series suffix", () => {
    expect(normaliseAngelSymbol("SBIN-EQ")).toBe("SBIN");
    expect(normaliseAngelSymbol("GOLDBEES-EQ")).toBe("GOLDBEES");
    expect(normaliseAngelSymbol("XYZ-BE")).toBe("XYZ");
    expect(normaliseAngelSymbol("TATAMOTORS")).toBe("TATAMOTORS");
  });
});

describe("mapAngelHolding", () => {
  it("normalises a SmartAPI holding and computes P&L and day change itself", () => {
    const h = mapAngelHolding({
      tradingsymbol: "SBIN-EQ",
      exchange: "NSE",
      isin: "INE062A01020",
      quantity: 10,
      t1quantity: 2,
      averageprice: 900,
      ltp: 970,
      close: 960,
      profitandloss: 0, // Angel has returned 0 here - we don't trust it
    });
    expect(h).toMatchObject({ broker: "angel", tradingsymbol: "SBIN", exchange: "NSE", quantity: 10, t1Quantity: 2 });
    expect(h.pnl).toBeCloseTo((970 - 900) * 12);
    expect(h.dayChangePct).toBeCloseTo((10 / 960) * 100);
  });
});
