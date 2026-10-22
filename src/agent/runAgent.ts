// Usage: npm run agent:run [-- <IN_STOCK|US_STOCK|CRYPTO>]
//
// The optional arg restricts which watchlist symbols get a BUY/SELL/HOLD
// decision this pass - e.g. `npm run agent:run -- CRYPTO` for a run
// scheduled outside NSE/US market hours. It does NOT affect the
// stop-loss pass, which always checks every held position regardless of
// asset class - a position shouldn't lose its stop-loss protection just
// because this particular run was scoped to a different market.
//
// One pass through TRADING_AGENT_DESIGN.md §5's loop: fetch quotes for
// everything held + watched, force-sell anything past its stop-loss,
// then decide/risk-check/place an order per watchlist symbol. Logs every
// decision (even HOLD) to DecisionLog, every order attempt to Order.
//
// Deliberately single-pass, not an internal setInterval loop - the
// design doc explicitly warns against a setInterval inside the Next.js
// web process (couples the trading loop's lifetime to the dashboard
// server by accident), and a single-pass script is what a cron job /
// Windows Task Scheduler entry would invoke anyway. Wrap this in one of
// those for "every 5 minutes during market hours" - see the design doc.

import { prisma } from "@/lib/prisma";
import { NIFTY_WATCHLIST, yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";
import type { MarketDataProvider, Quote } from "@/lib/providers/types";
import { paperBroker, TRANSACTION_COST_PCT } from "./broker/paperBroker";
import { decide } from "./strategy/decisionEngine";
import {
  checkTrade,
  DEFAULT_RISK_LIMITS,
  isNseMarketOpen,
  isQuoteStale,
  isStopLossBreached,
  recordTrade,
  resetDailyCounters,
  type RiskState,
} from "./riskManager";

const MODE = "PAPER";
const HISTORY_DAYS = 90;
const QUOTE_STALENESS_MINUTES = 30;
// getHistory has no multi-symbol batch endpoint (unlike getQuotes), so a
// watchlist with several coins means several sequential CoinGecko calls
// every time their 1-hour history cache is cold. Its free tier rate-
// limits aggressively enough that firing those back-to-back with no gap
// tripped a 429 partway through in testing - this spaces them out.
const HISTORY_FETCH_DELAY_MS = 2500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Short and deliberate per TRADING_AGENT_DESIGN.md §7 - "don't scan the
// whole market on day one." Same symbols the dashboard already knows
// about (a subset of NIFTY_WATCHLIST, a couple of large US names, a
// handful of large-cap coins), not a market-wide scan.
//
// IN_STOCK widened from 3 names to the dashboard's full NIFTY_WATCHLIST
// (30 large caps) on 2026-10-19: three symbols almost never produced a
// non-HOLD, and Yahoo's chart endpoint doesn't have CoinGecko's rate-
// limit problem (see note below). Still large, liquid names only.
const DEFAULT_WATCHLIST: { symbol: string; assetClass: "IN_STOCK" | "US_STOCK" | "CRYPTO" }[] = [
  ...NIFTY_WATCHLIST.map((symbol) => ({ symbol, assetClass: "IN_STOCK" as const })),
  { symbol: "AAPL", assetClass: "US_STOCK" },
  { symbol: "MSFT", assetClass: "US_STOCK" },
  { symbol: "bitcoin", assetClass: "CRYPTO" },
  { symbol: "ethereum", assetClass: "CRYPTO" },
  { symbol: "solana", assetClass: "CRYPTO" },
  { symbol: "cardano", assetClass: "CRYPTO" },
  { symbol: "ripple", assetClass: "CRYPTO" },
  { symbol: "dogecoin", assetClass: "CRYPTO" },
  { symbol: "chainlink", assetClass: "CRYPTO" },
];
// Tried widening this to 17 coins for a one-off scan (Oct 18) looking
// for any live opportunity - CoinGecko's free tier turned out to rate-
// limit on a sliding window across *all* recent calls, not just back-
// to-back ones, so anything past ~8 history fetches in a short span
// 429s regardless of per-call delay. Reverted to the original 7 so the
// scheduled overnight task stays reliable; the wider scan's result
// (10 real symbols checked by hand, all genuinely HOLD/mixed signals,
// nothing crossing the STRONG_BUY threshold) is just that - a scan,
// not a reason to permanently widen this list without a better rate-
// limit strategy (e.g. spacing calls across a whole run instead of
// trying to fetch them all up front).

function providerForAssetClass(assetClass: string): MarketDataProvider {
  switch (assetClass) {
    case "IN_STOCK":
      return yahooIndiaProvider;
    case "US_STOCK":
      return yahooUsProvider;
    case "CRYPTO":
      return coingeckoProvider;
    default:
      throw new Error(`Unknown assetClass: ${assetClass}`);
  }
}

async function loadState(): Promise<{ risk: RiskState; lastResetDate: Date }> {
  const row = await prisma.agentState.upsert({
    where: { id: MODE },
    create: { id: MODE },
    update: {},
  });
  return {
    risk: {
      killSwitchActive: row.killSwitchActive,
      killSwitchReason: row.killSwitchReason,
      tradesToday: row.tradesToday,
      realizedLossToday: row.realizedLossToday,
    },
    lastResetDate: row.lastResetDate,
  };
}

async function saveState(risk: RiskState, lastResetDate: Date) {
  await prisma.agentState.update({
    where: { id: MODE },
    data: {
      killSwitchActive: risk.killSwitchActive,
      killSwitchReason: risk.killSwitchReason,
      tradesToday: risk.tradesToday,
      realizedLossToday: risk.realizedLossToday,
      lastResetDate,
    },
  });
}

// Server-local calendar day, not IST - fine for a personal agent run
// from India, worth revisiting if this ever runs on a server elsewhere.
function isNewDay(lastResetDate: Date): boolean {
  return new Date().toDateString() !== lastResetDate.toDateString();
}

async function logDecision(params: {
  symbol: string;
  suggestion: string;
  reasons: string[];
  executed: boolean;
  blockReason?: string | null;
}) {
  await prisma.decisionLog.create({
    data: {
      symbol: params.symbol,
      suggestion: params.suggestion,
      reasons: JSON.stringify(params.reasons),
      executed: params.executed,
      blockReason: params.blockReason ?? null,
    },
  });
}

async function logOrder(params: {
  side: "BUY" | "SELL";
  assetClass: string;
  symbol: string;
  quantity: number;
  price: number;
  status: "FILLED" | "REJECTED";
  rejectReason?: string | null;
}) {
  await prisma.order.create({
    data: {
      mode: MODE,
      side: params.side,
      assetClass: params.assetClass,
      symbol: params.symbol,
      quantity: params.quantity,
      price: params.price,
      status: params.status,
      rejectReason: params.rejectReason ?? null,
    },
  });
}

async function main() {
  const assetClassFilter = process.argv[2];
  const watchlist = assetClassFilter
    ? DEFAULT_WATCHLIST.filter((w) => w.assetClass === assetClassFilter)
    : DEFAULT_WATCHLIST;

  if (assetClassFilter && watchlist.length === 0) {
    console.error(`No watchlist symbols match assetClass "${assetClassFilter}". Valid values: IN_STOCK, US_STOCK, CRYPTO.`);
    process.exitCode = 1;
    return;
  }

  let { risk, lastResetDate } = await loadState();

  if (isNewDay(lastResetDate)) {
    risk = resetDailyCounters(risk);
    lastResetDate = new Date();
    console.log("New day - trade count and realized loss counters reset.");
    if (risk.killSwitchActive) {
      console.log("Kill switch is still active from a previous trip - run `npm run agent:reset-kill-switch -- PAPER` to clear it manually.");
    }
  }

  if (risk.killSwitchActive) {
    console.log(`Kill switch active (${risk.killSwitchReason}). Skipping this run.`);
    await saveState(risk, lastResetDate);
    return;
  }

  const cash0 = await paperBroker.getCashBalance();
  const positions0 = await paperBroker.getPositions();

  const assetClassBySymbol = new Map<string, string>();
  for (const p of positions0) assetClassBySymbol.set(p.symbol, p.assetClass);
  for (const w of watchlist) assetClassBySymbol.set(w.symbol, w.assetClass);
  const allSymbols = [...assetClassBySymbol.keys()];

  // Fetch quotes for every held position too, not just today's
  // watchlist, so portfolio value (and therefore weight/sizing math)
  // reflects reality even for a position outside the current watchlist.
  //
  // Batched per provider (getQuotes, not N x getQuote) - CoinGecko's
  // free tier rate-limits aggressively, and even a handful of individual
  // per-symbol requests fired back-to-back was enough to trip a 429 on
  // every single one of them in testing. One batched call per asset
  // class instead of one call per symbol.
  const symbolsByAssetClass = new Map<string, string[]>();
  for (const symbol of allSymbols) {
    const assetClass = assetClassBySymbol.get(symbol)!;
    const list = symbolsByAssetClass.get(assetClass) ?? [];
    list.push(symbol);
    symbolsByAssetClass.set(assetClass, list);
  }

  const quotes = new Map<string, Quote>();
  for (const [assetClass, symbols] of symbolsByAssetClass) {
    try {
      const results = await providerForAssetClass(assetClass).getQuotes(symbols);
      for (const quote of results) quotes.set(quote.symbol, quote);
    } catch (err) {
      console.error(`Failed to fetch quotes for ${assetClass} (${symbols.join(", ")}):`, err instanceof Error ? err.message : err);
    }
  }

  function portfolioValue(cash: number, positions: typeof positions0): number {
    return (
      cash +
      positions.reduce((sum, p) => {
        const q = quotes.get(p.symbol);
        return sum + (q ? p.quantity * q.price : p.quantity * p.avgBuyPrice);
      }, 0)
    );
  }

  // --- Stop-loss pass: force-sell anything past its stop-loss first,
  // regardless of what the strategy currently says. This is protective
  // de-risking, not new risk-taking, so it bypasses checkTrade's caps
  // entirely (the kill switch was already checked above) - a trade-count
  // or position-size cap meant to restrain new bets should never block
  // getting out of a losing one.
  for (const position of positions0) {
    const quote = quotes.get(position.symbol);
    if (!quote) continue;
    if (!isStopLossBreached(position.avgBuyPrice, quote.price, DEFAULT_RISK_LIMITS.stopLossPct)) continue;

    console.log(`${position.symbol}: stop-loss breached (entry ${position.avgBuyPrice.toFixed(2)}, now ${quote.price.toFixed(2)}) - force-selling.`);
    const result = await paperBroker.placeOrder({
      symbol: position.symbol,
      assetClass: position.assetClass,
      side: "SELL",
      quantity: position.quantity,
      price: quote.price,
    });
    await logOrder({
      side: "SELL",
      assetClass: position.assetClass,
      symbol: position.symbol,
      quantity: position.quantity,
      price: quote.price,
      status: result.status,
      rejectReason: result.rejectReason,
    });
    await logDecision({
      symbol: position.symbol,
      suggestion: "STOP_LOSS",
      reasons: [`Stop-loss breached: entry ${position.avgBuyPrice.toFixed(2)}, current ${quote.price.toFixed(2)}`],
      executed: result.status === "FILLED",
    });
    if (result.status === "FILLED") {
      risk = recordTrade(risk, result.realizedPnl ?? 0, DEFAULT_RISK_LIMITS, portfolioValue(cash0, positions0));
    }
  }

  // Kill switch can trip mid-pass from stop-loss losses - re-check before continuing.
  if (risk.killSwitchActive) {
    console.log(`Kill switch tripped during stop-loss checks (${risk.killSwitchReason}). Skipping the decision pass.`);
    await saveState(risk, lastResetDate);
    return;
  }

  // Re-fetch cash/positions - the stop-loss pass above may have changed them.
  const cash = await paperBroker.getCashBalance();
  const positions = await paperBroker.getPositions();
  const positionBySymbol = new Map(positions.map((p) => [p.symbol, p]));
  const totalPortfolioValue = portfolioValue(cash, positions);

  for (const { symbol, assetClass } of watchlist) {
    if (assetClass === "IN_STOCK" && !isNseMarketOpen(new Date())) {
      console.log(`${symbol}: NSE closed right now, skipping.`);
      continue;
    }

    const quote = quotes.get(symbol);
    if (!quote) {
      console.log(`${symbol}: no quote available, skipping.`);
      continue;
    }
    if (isQuoteStale(quote.asOf, QUOTE_STALENESS_MINUTES)) {
      console.log(`${symbol}: quote is stale (as of ${quote.asOf}), skipping.`);
      continue;
    }

    let history;
    try {
      await sleep(HISTORY_FETCH_DELAY_MS);
      history = await providerForAssetClass(assetClass).getHistory(symbol, HISTORY_DAYS);
    } catch (err) {
      console.error(`${symbol}: failed to fetch history, skipping:`, err instanceof Error ? err.message : err);
      continue;
    }

    const position = positionBySymbol.get(symbol) ?? null;
    const decision = decide({
      symbol,
      currentPrice: quote.price,
      history,
      position: position ? { quantity: position.quantity, avgBuyPrice: position.avgBuyPrice } : null,
      portfolioValue: totalPortfolioValue,
      cash,
      wholeUnits: assetClass === "IN_STOCK",
      costPct: TRANSACTION_COST_PCT,
    });

    if (decision.action === "HOLD") {
      await logDecision({ symbol, suggestion: decision.suggestion, reasons: decision.reasons, executed: false });
      console.log(`${symbol}: HOLD (${decision.suggestion})`);
      continue;
    }

    const existingPositionValue = position ? position.quantity * quote.price : 0;
    const riskCheck = checkTrade(
      {
        action: decision.action,
        quantity: decision.quantity,
        price: quote.price,
        portfolioValue: totalPortfolioValue,
        existingPositionValue,
      },
      risk
    );

    if (!riskCheck.allowed) {
      await logDecision({
        symbol,
        suggestion: decision.suggestion,
        reasons: decision.reasons,
        executed: false,
        blockReason: riskCheck.blockReason,
      });
      console.log(`${symbol}: BLOCKED - ${riskCheck.blockReason}`);
      continue;
    }

    const result = await paperBroker.placeOrder({
      symbol,
      assetClass,
      side: decision.action,
      quantity: decision.quantity,
      price: quote.price,
    });
    await logOrder({
      side: decision.action,
      assetClass,
      symbol,
      quantity: decision.quantity,
      price: quote.price,
      status: result.status,
      rejectReason: result.rejectReason,
    });
    await logDecision({
      symbol,
      suggestion: decision.suggestion,
      reasons: decision.reasons,
      executed: result.status === "FILLED",
    });

    if (result.status === "FILLED") {
      console.log(
        `${symbol}: ${decision.action} ${decision.quantity.toFixed(4)} @ ${quote.price.toFixed(2)}${result.fee != null ? ` (fee ${result.fee.toFixed(2)})` : ""}`
      );
      risk = recordTrade(risk, result.realizedPnl ?? 0, DEFAULT_RISK_LIMITS, totalPortfolioValue);
    } else {
      console.log(`${symbol}: order REJECTED - ${result.rejectReason}`);
    }
  }

  await saveState(risk, lastResetDate);
  console.log("\nRun complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
