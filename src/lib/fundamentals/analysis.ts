import type { StatementField, StatementPeriod } from "./yahooFundamentals";

// Pure, testable shaping of raw statement lines into Screener-style
// tables, headline ratios, and rule-based pros/cons. Money is scaled to
// how each market reads statements: ₹ crores for India, $ millions for
// the US (Yahoo reports raw rupees / dollars).

// "money" = scaled statement amount (crores / millions); "perShare" = EPS etc.
export type RowUnit = "money" | "pct" | "perShare" | "x";

export interface MoneyScale {
  currency: "INR" | "USD";
  divisor: number;
  label: string; // "Cr" | "M"
  longLabel: string; // "₹ Crores" | "$ Millions"
  locale: string; // en-IN groups 1,00,000; en-US 100,000
}

export const SCALE_INR: MoneyScale = { currency: "INR", divisor: 1e7, label: "Cr", longLabel: "₹ Crores", locale: "en-IN" };
export const SCALE_USD: MoneyScale = { currency: "USD", divisor: 1e6, label: "M", longLabel: "$ Millions", locale: "en-US" };

export interface StatementRow {
  label: string;
  unit: RowUnit;
  values: (number | null)[];
  emphasis?: boolean; // subtotal rows (Operating Profit, PBT, Net Profit)
  hint?: string; // how a derived row was computed
}

