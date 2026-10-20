import { describe, expect, it } from "vitest";
import { buildProfitLoss, buildProsCons, buildRatios, cagr, latestReturnRatios, periodLabel } from "./analysis";
import type { StatementPeriod } from "./yahooFundamentals";

const CR = 1e7;

// Shaped like JSW Steel's Jun 2026 quarter from Yahoo's timeseries.
const q: StatementPeriod = {
  date: "2026-06-30",
  values: {
    TotalRevenue: 46662 * CR,
    EBITDA: 10009 * CR,
    OtherNonOperatingIncomeExpenses: 724 * CR,
    PretaxIncome: 6160 * CR,
    TaxProvision: 1464 * CR,
    NetIncome: 4651 * CR,
    DilutedEPS: 19.02,
  },
};

describe("periodLabel", () => {
  it("formats period ends like Screener", () => {
    expect(periodLabel("2026-03-31")).toBe("Mar 2026");
  });
});

describe("buildProfitLoss", () => {
  it("derives Screener's operating profit as EBITDA minus other income", () => {
    const t = buildProfitLoss([q], { annual: false });
    const op = t.rows.find((r) => r.label === "Operating Profit")!;
    expect(op.values[0]).toBeCloseTo(9285);
    const expenses = t.rows.find((r) => r.label === "Expenses")!;
    expect(expenses.values[0]).toBeCloseTo(46662 - 9285);
    const tax = t.rows.find((r) => r.label === "Tax %")!;
    expect(tax.values[0]).toBeCloseTo((1464 / 6160) * 100);
  });

  it("drops rows with no data at all", () => {
    const t = buildProfitLoss([q], { annual: false });
    expect(t.rows.find((r) => r.label === "Interest")).toBeUndefined();
  });
});

describe("cagr", () => {
  it("computes compound growth between first and last points", () => {
    expect(cagr([100, null, 121])!.pct).toBeCloseTo(10);
    expect(cagr([100, null, 121])!.years).toBe(2);
  });
  it("needs two positive points", () => {
    expect(cagr([null, 5])).toBeNull();
    expect(cagr([-1, 5])).toBeNull();
  });
});

const annual = (year: number, rev: number, ni: number, eq: number, debt: number): StatementPeriod => ({
  date: `${year}-03-31`,
  values: {
    TotalRevenue: rev * CR,
    NetIncome: ni * CR,
    StockholdersEquity: eq * CR,
    TotalDebt: debt * CR,
    PretaxIncome: ni * 1.3 * CR,
    InterestExpense: 10 * CR,
    FreeCashFlow: 50 * CR,
  },
});

describe("buildRatios", () => {
  it("uses average equity for ROE", () => {
    const t = buildRatios([annual(2025, 1000, 100, 400, 100), annual(2026, 1100, 120, 600, 100)]);
    const roe = t.rows.find((r) => r.label === "ROE %")!;
    expect(roe.values[1]).toBeCloseTo((120 / 500) * 100);
  });
});

describe("buildProsCons", () => {
  it("flags a growing, low-debt, cash-generating company as pros", () => {
    const years = [annual(2023, 1000, 150, 600, 50), annual(2024, 1200, 190, 700, 50), annual(2025, 1450, 240, 850, 50), annual(2026, 1750, 300, 1000, 50)];
    const { pros, cons } = buildProsCons({ annual: years, quarterly: [], priceToBook: 2, dividendYield: 0.01 });
    expect(pros.some((p) => p.includes("debt-free"))).toBe(true);
    expect(pros.some((p) => p.includes("Sales grew"))).toBe(true);
    expect(pros.some((p) => p.includes("free cash flow"))).toBe(true);
    expect(cons).toEqual([]);
  });

  it("flags expensive valuation and leverage as cons", () => {
    const years = [annual(2025, 1000, 40, 400, 800), annual(2026, 1010, 30, 400, 800)];
    const { cons } = buildProsCons({ annual: years, quarterly: [], priceToBook: 4.2, dividendYield: 0 });
    expect(cons.some((c) => c.includes("4.20 times its book value"))).toBe(true);
    expect(cons.some((c) => c.includes("High leverage"))).toBe(true);
    expect(cons.some((c) => c.includes("Low return on equity"))).toBe(true);
  });
});

describe("exceptional items", () => {
  it("moves Yahoo's unusual items from operating profit into other income, like Screener", () => {
    // JSW Steel Mar 2026 quarter.
    const p: StatementPeriod = {
      date: "2026-03-31",
      values: { TotalRevenue: 49798 * CR, EBITDA: 26693 * CR, OtherNonOperatingIncomeExpenses: 341 * CR, TotalUnusualItems: 17888 * CR },
    };
    const t = buildProfitLoss([p], { annual: false });
    expect(t.rows.find((r) => r.label === "Other Income")!.values[0]).toBeCloseTo(18229);
    expect(t.rows.find((r) => r.label === "Operating Profit")!.values[0]).toBeCloseTo(8464);
  });
});

describe("latestReturnRatios", () => {
  it("reports ROE excluding a large one-off gain, keeping the reported value", () => {
    const year = (y: number, eq: number, ni: number, normalized: number, unusual: number): StatementPeriod => ({
      date: `${y}-03-31`,
      values: {
        StockholdersEquity: eq * CR,
        NetIncome: ni * CR,
        NormalizedIncome: normalized * CR,
        TotalUnusualItems: unusual * CR,
        PretaxIncome: (ni + 3000) * CR,
        TotalDebt: 119079 * CR,
      },
    });
    // JSW Steel FY25 -> FY26 shape.
    const r = latestReturnRatios([year(2025, 79496, 3504, 3899, -574), year(2026, 100053, 22316, 6946, 17624)]);
    expect(r.excludesOneOffs).toBe(true);
    expect(r.roe).toBeCloseTo((6946 / ((79496 + 100053) / 2)) * 100, 1);
    expect(r.reportedRoe).toBeCloseTo((22316 / ((79496 + 100053) / 2)) * 100, 1);
    expect(r.debtToEquity).toBeCloseTo(119079 / 100053, 3);
  });
});
