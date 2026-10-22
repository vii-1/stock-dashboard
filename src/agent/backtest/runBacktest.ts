// Usage: npm run agent:backtest -- <symbol> <IN_STOCK|US_STOCK|CRYPTO>
// e.g.:  npm run agent:backtest -- RELIANCE.NS IN_STOCK
//        npm run agent:backtest -- bitcoin CRYPTO
//
// Replays the strategy (decisionEngine -> scoreHolding) day by day over
// historical closes and reports return vs. buy-and-hold. No network
// calls except the one initial history fetch; no DB writes - this is
// the "no risk" stage of the staged rollout in TRADING_AGENT_DESIGN.md §1.

import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";
import type { MarketDataProvider } from "@/lib/providers/types";
import { decide, type Position } from "../strategy/decisionEngine";
import { TRANSACTION_COST_PCT } from "../broker/paperBroker";

// scoreHolding needs at least 50 closes for SMA(50) to stop returning
// null - start the simulation only once that lookback is satisfied, and
// fetch extra days up front so the *simulated* window still has ~a
// year of trading days after warmup, not just the bare minimum.
const WARMUP_DAYS = 50;
// CoinGecko's free tier hard-caps market_chart history at 365 days
// (confirmed against the live API - it 401s above that, not a soft
// truncation). Yahoo has no such cap, but capping both at 365 keeps this
// one number correct for every asset class instead of two constants.
const LOOKBACK_DAYS = 365;
const STARTING_CASH = 100_000;

function providerForAssetClass(assetClass: string): MarketDataProvider {
  switch (assetClass) {
    case "IN_STOCK":
      return yahooIndiaProvider;
    case "US_STOCK":
      return yahooUsProvider;
    case "CRYPTO":
      return coingeckoProvider;
    default:
      throw new Error(`Unknown asset class "${assetClass}". Use IN_STOCK, US_STOCK, or CRYPTO.`);
  }
}

interface TradeLog {
  date: string;
  action: "BUY" | "SELL";
  price: number;
  quantity: number;
  reasons: string[];
  fee: number;
}