export interface StatementTable {
  periods: string[]; // display labels, oldest first ("Mar 2026")
  rows: StatementRow[];
  locale: string; // number grouping for this market
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function v(p: StatementPeriod, f: StatementField): number | null {
  const x = p.values[f];
  return typeof x === "number" ? x : null;
}
const scaler = (scale: MoneyScale) => (x: number | null) => (x == null ? null : x / scale.divisor);
const sub = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
const pct = (num: number | null, den: number | null) => (num == null || den == null || den === 0 ? null : (num / den) * 100);

// Screener books exceptional items under Other Income; Yahoo folds them
// into EBITDA. Reclassify so both match Screener (checked on JSW Steel
// Mar 2026: other income 341 + 17,888 = 18,229 Cr; operating profit
// 26,693 - 18,229 = 8,464 Cr - both exactly Screener's figures).
function otherIncome(p: StatementPeriod): number | null {
  const other = v(p, "OtherNonOperatingIncomeExpenses");
  const unusual = v(p, "TotalUnusualItems");
  if (other == null && unusual == null) return null;
  return (other ?? 0) + (unusual ?? 0);
}

function operatingProfit(p: StatementPeriod): number | null {
  const ebitda = v(p, "EBITDA");
  if (ebitda == null) return null;
  return ebitda - (otherIncome(p) ?? 0);
}

/** Quarterly results / annual P&L in Screener's row order. */
export function buildProfitLoss(periods: StatementPeriod[], opts: { annual: boolean; scale?: MoneyScale }): StatementTable {
  const scale = opts.scale ?? SCALE_INR;
  const cr = scaler(scale);
  const rows: StatementRow[] = [
    { label: "Sales", unit: "money", values: periods.map((p) => cr(v(p, "TotalRevenue"))) },
    {
      label: "Expenses",
      unit: "money",
      values: periods.map((p) => cr(sub(v(p, "TotalRevenue"), operatingProfit(p)))),
      hint: "Sales - Operating Profit",
    },
    { label: "Operating Profit", unit: "money", emphasis: true, values: periods.map((p) => cr(operatingProfit(p))) },
    { label: "OPM %", unit: "pct", values: periods.map((p) => pct(operatingProfit(p), v(p, "TotalRevenue"))) },
    {
      label: "Other Income",
      unit: "money",
      values: periods.map((p) => cr(otherIncome(p))),
      hint: "Includes exceptional / one-off items",
    },
    { label: "Interest", unit: "money", values: periods.map((p) => cr(v(p, "InterestExpense"))) },
    { label: "Depreciation", unit: "money", values: periods.map((p) => cr(v(p, "ReconciledDepreciation"))) },
    { label: "Profit before tax", unit: "money", emphasis: true, values: periods.map((p) => cr(v(p, "PretaxIncome"))) },
    { label: "Tax %", unit: "pct", values: periods.map((p) => pct(v(p, "TaxProvision"), v(p, "PretaxIncome"))) },
    { label: "Net Profit", unit: "money", emphasis: true, values: periods.map((p) => cr(v(p, "NetIncome"))) },
    { label: "EPS in Rs", unit: "perShare", values: periods.map((p) => v(p, "DilutedEPS")) },
  ];
  if (opts.annual) {
    rows.push({
      label: "Dividend Payout %",
      unit: "pct",
      values: periods.map((p) => {
        const paid = v(p, "CashDividendsPaid");
        return paid == null ? null : pct(Math.abs(paid), v(p, "NetIncome"));
      }),
      hint: "Dividends paid in the year / net profit",
    });
  }
  return { periods: periods.map((p) => periodLabel(p.date)), rows: dropEmptyRows(rows), locale: scale.locale };
}

export function buildBalanceSheet(periods: StatementPeriod[], scale: MoneyScale = SCALE_INR): StatementTable {
  const cr = scaler(scale);
  const rows: StatementRow[] = [
    { label: "Equity Capital", unit: "money", values: periods.map((p) => cr(v(p, "CommonStock"))) },
    {
      label: "Reserves",
      unit: "money",
      values: periods.map((p) => cr(sub(v(p, "StockholdersEquity"), v(p, "CommonStock")))),
    },
    { label: "Borrowings", unit: "money", values: periods.map((p) => cr(v(p, "TotalDebt"))) },
    {
      label: "Other Liabilities",
      unit: "money",
      values: periods.map((p) => cr(sub(v(p, "TotalLiabilitiesNetMinorityInterest"), v(p, "TotalDebt")))),
    },
    { label: "Total Liabilities", unit: "money", emphasis: true, values: periods.map((p) => cr(v(p, "TotalAssets"))), hint: "Equals total assets" },
    { label: "Fixed Assets", unit: "money", values: periods.map((p) => cr(v(p, "NetPPE"))) },
    { label: "Cash & Equivalents", unit: "money", values: periods.map((p) => cr(v(p, "CashAndCashEquivalents"))) },
    {
      label: "Other Assets",
      unit: "money",
      values: periods.map((p) => {
        const total = v(p, "TotalAssets");
        if (total == null) return null;
        return cr(total - (v(p, "NetPPE") ?? 0) - (v(p, "CashAndCashEquivalents") ?? 0));
      }),
    },
    { label: "Total Assets", unit: "money", emphasis: true, values: periods.map((p) => cr(v(p, "TotalAssets"))) },
  ];
  return { periods: periods.map((p) => periodLabel(p.date)), rows: dropEmptyRows(rows), locale: scale.locale };
}

export function buildCashFlow(periods: StatementPeriod[], scale: MoneyScale = SCALE_INR): StatementTable {
  const cr = scaler(scale);
  const rows: StatementRow[] = [
    { label: "Cash from Operating Activity", unit: "money", values: periods.map((p) => cr(v(p, "OperatingCashFlow"))) },
    { label: "Cash from Investing Activity", unit: "money", values: periods.map((p) => cr(v(p, "InvestingCashFlow"))) },
    { label: "Cash from Financing Activity", unit: "money", values: periods.map((p) => cr(v(p, "FinancingCashFlow"))) },
    {
      label: "Net Cash Flow",
      unit: "money",
      emphasis: true,
      values: periods.map((p) => {
        const parts = [v(p, "OperatingCashFlow"), v(p, "InvestingCashFlow"), v(p, "FinancingCashFlow")];
        return parts.some((x) => x == null) ? null : cr(parts.reduce((a, b) => a! + b!, 0));
      }),
    },
    { label: "Capex", unit: "money", values: periods.map((p) => cr(v(p, "CapitalExpenditure"))) },
    { label: "Free Cash Flow", unit: "money", emphasis: true, values: periods.map((p) => cr(v(p, "FreeCashFlow"))) },
  ];
  return { periods: periods.map((p) => periodLabel(p.date)), rows: dropEmptyRows(rows), locale: scale.locale };
}

// EBIT for ROCE / interest cover: profit before tax + interest.
function ebit(p: StatementPeriod): number | null {
  const pbt = v(p, "PretaxIncome");
  return pbt == null ? null : pbt + (v(p, "InterestExpense") ?? 0);
}

function averaged(periods: StatementPeriod[], i: number, f: (p: StatementPeriod) => number | null): number | null {
  const now = f(periods[i]);
  const prev = i > 0 ? f(periods[i - 1]) : null;
  if (now == null) return null;
  return prev == null ? now : (now + prev) / 2;
}

const capitalEmployed = (p: StatementPeriod) => sub(v(p, "TotalAssets"), v(p, "CurrentLiabilities"));

export function buildRatios(periods: StatementPeriod[], scale: MoneyScale = SCALE_INR): StatementTable {
  const growth = (f: StatementField) =>
    periods.map((p, i) => (i === 0 ? null : pct(sub(v(p, f), v(periods[i - 1], f)), Math.abs(v(periods[i - 1], f) ?? NaN))));
  const rows: StatementRow[] = [
    { label: "Sales Growth %", unit: "pct", values: growth("TotalRevenue") },
    { label: "Profit Growth %", unit: "pct", values: growth("NetIncome") },
    { label: "OPM %", unit: "pct", values: periods.map((p) => pct(operatingProfit(p), v(p, "TotalRevenue"))) },
    { label: "Net Margin %", unit: "pct", values: periods.map((p) => pct(v(p, "NetIncome"), v(p, "TotalRevenue"))) },
    {
      label: "ROE %",
      unit: "pct",
      values: periods.map((p, i) => pct(v(p, "NetIncome"), averaged(periods, i, (q) => v(q, "StockholdersEquity")))),
      hint: "Net profit / average shareholders' equity",
    },
    {
      label: "ROCE %",
      unit: "pct",
      values: periods.map((p, i) => pct(ebit(p), averaged(periods, i, capitalEmployed))),
      hint: "EBIT / average (total assets - current liabilities)",
    },
    {
      label: "Debt / Equity",
      unit: "x",
      values: periods.map((p) => {
        const d = v(p, "TotalDebt");
        const e = v(p, "StockholdersEquity");
        return d == null || !e ? null : d / e;
      }),
    },
    {
      label: "Interest Coverage",
      unit: "x",
      values: periods.map((p) => {
        const i = v(p, "InterestExpense");
        const e = ebit(p);
        return e == null || !i ? null : e / i;
      }),
      hint: "EBIT / interest",
    },
  ];
  return { periods: periods.map((p) => periodLabel(p.date)), rows: dropEmptyRows(rows), locale: scale.locale };
}

function dropEmptyRows(rows: StatementRow[]): StatementRow[] {
  return rows.filter((r) => r.values.some((x) => x != null && Number.isFinite(x)));
}

/** Compound annual growth between first and last non-null values, in %. */
export function cagr(values: (number | null)[]): { pct: number; years: number } | null {
  const pts = values.map((x, i) => [i, x] as const).filter(([, x]) => x != null && x > 0) as [number, number][];
  if (pts.length < 2) return null;
  const [i0, a] = pts[0];
  const [i1, b] = pts[pts.length - 1];
  const years = i1 - i0;
  if (years <= 0) return null;
  return { pct: (Math.pow(b / a, 1 / years) - 1) * 100, years };
}

export interface ProsCons {
  pros: string[];
  cons: string[];
}

/**
 * Rule-based pros/cons, in the spirit of Screener's machine-generated
 * ones. Every rule only fires when its inputs exist, and states the
 * number behind it so it can be checked against the tables.
 */
export function buildProsCons(input: {
  annual: StatementPeriod[];
  quarterly: StatementPeriod[];
  priceToBook: number | null;
  dividendYield: number | null; // fraction
  scale?: MoneyScale;
}): ProsCons {
  const { annual, quarterly } = input;
  const scale = input.scale ?? SCALE_INR;
  const money = (raw: number) =>
    `${scale.currency === "INR" ? "₹" : "$"}${Math.round(raw / scale.divisor).toLocaleString(scale.locale)} ${scale.label}`;
  const pros: string[] = [];
  const cons: string[] = [];
  const last = annual[annual.length - 1];
  const fmt = (x: number, d = 1) => x.toFixed(d);

  const ratios = buildRatios(annual);
  const roe = ratios.rows.find((r) => r.label === "ROE %")?.values.filter((x): x is number => x != null) ?? [];
  if (roe.length) {
    const avg = roe.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, roe.length);
    const yrs = Math.min(3, roe.length);
    if (avg >= 15) pros.push(`Strong return on equity: ${fmt(avg)}% average over the last ${yrs} years.`);
    else if (avg < 10) cons.push(`Low return on equity: ${fmt(avg)}% average over the last ${yrs} years.`);
  }

