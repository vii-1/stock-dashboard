import { describe, expect, it } from "vitest";
import {
  checkTrade,
  DEFAULT_RISK_LIMITS,
  freshRiskState,
  isNseMarketOpen,
  nseHoliday,
  isQuoteStale,
  isStopLossBreached,
  recordTrade,
  resetDailyCounters,
  tripKillSwitch,
} from "./riskManager";

describe("checkTrade", () => {
  it("blocks everything when the kill switch is active", () => {
    const state = tripKillSwitch(freshRiskState(), "test trip");
    const result = checkTrade(
      { action: "BUY", quantity: 1, price: 100, portfolioValue: 10_000, existingPositionValue: 0 },
      state
    );
    expect(result.allowed).toBe(false);
    expect(result.blockReason).toContain("Kill switch");
  });

  it("blocks once the daily trade count cap is reached", () => {
    const state = { ...freshRiskState(), tradesToday: DEFAULT_RISK_LIMITS.maxTradesPerDay };
    const result = checkTrade(
      { action: "BUY", quantity: 1, price: 100, portfolioValue: 10_000, existingPositionValue: 0 },
      state
    );
    expect(result.allowed).toBe(false);
    expect(result.blockReason).toContain("Max trades per day");
  });

  it("blocks a BUY that would push the position over the max position cap", () => {
    // 10 shares @ 100 = 1000, against a 5000 portfolio = 20%, over the default 10% cap.
    const result = checkTrade(
      { action: "BUY", quantity: 10, price: 100, portfolioValue: 5_000, existingPositionValue: 0 },
      freshRiskState()
    );
    expect(result.allowed).toBe(false);
    expect(result.blockReason).toContain("cap");
  });

  it("allows a BUY that stays within the max position cap", () => {
    // 1 share @ 100 = 100, against a 5000 portfolio = 2%, under the 10% cap.
    const result = checkTrade(
      { action: "BUY", quantity: 1, price: 100, portfolioValue: 5_000, existingPositionValue: 0 },
      freshRiskState()
    );
    expect(result.allowed).toBe(true);
    expect(result.blockReason).toBeNull();
  });

  it("blocks any trade once the daily loss cap has been hit", () => {
    // 2% of 10,000 already lost - at the default cap.
    const state = { ...freshRiskState(), realizedLossToday: 200 };
    const result = checkTrade(
      { action: "SELL", quantity: 1, price: 100, portfolioValue: 10_000, existingPositionValue: 100 },
      state
    );
    expect(result.allowed).toBe(false);
    expect(result.blockReason).toContain("Daily realized loss");
  });

  it("does not apply the position cap to SELL orders", () => {
    // A SELL that's nominally "over 10%" should never be blocked by the position-size rule.
    const result = checkTrade(
      { action: "SELL", quantity: 10, price: 100, portfolioValue: 5_000, existingPositionValue: 1_000 },
      freshRiskState()
    );
    expect(result.allowed).toBe(true);
  });
});

describe("recordTrade", () => {
  it("increments the trade count regardless of profit or loss", () => {
    const state = recordTrade(freshRiskState(), 0, DEFAULT_RISK_LIMITS, 10_000);
    expect(state.tradesToday).toBe(1);
  });

  it("accumulates realized losses but ignores profits", () => {
    let state = recordTrade(freshRiskState(), -50, DEFAULT_RISK_LIMITS, 10_000);
    expect(state.realizedLossToday).toBe(50);
    state = recordTrade(state, 200, DEFAULT_RISK_LIMITS, 10_000);
    expect(state.realizedLossToday).toBe(50);
  });

  it("auto-trips the kill switch once accumulated losses hit the daily cap", () => {
    // Cap is 2% of portfolio; a single 300-loss trade on a 10,000 portfolio is 3%.
    const state = recordTrade(freshRiskState(), -300, DEFAULT_RISK_LIMITS, 10_000);
    expect(state.killSwitchActive).toBe(true);
    expect(state.killSwitchReason).toContain("Daily realized loss");
  });

  it("does not trip the kill switch while losses stay under the cap", () => {
    const state = recordTrade(freshRiskState(), -50, DEFAULT_RISK_LIMITS, 10_000);
    expect(state.killSwitchActive).toBe(false);
  });
});

describe("resetDailyCounters", () => {
  it("clears trade count and realized loss but leaves the kill switch untouched", () => {
    const tripped = tripKillSwitch(
      { ...freshRiskState(), tradesToday: 5, realizedLossToday: 300 },
      "manual"
    );
    const reset = resetDailyCounters(tripped);
    expect(reset.tradesToday).toBe(0);
    expect(reset.realizedLossToday).toBe(0);
    expect(reset.killSwitchActive).toBe(true);
    expect(reset.killSwitchReason).toBe("manual");
  });
});

describe("isStopLossBreached", () => {
  it("is false above the stop-loss level", () => {
    expect(isStopLossBreached(100, 95, 8)).toBe(false);
  });

  it("is true at or below the stop-loss level", () => {
    expect(isStopLossBreached(100, 92, 8)).toBe(true);
    expect(isStopLossBreached(100, 85, 8)).toBe(true);
  });
});

describe("isQuoteStale", () => {
  it("is false for a quote fetched just now", () => {
    expect(isQuoteStale(new Date().toISOString(), 5)).toBe(false);
  });

  it("is true for a quote well past the staleness threshold", () => {
    const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isQuoteStale(old, 5)).toBe(true);
  });
});

describe("isNseMarketOpen", () => {
  it("is false on a weekend", () => {
    // 2026-09-27 is a Sunday.
    const sunday = new Date("2026-09-27T10:00:00+05:30");
    expect(isNseMarketOpen(sunday)).toBe(false);
  });

  it("is false on an NSE holiday that falls on a weekday", () => {
    // 2026-10-20 is a Tuesday - Dussehra.
    const dussehra = new Date("2026-10-20T11:00:00+05:30");
    expect(isNseMarketOpen(dussehra)).toBe(false);
    expect(nseHoliday(dussehra)).toBe("Dussehra");
  });

  it("resolves the holiday by IST date, not UTC", () => {
    // 00:30 IST on 2026-10-20 is still 2026-10-19 in UTC.
    expect(nseHoliday(new Date("2026-10-20T00:30:00+05:30"))).toBe("Dussehra");
    expect(nseHoliday(new Date("2026-10-21T11:00:00+05:30"))).toBeNull();
  });

  it("is true during regular trading hours on a weekday", () => {
    // 2026-09-22 is a Tuesday, 11:00 IST is well within the session.
    const midSession = new Date("2026-09-22T11:00:00+05:30");
    expect(isNseMarketOpen(midSession)).toBe(true);
  });

  it("is false before the session opens", () => {
    const preOpen = new Date("2026-09-22T09:00:00+05:30");
    expect(isNseMarketOpen(preOpen)).toBe(false);
  });

  it("is false after the session closes", () => {
    const afterClose = new Date("2026-09-22T16:00:00+05:30");
    expect(isNseMarketOpen(afterClose)).toBe(false);
  });
});
