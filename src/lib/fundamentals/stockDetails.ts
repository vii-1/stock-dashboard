import { yahooIndiaProvider } from "@/lib/providers/yahooProvider";
import { scoreHolding, type SuggestionResult } from "@/lib/suggestions/scoreHolding";
import { getCompanySummary, getStatements, type CompanySummary } from "./yahooFundamentals";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildProfitLoss,
  buildProsCons,
  buildRatios,
  latestReturnRatios,
  type StatementTable,
} from "./analysis";

export interface KeyRatio {
  label: string;
  value: number | null;
  value2?: number | null; // High / Low pairs
  unit: "cr" | "rs" | "pct" | "x";
  hint?: string;
}

export interface StockDetails {
  symbol: string; // RELIANCE.NS
  ticker: string; // RELIANCE
  exchange: "NSE" | "BSE";
  name: string;
  price: number;
  changePercent: number;
  asOf: string;
  profile: Pick<CompanySummary, "sector" | "industry" | "website" | "employees" | "businessSummary"> | null;
  keyRatios: KeyRatio[];
  quarters: StatementTable;
  profitLoss: StatementTable;
  balanceSheet: StatementTable;
  cashFlow: StatementTable;
  ratios: StatementTable;
  pros: string[];
  cons: string[];
  technical: SuggestionResult | null;
  warnings: string[]; // which optional sources failed
}

export const INDIAN_SYMBOL = /^[A-Z0-9&\-]{1,20}\.(NS|BO)$/;

/**
 * Everything the Screener-style panel shows for one NSE/BSE stock. The
 * live quote is required; company stats, statements and the technical
 * read are each optional, so one failing source shows up as a warning
 * rather than an error page.
 */
export async function getStockDetails(symbol: string): Promise<StockDetails> {
  const upper = symbol.toUpperCase();
  if (!INDIAN_SYMBOL.test(upper)) throw new Error(`Not an NSE/BSE symbol: ${symbol}`);

  const warnings: string[] = [];
  const [quote, summary, statements, history] = await Promise.all([
    yahooIndiaProvider.getQuote(upper),
    getCompanySummary(upper).catch((err) => {
      console.error(`quoteSummary failed for ${upper}`, err);
      warnings.push("Valuation stats (market cap, P/E, book value) are unavailable right now.");
      return null;
    }),
    getStatements(upper).catch((err) => {
      console.error(`Statements failed for ${upper}`, err);
      warnings.push("Financial statements are unavailable right now.");
      return { annual: [], quarterly: [] };
    }),
    yahooIndiaProvider.getHistory(upper, 120).catch(() => []),
  ]);

  const { annual, quarterly } = statements;
  const ret = latestReturnRatios(annual);
  const fy = ret.periodLabel ? `FY ending ${ret.periodLabel}` : undefined;
  const oneOffHint = (reported: number | null) =>
    ret.excludesOneOffs
      ? `${fy}, excluding one-off items (reported: ${reported == null ? "--" : reported.toFixed(1) + "%"})`
      : fy;
  const lastAnnual = annual[annual.length - 1];
  // TTM EPS = sum of the last four quarters, when Yahoo has four in a row.
  const lastFour = quarterly.slice(-4);
  const ttmEps =
    lastFour.length === 4 && lastFour.every((p) => typeof p.values.DilutedEPS === "number")
      ? lastFour.reduce((s, p) => s + (p.values.DilutedEPS as number), 0)
      : null;

  const keyRatios: KeyRatio[] = [
    { label: "Market Cap", value: summary?.marketCap != null ? summary.marketCap / 1e7 : null, unit: "cr" },
    { label: "Current Price", value: quote.price, unit: "rs" },
    { label: "High / Low", value: summary?.fiftyTwoWeekHigh ?? null, value2: summary?.fiftyTwoWeekLow ?? null, unit: "rs", hint: "52-week" },
    { label: "Stock P/E", value: summary?.trailingPE ?? (ttmEps ? quote.price / ttmEps : null), unit: "x" },
    { label: "Book Value", value: summary?.bookValue ?? null, unit: "rs", hint: "per share" },
    { label: "Dividend Yield", value: summary?.dividendYield != null ? summary.dividendYield * 100 : null, unit: "pct" },
    { label: "ROCE", value: ret.roce, unit: "pct", hint: oneOffHint(ret.reportedRoce) },
    { label: "ROE", value: ret.roe, unit: "pct", hint: oneOffHint(ret.reportedRoe) },
    { label: "Price to Book", value: summary?.priceToBook ?? null, unit: "x" },
    // From the latest balance sheet (same basis as the pros/cons), falling
    // back to Yahoo's figure only if the statements lack debt or equity.
    {
      label: "Debt / Equity",
      value: ret.debtToEquity ?? (summary?.debtToEquity != null ? summary.debtToEquity / 100 : null),
      unit: "x",
      hint: ret.debtToEquity != null && ret.periodLabel ? `Balance sheet, ${ret.periodLabel}` : undefined,
    },
    { label: "EPS (TTM)", value: ttmEps, unit: "rs" },
    {
      label: "Net Profit (FY)",
      value: lastAnnual?.values.NetIncome != null ? lastAnnual.values.NetIncome / 1e7 : null,
      unit: "cr",
    },
  ];

  const { pros, cons } = buildProsCons({
    annual,
    quarterly,
    priceToBook: summary?.priceToBook ?? null,
    dividendYield: summary?.dividendYield ?? null,
  });

  let technical: SuggestionResult | null = null;
  if (history.length > 30) {
    // Same engine as the portfolio badges, with no position: buy price =
    // current price and zero weight, so only the market signals count.
    technical = scoreHolding({ avgBuyPrice: quote.price, currentPrice: quote.price, history, portfolioWeightPct: 0 });
  }

  return {
    symbol: upper,
    ticker: upper.replace(/\.(NS|BO)$/, ""),
    exchange: upper.endsWith(".BO") ? "BSE" : "NSE",
    name: summary?.name ?? quote.displayName,
    price: quote.price,
    changePercent: quote.changePercent,
    asOf: quote.asOf,
    profile: summary
      ? {
          sector: summary.sector,
          industry: summary.industry,
          website: summary.website,
          employees: summary.employees,
          businessSummary: summary.businessSummary,
        }
      : null,
    keyRatios,
    quarters: buildProfitLoss(quarterly, { annual: false }),
    profitLoss: buildProfitLoss(annual, { annual: true }),
    balanceSheet: buildBalanceSheet(annual),
    cashFlow: buildCashFlow(annual),
    ratios: buildRatios(annual),
    pros,
    cons,
    technical,
    warnings,
  };
}