  if (last) {
    const debt = v(last, "TotalDebt");
    const eq = v(last, "StockholdersEquity");
    if (debt != null && eq) {
      const de = debt / eq;
      if (de < 0.3) pros.push(`Almost debt-free: debt is only ${fmt(de, 2)}x equity.`);
      else if (de > 1) cons.push(`High leverage: debt is ${fmt(de, 2)}x equity.`);
    }
    const i = v(last, "InterestExpense");
    const e = ebit(last);
    if (i && e != null && e / i < 3) cons.push(`Thin interest cover: operating profit covers interest only ${fmt(e / i)}x.`);

    const other = otherIncome(last);
    const pbt = v(last, "PretaxIncome");
    if (other != null && pbt && pbt > 0 && other / pbt > 0.25) {
      cons.push(`Other income is ${fmt((other / pbt) * 100, 0)}% of profit before tax (${money(other)}).`);
    }

    const paid = v(last, "CashDividendsPaid");
    const ni = v(last, "NetIncome");
    if (paid != null && ni && ni > 0) {
      const payout = (Math.abs(paid) / ni) * 100;
      if (payout >= 15) pros.push(`Healthy dividend payout of ${fmt(payout)}%.`);
    } else if (paid == null && ni && ni > 0 && (input.dividendYield ?? 0) === 0) {
      cons.push("Company is not paying a dividend.");
    }
  }

