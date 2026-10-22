// Usage: npm run agent:status -- PAPER
//
// Quick read-only snapshot of a mode's paper account: cash, open
// positions (with live mark-to-market P&L), recent orders, and the
// kill switch/risk counters. Doesn't touch any state - safe to run
// anytime, as often as you like.

import { prisma } from "@/lib/prisma";
import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";
import type { MarketDataProvider } from "@/lib/providers/types";

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

async function main() {
  const mode = process.argv[2] ?? "PAPER";

  const account = await prisma.paperAccount.findUnique({ where: { mode } });
  const positions = await prisma.paperPosition.findMany({ where: { mode } });
  const state = await prisma.agentState.findUnique({ where: { id: mode } });
  const recentOrders = await prisma.order.findMany({
    where: { mode },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const recentDecisions = await prisma.decisionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (!account) {
    console.log(`No ${mode} account yet - run "npm run agent:run" at least once to create one.`);
    return;
  }

  console.log(`=== ${mode} account ===`);
  console.log(`Cash: ${account.cash.toFixed(2)}`);

  if (state) {
    console.log(
      `Kill switch: ${state.killSwitchActive ? `ACTIVE (${state.killSwitchReason})` : "inactive"}  |  Trades today: ${state.tradesToday}  |  Realized loss today: ${state.realizedLossToday.toFixed(2)}`
    );
  }

  console.log(`\n=== Open positions (${positions.length}) ===`);
  if (positions.length === 0) {
    console.log("(none)");
  }
  let positionsValue = 0;
  for (const p of positions) {
    try {
      const quote = await providerForAssetClass(p.assetClass).getQuote(p.symbol);
      const short = p.side === "SHORT";
      // Short: avg is the net entry proceeds; it gains as price falls.
      const marketValue = short ? p.quantity * (2 * p.avgBuyPrice - quote.price) : p.quantity * quote.price;
      const move = short ? p.avgBuyPrice - quote.price : quote.price - p.avgBuyPrice;
      const unrealizedPnl = move * p.quantity;
      const unrealizedPnlPct = p.avgBuyPrice > 0 ? (move / p.avgBuyPrice) * 100 : 0;
      positionsValue += marketValue;
      console.log(
        `${p.symbol} (${p.assetClass})${short ? " SHORT" : ""}: ${p.quantity.toFixed(4)} @ avg ${p.avgBuyPrice.toFixed(2)}, now ${quote.price.toFixed(2)} -> ${unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)} (${unrealizedPnlPct >= 0 ? "+" : ""}${unrealizedPnlPct.toFixed(1)}%)`
      );
    } catch (err) {
      console.log(`${p.symbol} (${p.assetClass}): ${p.quantity.toFixed(4)} @ avg ${p.avgBuyPrice.toFixed(2)} - couldn't fetch a live price`);
      positionsValue += p.quantity * p.avgBuyPrice;
    }
  }

  console.log(`\nTotal portfolio value (cash + positions): ${(account.cash + positionsValue).toFixed(2)}`);

  console.log(`\n=== Recent orders ===`);
  if (recentOrders.length === 0) console.log("(none yet)");
  for (const o of recentOrders) {
    console.log(
      `${o.createdAt.toISOString()}  ${o.side.padEnd(5)} ${o.quantity.toFixed(4)} ${o.symbol} @ ${o.price.toFixed(2)}  ${o.status}${o.rejectReason ? ` (${o.rejectReason})` : ""}`
    );
  }

  console.log(`\n=== Recent decisions (any symbol) ===`);
  for (const d of recentDecisions) {
    console.log(`${d.createdAt.toISOString()}  ${d.symbol}: ${d.suggestion}  executed=${d.executed}${d.blockReason ? `  blocked: ${d.blockReason}` : ""}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
