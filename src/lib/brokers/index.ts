import { getHoldings as getKiteHoldings, KiteSessionError, type KiteHolding } from "@/lib/kite/client";
import { getValidKiteSession, isKiteConfigured } from "@/lib/kite/session";
import { yahooIndiaProvider } from "@/lib/providers/yahooProvider";
import { scoreHolding, type SuggestionResult } from "@/lib/suggestions/scoreHolding";
import { getAngelHoldings, getAngelSession, isAngelConfigured } from "./angel";
import { BrokerSessionError, totalQuantity, yahooSymbol, type BrokerHolding, type BrokerId, type BrokerStatus } from "./types";

export function mapKiteHolding(h: KiteHolding): BrokerHolding {
  return {
    broker: "kite",
    tradingsymbol: h.tradingsymbol,
    exchange: h.exchange === "BSE" ? "BSE" : "NSE",
    isin: h.isin,
    quantity: h.quantity,
    t1Quantity: h.t1_quantity,
    averagePrice: h.average_price,
    lastPrice: h.last_price,
    closePrice: h.close_price,
    pnl: h.pnl,
    dayChangePct: h.day_change_percentage,
  };
}

async function loadKite(): Promise<BrokerStatus> {
  if (!isKiteConfigured()) return { state: "unconfigured" };
  const session = await getValidKiteSession();
  if (!session) return { state: "disconnected" };
  try {
    const holdings = (await getKiteHoldings()).map(mapKiteHolding);
    return { state: "connected", userId: session.kiteUserId, userName: null, holdings };
  } catch (err) {
    if (err instanceof KiteSessionError) return { state: "disconnected" };
    return { state: "error", message: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function loadAngel(): Promise<BrokerStatus> {
  if (!isAngelConfigured()) return { state: "unconfigured" };
  const session = await getAngelSession();
  if (!session) return { state: "disconnected" };
  try {
    const holdings = await getAngelHoldings();
    return { state: "connected", userId: session.userId, userName: session.userName, holdings };
  } catch (err) {
    if (err instanceof BrokerSessionError) return { state: "disconnected" };
    return { state: "error", message: err instanceof Error ? err.message : "Unknown error" };
  }
}

export const BROKER_LOADERS: Record<BrokerId, () => Promise<BrokerStatus>> = {
  kite: loadKite,
  angel: loadAngel,
};

/** Every broker's status + holdings, in parallel. Never throws. */
export async function loadAllBrokers(): Promise<Record<BrokerId, BrokerStatus>> {
  const [kite, angel] = await Promise.all([loadKite(), loadAngel()]);
  return { kite, angel };
}

export interface ScoredBrokerHolding extends BrokerHolding {
  // null when Yahoo had no usable history - row renders without a badge.
  score: SuggestionResult | null;
}

const HISTORY_DAYS = 120; // same window as /portfolio

// Broker gives price/P&L; Yahoo gives the daily history the indicators
// need. Weight is within the given list (one broker's account).
export async function scoreBrokerHoldings(holdings: BrokerHolding[]): Promise<ScoredBrokerHolding[]> {
  const totalValue = holdings.reduce((sum, h) => sum + h.lastPrice * totalQuantity(h), 0);
  return Promise.all(
    holdings.map(async (h): Promise<ScoredBrokerHolding> => {
      try {
        const history = await yahooIndiaProvider.getHistory(yahooSymbol(h), HISTORY_DAYS);
        const marketValue = h.lastPrice * totalQuantity(h);
        const score = scoreHolding({
          avgBuyPrice: h.averagePrice,
          currentPrice: h.lastPrice,
          history,
          portfolioWeightPct: totalValue > 0 ? (marketValue / totalValue) * 100 : 0,
        });
        return { ...h, score };
      } catch (err) {
        console.error(`Failed to score ${h.broker} holding ${yahooSymbol(h)}`, err);
        return { ...h, score: null };
      }
    })
  );
}
