import { withCache } from "@/lib/cache/ttlCache";

// Fundamentals for Indian stocks, from two Yahoo endpoints:
//
//  - fundamentals-timeseries: annual + quarterly statement lines (P&L,
//    balance sheet, cash flow). Public, no auth.
//  - quoteSummary: key stats + company profile. Needs the cookie+crumb
//    handshake (see getYahooAuth). yahooProvider.ts avoids this path for
//    quotes because it gets rate-limited under load; here it's one call
//    per stock per hour (cached), and every field from it is optional -
//    the page still renders from the timeseries if it fails.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// --- cookie + crumb ---

let auth: { cookie: string; crumb: string; at: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000;

async function getYahooAuth(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && auth && Date.now() - auth.at < AUTH_TTL_MS) return auth;
  // fc.yahoo.com answers 404 but still sets the session cookie we need.
  const res = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual", cache: "no-store" });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Yahoo didn't return a session cookie");
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
    cache: "no-store",
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.includes("<")) throw new Error(`Yahoo crumb request failed: ${crumbRes.status}`);
  auth = { cookie, crumb, at: Date.now() };
  return auth;
}

// --- quoteSummary ---

export interface CompanySummary {
  name: string | null;
  marketCap: number | null; // ₹
  trailingPE: number | null;
  dividendYield: number | null; // fraction, 0.0058 = 0.58%
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  bookValue: number | null; // ₹ per share
  priceToBook: number | null;
  debtToEquity: number | null; // Yahoo reports as a percentage (95.4 = 0.95x)
  sector: string | null;
  industry: string | null;
  website: string | null;
  employees: number | null;
  businessSummary: string | null;
}

const raw = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const r = (v as { raw?: unknown }).raw;
  return typeof r === "number" && Number.isFinite(r) ? r : null;
};

async function fetchQuoteSummary(symbol: string): Promise<CompanySummary> {
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  for (const attempt of [0, 1]) {
    const { cookie, crumb } = await getYahooAuth(attempt === 1);
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
      { headers: { "User-Agent": UA, Cookie: cookie }, cache: "no-store" }
    );
    if (res.status === 401 && attempt === 0) continue; // stale crumb - refresh once
    if (!res.ok) throw new Error(`Yahoo quoteSummary failed: ${res.status}`);
    const r = (await res.json())?.quoteSummary?.result?.[0];
    if (!r) throw new Error(`No quoteSummary for ${symbol}`);
    const p = r.assetProfile ?? {};
    return {
      name: r.price?.longName ?? r.price?.shortName ?? null,
      marketCap: raw(r.summaryDetail?.marketCap) ?? raw(r.price?.marketCap),
      trailingPE: raw(r.summaryDetail?.trailingPE),
      dividendYield: raw(r.summaryDetail?.dividendYield),
      fiftyTwoWeekHigh: raw(r.summaryDetail?.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: raw(r.summaryDetail?.fiftyTwoWeekLow),
      bookValue: raw(r.defaultKeyStatistics?.bookValue),
      priceToBook: raw(r.defaultKeyStatistics?.priceToBook),
      debtToEquity: raw(r.financialData?.debtToEquity),
      sector: p.sector ?? null,
      industry: p.industry ?? null,
      website: p.website ?? null,
      employees: typeof p.fullTimeEmployees === "number" ? p.fullTimeEmployees : null,
      businessSummary: p.longBusinessSummary ?? null,
    };
  }
  throw new Error("unreachable");
}

export function getCompanySummary(symbol: string): Promise<CompanySummary> {
  return withCache(`yahoo:summary:${symbol}`, 3600, () => fetchQuoteSummary(symbol));
}

// --- statements timeseries ---