async function main() {
  const [symbol, assetClass] = process.argv.slice(2);
  if (!symbol || !assetClass) {
    console.error("Usage: npm run agent:backtest -- <symbol> <IN_STOCK|US_STOCK|CRYPTO>");
    process.exitCode = 1;
    return;
  }

  const provider = providerForAssetClass(assetClass);

  console.log(`Fetching ${LOOKBACK_DAYS} days of history for ${symbol}...`);
  const history = await provider.getHistory(symbol, LOOKBACK_DAYS);

  if (history.length < WARMUP_DAYS + 20) {
    console.error(
      `Only got ${history.length} days of history back - need at least ${WARMUP_DAYS + 20} for a meaningful backtest.`
    );
    process.exitCode = 1;
    return;
  }

  let cash = STARTING_CASH;
  let position: Position | null = null;
  const trades: TradeLog[] = [];
  const equityCurve: number[] = [];
  const feeRate = TRANSACTION_COST_PCT / 100;
  let totalFeesPaid = 0;

  for (let i = WARMUP_DAYS; i < history.length; i++) {
    // Slice up to and including today only - the strategy must never see
    // future closes. This is the one bug that would make every backtest
    // result meaningless (look-ahead bias), so it's the one line in this
    // file most worth double-checking if results ever look too good.
    const windowHistory = history.slice(0, i + 1);
    const today = history[i];
    const currentPrice = today.close;

    const positionValue = position ? position.quantity * currentPrice : 0;
    const portfolioValue = cash + positionValue;

    const decision = decide({
      symbol,
      currentPrice,
      history: windowHistory,
      position,
      portfolioValue,
      cash,
      wholeUnits: assetClass === "IN_STOCK",
      costPct: TRANSACTION_COST_PCT,
    });

    if (decision.action === "BUY" && decision.quantity > 0) {
      const grossCost = decision.quantity * currentPrice;
      const fee = grossCost * feeRate;
      const totalCost = grossCost + fee;
      if (totalCost <= cash) {
        cash -= totalCost;
        totalFeesPaid += fee;
        // Fee folded into the cost basis, same as paperBroker.ts - it's
        // a real cost of acquiring the position, not a separate ledger line.
        position = { quantity: decision.quantity, avgBuyPrice: totalCost / decision.quantity };
        trades.push({
          date: today.date,
          action: "BUY",
          price: currentPrice,
          quantity: decision.quantity,
          reasons: decision.reasons,
          fee,
        });
      }
    } else if (decision.action === "SELL" && position && decision.quantity > 0) {
      const sellQuantity = Math.min(decision.quantity, position.quantity);
      const grossProceeds = sellQuantity * currentPrice;
      const fee = grossProceeds * feeRate;
      cash += grossProceeds - fee;
      totalFeesPaid += fee;
      const remaining: number = position.quantity - sellQuantity;
      position = remaining > 1e-8 ? { quantity: remaining, avgBuyPrice: position.avgBuyPrice } : null;
      trades.push({
        date: today.date,
        action: "SELL",
        price: currentPrice,
        quantity: sellQuantity,
        reasons: decision.reasons,
        fee,
      });
    }

    equityCurve.push(cash + (position ? position.quantity * currentPrice : 0));
  }

  const simulatedDays = history.slice(WARMUP_DAYS);
  const finalValue = equityCurve[equityCurve.length - 1] ?? STARTING_CASH;
  const totalReturnPct = ((finalValue - STARTING_CASH) / STARTING_CASH) * 100;

  const buyHoldShares = STARTING_CASH / simulatedDays[0].close;
  const buyHoldFinalValue = buyHoldShares * simulatedDays[simulatedDays.length - 1].close;
  const buyHoldReturnPct = ((buyHoldFinalValue - STARTING_CASH) / STARTING_CASH) * 100;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const value of equityCurve) {
    peak = Math.max(peak, value);
    const drawdownPct = peak > 0 ? ((peak - value) / peak) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
  }

  const sells = trades.filter((t) => t.action === "SELL");
  console.log(`\n=== Backtest: ${symbol} (${assetClass}) ===`);
  console.log(
    `Period: ${simulatedDays[0].date} to ${simulatedDays[simulatedDays.length - 1].date} (${simulatedDays.length} trading days)`
  );
  console.log(`Starting cash:      ${STARTING_CASH.toFixed(2)}`);
  console.log(`Final value:        ${finalValue.toFixed(2)}`);
  console.log(`Strategy return:    ${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(2)}%`);
  console.log(`Buy & hold return:  ${buyHoldReturnPct >= 0 ? "+" : ""}${buyHoldReturnPct.toFixed(2)}%`);
  console.log(`Max drawdown:       -${maxDrawdownPct.toFixed(2)}%`);
  console.log(`Trades:             ${trades.length} (${sells.length} sells)`);
  console.log(
    `Fees paid (${TRANSACTION_COST_PCT}%/trade): ${totalFeesPaid.toFixed(2)} (${((totalFeesPaid / STARTING_CASH) * 100).toFixed(2)}% of starting cash) - already included in the return above, not on top of it.`
  );
  if (trades.length > 0) {
    console.log("");
    for (const t of trades) {
      console.log(`  ${t.date}  ${t.action.padEnd(4)} ${t.quantity.toFixed(4)} @ ${t.price.toFixed(2)} (fee ${t.fee.toFixed(2)})  - ${t.reasons[0] ?? ""}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  // exitCode (not exit()) so Node drains any pending network handles on
  // its own instead of a hard kill - the latter is what triggered a
  // native libuv assertion crash on Windows when a fetch was still
  // in-flight/closing.
  process.exitCode = 1;
});
