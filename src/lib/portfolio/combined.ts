import type { Holding } from "@prisma/client";
import { enrichHoldings, type EnrichedHolding } from "@/lib/portfolio/enrich";
import { loadAllBrokers } from "@/lib/brokers";
import { totalQuantity, type BrokerHolding, type BrokerId, type BrokerStatus } from "@/lib/brokers/types";
import { loadMutualFunds, type MutualFundsResult } from "@/lib/kite/mutualFunds";

// One rupee-denominated list of everything you own, for totals: manually
// entered holdings + every connected broker's demat holdings (Kite, Angel
// One) + Kite Coin mutual funds.
//
// De-duplication: a manual IN_STOCK holding whose base symbol matches a
// connected broker's holding (GOLDBEES.NS <-> GOLDBEES) is the same shares,
// so it's dropped in favour of the broker's numbers. The same stock held
// at two brokers is two real positions and both count. When a broker isn't
// connected (tokens expire daily) the manual entry stays, so totals never
// lose those stocks entirely.

export type PositionClass = "IN_STOCK" | "US_STOCK" | "CRYPTO" | "MUTUAL_FUND";

export interface Position {
  source: "manual" | BrokerId;
  assetClass: PositionClass;
  symbol: string;
  invested: number; // ₹
  value: number; // ₹
  dayPnl: number; // ₹, best estimate - see notes per source below
}

export interface AllPositions {
  positions: Position[];
  brokers: Record<BrokerId, BrokerStatus>;
  mutualFunds: MutualFundsResult;
  enriched: EnrichedHolding[];
  // Manual holdings left out of totals because a broker reports them.
  replacedManual: { symbol: string; by: BrokerId }[];
}

export function baseSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/\.(NS|BO)$/, "");
}

export function brokerPosition(h: BrokerHolding): Position {
  const qty = totalQuantity(h);
  return {
    source: h.broker,
    assetClass: "IN_STOCK",
    symbol: h.tradingsymbol,
    invested: h.averagePrice * qty,
    value: h.lastPrice * qty,
    dayPnl: (h.lastPrice - h.closePrice) * qty,
  };
}

export async function loadAllPositions(holdings: Holding[]): Promise<AllPositions> {
  const [enriched, brokers, mutualFunds] = await Promise.all([enrichHoldings(holdings), loadAllBrokers(), loadMutualFunds()]);

  const positions: Position[] = [];
  const heldAt = new Map<string, BrokerId>();
  for (const status of Object.values(brokers)) {
    if (status.state !== "connected") continue;
    for (const h of status.holdings) {
      heldAt.set(baseSymbol(h.tradingsymbol), h.broker);
      positions.push(brokerPosition(h));
    }
  }

  if (mutualFunds.state === "ok") {
    for (const f of mutualFunds.rows) {
      positions.push({
        source: "kite",
        assetClass: "MUTUAL_FUND",
        symbol: f.fund,
        invested: f.invested,
        value: f.current,
        dayPnl: 0, // Kite gives no previous NAV, so no day change for funds
      });
    }
  }

  const replacedManual: AllPositions["replacedManual"] = [];
  for (const h of enriched) {
    const by = h.assetClass === "IN_STOCK" ? heldAt.get(baseSymbol(h.symbol)) : undefined;
    if (by) {
      replacedManual.push({ symbol: baseSymbol(h.symbol), by });
      continue;
    }
    if (h.inr?.marketValue == null) continue; // no live price / FX - can't value it
    positions.push({
      source: "manual",
      assetClass: h.assetClass as PositionClass,
      symbol: h.symbol,
      invested: h.inr.invested,
      value: h.inr.marketValue,
      // For USD holdings this uses the asset's own day move and ignores
      // today's USD/INR change.
      dayPnl: h.inr.marketValue * ((h.quote?.changePercent ?? 0) / 100),
    });
  }

  return { positions, brokers, mutualFunds, enriched, replacedManual };
}
