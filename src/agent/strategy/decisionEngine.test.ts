import { describe, expect, it, vi } from "vitest";

// scoreHolding's own signal logic already has live coverage elsewhere in
// the dashboard (the /portfolio page exercises it against real data);
// what's unique to decisionEngine is the action/sizing mapping on top of
// it, so that's what these tests isolate by mocking the suggestion it
// receives rather than trying to reverse-engineer a price series that
// produces a specific SMA/RSI outcome.
vi.mock("@/lib/suggestions/scoreHolding", () => ({
  scoreHolding: vi.fn(),
}));

const { scoreHolding } = await import("@/lib/suggestions/scoreHolding");
const { decide } = await import("./decisionEngine");

function mockSuggestion(suggestion: string, reasons: string[] = ["mock reason"]) {
  vi.mocked(scoreHolding).mockReturnValue({ suggestion: suggestion as never, reasons });
}

const baseInput = {
  symbol: "TEST",
  currentPrice: 100,
  history: [],
  portfolioValue: 10_000,
  cash: 10_000,
};

describe("decide", () => {
  it("opens a new position sized to the target %, on STRONG_BUY with no existing position", () => {
    mockSuggestion("STRONG_BUY");
    const decision = decide({ ...baseInput, position: null });
    expect(decision.action).toBe("BUY");
    // 10% of a 10,000 portfolio at price 100 = 10 shares.
    expect(decision.quantity).toBeCloseTo(10);
  });

  it("caps the BUY size at available cash, not the target %, when cash is short", () => {
    mockSuggestion("STRONG_BUY");
    const decision = decide({ ...baseInput, position: null, cash: 500 });
    expect(decision.action).toBe("BUY");
    expect(decision.quantity).toBeCloseTo(5);
  });

  it("holds rather than adds to an existing position on STRONG_BUY", () => {
    mockSuggestion("STRONG_BUY");
    const decision = decide({ ...baseInput, position: { quantity: 5, avgBuyPrice: 90 } });
    expect(decision.action).toBe("HOLD");
    expect(decision.quantity).toBe(0);
  });

  it("sells the entire position on SELL_REVIEW", () => {
    mockSuggestion("SELL_REVIEW");
    const decision = decide({ ...baseInput, position: { quantity: 7, avgBuyPrice: 120 } });
    expect(decision.action).toBe("SELL");
    expect(decision.quantity).toBe(7);
  });

  it("does nothing on SELL_REVIEW if there's no position to sell", () => {
    mockSuggestion("SELL_REVIEW");
    const decision = decide({ ...baseInput, position: null });
    expect(decision.action).toBe("HOLD");
  });

  it("sells half the position on TRIM", () => {
    mockSuggestion("TRIM");
    const decision = decide({ ...baseInput, position: { quantity: 10, avgBuyPrice: 80 } });
    expect(decision.action).toBe("SELL");
    expect(decision.quantity).toBe(5);
  });

  it("exits the whole position on TRIM once it's a dust-sized sliver of the portfolio", () => {
    // qty 0.4 @ price 100 = 40 value, against a 10,000 portfolio = 0.4%,
    // under the 0.5% dust threshold - repeated TRIM signals on a
    // sustained trend would otherwise halve this forever (found via
    // backtest: MACD + SMA co-signaling TRIM for weeks straight).
    mockSuggestion("TRIM");
    const decision = decide({ ...baseInput, position: { quantity: 0.4, avgBuyPrice: 80 } });
    expect(decision.action).toBe("SELL");
    expect(decision.quantity).toBe(0.4);
  });

  it("takes no action on HOLD", () => {
    mockSuggestion("HOLD");
    const decision = decide({ ...baseInput, position: { quantity: 3, avgBuyPrice: 80 } });
    expect(decision.action).toBe("HOLD");
    expect(decision.quantity).toBe(0);
  });
});