  const sales = cagr(annual.map((p) => v(p, "TotalRevenue")));
  if (sales && sales.years >= 2) {
    if (sales.pct >= 12) pros.push(`Sales grew ${fmt(sales.pct)}% a year over ${sales.years} years.`);
    else if (sales.pct < 5) cons.push(`Slow sales growth: ${fmt(sales.pct)}% a year over ${sales.years} years.`);
  }
  // Growth on profit excluding one-offs, so an exceptional gain in the
  // latest year doesn't read as a growth trend.
  const profit = cagr(annual.map((p) => v(p, "NormalizedIncome") ?? v(p, "NetIncome")));
  if (profit && profit.years >= 2 && profit.pct >= 15) {
    pros.push(`Net profit (excluding one-offs) grew ${fmt(profit.pct)}% a year over ${profit.years} years.`);
  }

  const fcf = annual.map((p) => v(p, "FreeCashFlow")).filter((x): x is number => x != null);
  if (fcf.length >= 3) {
    if (fcf.every((x) => x > 0)) pros.push(`Positive free cash flow in each of the last ${fcf.length} years.`);
    else if (fcf.filter((x) => x < 0).length >= 2) cons.push(`Negative free cash flow in ${fcf.filter((x) => x < 0).length} of the last ${fcf.length} years.`);
  }

  if (input.priceToBook != null && input.priceToBook > 3) {
    cons.push(`Stock is trading at ${fmt(input.priceToBook, 2)} times its book value.`);
  }

  // Latest quarter vs the same quarter a year earlier (if Yahoo has it).
  const q = quarterly[quarterly.length - 1];
  if (q) {
    const [y, m] = q.date.split("-");
    const yearAgo = quarterly.find((p) => p.date.startsWith(`${Number(y) - 1}-${m}`));
    const now = v(q, "NetIncome");
    const then = yearAgo ? v(yearAgo, "NetIncome") : null;
    if (now != null && then != null && then > 0) {
      const g = ((now - then) / then) * 100;
      const label = periodLabel(q.date);
      if (g >= 20) pros.push(`${label} quarter net profit up ${fmt(g, 0)}% year-on-year.`);
      else if (g <= -20) cons.push(`${label} quarter net profit down ${fmt(Math.abs(g), 0)}% year-on-year.`);
    }
  }

  return { pros, cons };
}

export interface HeadlineReturns {
  roe: number | null;
  roce: number | null;
  debtToEquity: number | null;
  // True when the latest year had big one-offs (>25% of PBT) and ROE /
  // ROCE were computed without them; reported* hold the as-reported values.
  excludesOneOffs: boolean;
  reportedRoe: number | null;
  reportedRoce: number | null;
  periodLabel: string | null;
}

/**
 * Headline ROE / ROCE / D-E from the latest annual statements (Yahoo's own
 * ROE is often blank for NSE stocks). A year with a large exceptional
 * gain would otherwise show a misleading ROE (JSW Steel FY26: 24.9%
 * reported vs ~7.7% excluding its ₹17,624 Cr one-off), so in that case
 * the normalised figures lead and the reported ones go in the hint.
 */
export function latestReturnRatios(annual: StatementPeriod[]): HeadlineReturns {
  const n = annual.length;
  const last = annual[n - 1];
  if (!last) {
    return { roe: null, roce: null, debtToEquity: null, excludesOneOffs: false, reportedRoe: null, reportedRoce: null, periodLabel: null };
  }
  const ratios = buildRatios(annual);
  const lastOf = (label: string) => {
    const vals = ratios.rows.find((r) => r.label === label)?.values ?? [];
    return vals.length ? vals[vals.length - 1] : null;
  };
  const reportedRoe = lastOf("ROE %");
  const reportedRoce = lastOf("ROCE %");

  const unusual = v(last, "TotalUnusualItems");
  const pbt = v(last, "PretaxIncome");
  const excludesOneOffs = unusual != null && pbt != null && pbt !== 0 && Math.abs(unusual / pbt) > 0.25;

  let roe = reportedRoe;
  let roce = reportedRoce;
  if (excludesOneOffs) {
    const normalized = v(last, "NormalizedIncome");
    roe = normalized == null ? null : pct(normalized, averaged(annual, n - 1, (q) => v(q, "StockholdersEquity")));
    const e = ebit(last);
    roce = e == null ? null : pct(e - unusual!, averaged(annual, n - 1, capitalEmployed));
  }

  const debt = v(last, "TotalDebt");
  const eq = v(last, "StockholdersEquity");
  return {
    roe,
    roce,
    debtToEquity: debt != null && eq ? debt / eq : null,
    excludesOneOffs,
    reportedRoe,
    reportedRoce,
    periodLabel: periodLabel(last.date),
  };
}