export const STATEMENT_FIELDS = [
  "TotalRevenue",
  "EBITDA",
  "OtherNonOperatingIncomeExpenses",
  "TotalUnusualItems", // exceptional items - Screener books these as Other Income
  "NormalizedIncome", // net profit excluding exceptional items
  "InterestExpense",
  "ReconciledDepreciation",
  "PretaxIncome",
  "TaxProvision",
  "NetIncome",
  "DilutedEPS",
  "CashDividendsPaid",
  "CommonStock",
  "StockholdersEquity",
  "TotalDebt",
  "TotalLiabilitiesNetMinorityInterest",
  "TotalAssets",
  "CurrentLiabilities",
  "NetPPE",
  "CashAndCashEquivalents",
  "OperatingCashFlow",
  "InvestingCashFlow",
  "FinancingCashFlow",
  "FreeCashFlow",
  "CapitalExpenditure",
] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];

// One period's values, keyed by field; missing lines are simply absent.
export interface StatementPeriod {
  date: string; // period end, YYYY-MM-DD
  values: Partial<Record<StatementField, number>>;
}

export interface Statements {
  annual: StatementPeriod[]; // oldest first
  quarterly: StatementPeriod[]; // oldest first
}

async function fetchTimeseries(symbol: string, prefix: "annual" | "quarterly"): Promise<StatementPeriod[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 8 * 365 * 86400;
  const types = STATEMENT_FIELDS.map((f) => prefix + f).join(",");
  const res = await fetch(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types}&period1=${period1}&period2=${period2}`,
    { headers: { "User-Agent": UA }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Yahoo timeseries failed: ${res.status}`);
  const results: any[] = (await res.json())?.timeseries?.result ?? [];

  const byDate = new Map<string, StatementPeriod>();
  for (const series of results) {
    const type: string = series?.meta?.type?.[0] ?? "";
    const field = type.slice(prefix.length) as StatementField;
    for (const point of series?.[type] ?? []) {
      const value = point?.reportedValue?.raw;
      if (!point?.asOfDate || typeof value !== "number") continue;
      const period: StatementPeriod = byDate.get(point.asOfDate) ?? { date: point.asOfDate, values: {} };
      period.values[field] = value;
      byDate.set(point.asOfDate, period);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function getStatements(symbol: string): Promise<Statements> {
  // Results change quarterly - a 6h cache is plenty.
  return withCache(`yahoo:statements:${symbol}`, 6 * 3600, async () => {
    const [annual, quarterly] = await Promise.all([
      fetchTimeseries(symbol, "annual"),
      fetchTimeseries(symbol, "quarterly"),
    ]);
    return { annual, quarterly };
  });
}

// --- price history for the detail chart ---

export type ChartRange = "1M" | "6M" | "1Y" | "3Y" | "5Y" | "MAX";
export interface ChartPoint {
  t: number; // epoch seconds
  close: number;
  volume: number;
}

const RANGE_CONFIG: Record<ChartRange, { days: number | null; interval: string }> = {
  "1M": { days: 31, interval: "1d" },
  "6M": { days: 183, interval: "1d" },
  "1Y": { days: 366, interval: "1d" },
  "3Y": { days: 3 * 366, interval: "1wk" },
  "5Y": { days: 5 * 366, interval: "1wk" },
  MAX: { days: null, interval: "1mo" },
};

export function getPriceHistory(symbol: string, range: ChartRange): Promise<ChartPoint[]> {
  const cfg = RANGE_CONFIG[range];
  return withCache(`yahoo:chart:${symbol}:${range}`, range === "1M" ? 600 : 3600, async () => {
    const period2 = Math.floor(Date.now() / 1000);
    const query = cfg.days
      ? `period1=${period2 - cfg.days * 86400}&period2=${period2}`
      : `range=max`;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}&interval=${cfg.interval}`,
      { headers: { "User-Agent": UA }, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`Yahoo chart failed: ${res.status}`);
    const result = (await res.json())?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    return ts.flatMap((t, i) => {
      const close = q.close?.[i];
      return typeof close === "number" ? [{ t, close, volume: q.volume?.[i] ?? 0 }] : [];
    });
  });
}
