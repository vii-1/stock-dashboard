import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { scoreHolding, type SuggestionResult } from "@/lib/suggestions/scoreHolding";
import { getCompanySummary, getStatements, type CompanySummary } from "./yahooFundamentals";
import {
  SCALE_INR,
  SCALE_USD,
  buildBalanceSheet,
  buildCashFlow,
  buildProfitLoss,
  buildProsCons,
  buildRatios,
  latestReturnRatios,
  periodLabel,
  type MoneyScale,
  type StatementTable,
} from "./analysis";
import { isIndianSymbol, STOCK_SYMBOL } from "./paths";

export interface KeyRatio {
  label: string;
  value: number | null;
  value2?: number | null; // High / Low pairs
  // "money" = already in the scale's unit (crores / millions); "price" = per share
  unit: "money" | "price" | "pct" | "x";
  hint?: string;
}

export interface StockDetails {
  symbol: string; // RELIANCE.NS / AAPL
  ticker: string; // RELIANCE / AAPL
  market: "india" | "us";
  exchange: string; // NSE / BSE / NasdaqGS / NYSE ...
  currency: "INR" | "USD";
  scale: MoneyScale; // how statement money is expressed
  fiscalYearEnd: string | null; // "Mar" / "Sep" - month the FY closes
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

export { STOCK_SYMBOL };

/**
 * Everything the Screener-style panel shows for one stock - NSE/BSE
 * (SYMBOL.NS / .BO, amounts in ₹ crores) or US (plain ticker, amounts in
 * $ millions). The live quote is required; company stats, statements
 * and the technical read are each optional, so one failing source shows
 * up as a warning rather than an error page.
 */
export async function getStockDetails(symbol: string): Promise<StockDetails> {
  const upper = symbol.toUpperCase();
  if (!STOCK_SYMBOL.test(upper)) throw new Error(`Not a stock symbol: ${symbol}`);
  const india = isIndianSymbol(upper);
  const provider = india ? yahooIndiaProvider : yahooUsProvider;
  const scale = india ? SCALE_INR : SCALE_USD;

  const warnings: string[] = [];
  const [quote, summary, statements, history] = await Promise.all([
    provider.getQuote(upper),
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
    provider.getHistory(upper, 120).catch(() => []),
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
  const scaled = (raw: number | null | undefined) => (raw == null ? null : raw / scale.divisor);

  const keyRatios: KeyRatio[] = [
    { label: "Market Cap", value: scaled(summary?.marketCap), unit: "money" },
    { label: "Current Price", value: quote.price, unit: "price" },
    { label: "High / Low", value: summary?.fiftyTwoWeekHigh ?? null, value2: summary?.fiftyTwoWeekLow ?? null, unit: "price", hint: "52-week" },
    { label: "Stock P/E", value: summary?.trailingPE ?? (ttmEps ? quote.price / ttmEps : null), unit: "x" },
    { label: "Book Value", value: summary?.bookValue ?? null, unit: "price", hint: "per share" },
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
    { label: "EPS (TTM)", value: ttmEps, unit: "price" },
    { label: "Net Profit (FY)", value: scaled(lastAnnual?.values.NetIncome), unit: "money" },
  ];

  const { pros, cons } = buildProsCons({
    annual,
    quarterly,
    priceToBook: summary?.priceToBook ?? null,
    dividendYield: summary?.dividendYield ?? null,
    scale,
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
    market: india ? "india" : "us",
    exchange: india ? (upper.endsWith(".BO") ? "BSE" : "NSE") : summary?.exchange ?? "US",
    currency: scale.currency,
    scale,
    fiscalYearEnd: lastAnnual ? periodLabel(lastAnnual.date).split(" ")[0] : null,
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
    quarters: buildProfitLoss(quarterly, { annual: false, scale }),
    profitLoss: buildProfitLoss(annual, { annual: true, scale }),
    balanceSheet: buildBalanceSheet(annual, scale),
    cashFlow: buildCashFlow(annual, scale),
    ratios: buildRatios(annual, scale),
    pros,
    cons,
    technical,
    warnings,
  };
}
