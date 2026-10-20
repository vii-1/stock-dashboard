import { scoreHolding, type Suggestion } from "@/lib/suggestions/scoreHolding";
import type { HistoryPoint } from "@/lib/providers/types";

// Thin wrapper that turns a SuggestionResult (STRONG_BUY/HOLD/TRIM/
// SELL_REVIEW + reasons) into an actual order size. It doesn't reinvent
// the signal logic - scoreHolding is still the one place that decides
// what's bullish/bearish - this just decides how much to act on it by.

export type AgentAction = "BUY" | "SELL" | "HOLD";

export interface Position {
  quantity: number;
  avgBuyPrice: number;
}

export interface DecisionInput {
  symbol: string;
  currentPrice: number;
  history: HistoryPoint[];
  position: Position | null;
  portfolioValue: number;
  cash: number;
}

export interface Decision {
  action: AgentAction;
  symbol: string;
  quantity: number;
  suggestion: Suggestion;
  reasons: string[];
}

// Sizing target for a new position, expressed as % of total portfolio
// value. Matches riskManager's default maxPositionPct - the risk manager
// is still the one that actually enforces the cap; this is just aiming
// for it rather than assuming it'll always be granted.
const NEW_POSITION_TARGET_PCT = 10;

// Once repeated TRIM signals (e.g. a death cross that persists for
// weeks) have halved a position down to a sliver of the portfolio,
// halving it *again* produces a dust trade with no real risk-reduction
// value - found by backtesting against real data after adding the MACD
// signal, which trends with SMA(20)/SMA(50) often enough that TRIM can
// fire on nearly every day of a sustained downtrend. Below this
// threshold, TRIM exits the whole remaining position instead of half.
const DUST_POSITION_PCT = 0.5;

export function decide(input: DecisionInput): Decision {
  const { symbol, currentPrice, history, position, portfolioValue, cash } = input;

  const positionValue = position ? position.quantity * currentPrice : 0;
  const portfolioWeightPct = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;

  const { suggestion, reasons } = scoreHolding({
    avgBuyPrice: position?.avgBuyPrice ?? currentPrice,
    currentPrice,
    history,
    portfolioWeightPct,
  });

  switch (suggestion) {
    case "STRONG_BUY": {
      // Already holding: STRONG_BUY here means "keep holding", not "add
      // more" - scaling into a winner is a separate, deliberately
      // unimplemented decision (see TRADING_AGENT_DESIGN.md §7 on
      // position sizing) rather than something to do implicitly.
      if (position) {
        return { action: "HOLD", symbol, quantity: 0, suggestion, reasons };
      }

      const targetValue = portfolioValue * (NEW_POSITION_TARGET_PCT / 100);
      const spend = Math.min(targetValue, cash);
      const quantity = currentPrice > 0 ? spend / currentPrice : 0;

      if (quantity <= 0) {
        return {
          action: "HOLD",
          symbol,
          quantity: 0,
          suggestion,
          reasons: [...reasons, "Not enough cash available to open a position."],
        };
      }

      return { action: "BUY", symbol, quantity, suggestion, reasons };
    }

    case "SELL_REVIEW":
      if (!position) return { action: "HOLD", symbol, quantity: 0, suggestion, reasons };
      return { action: "SELL", symbol, quantity: position.quantity, suggestion, reasons };

    case "TRIM": {
      // Sell half rather than the whole position - TRIM is a risk-
      // reduction signal (overbought / concentration), not an exit
      // signal like SELL_REVIEW. Once it's already a dust-sized sliver
      // of the portfolio, exit the rest in one go instead of halving
      // forever (see DUST_POSITION_PCT above).
      if (!position) return { action: "HOLD", symbol, quantity: 0, suggestion, reasons };
      const isDust = portfolioWeightPct > 0 && portfolioWeightPct < DUST_POSITION_PCT;
      const quantity = isDust ? position.quantity : position.quantity / 2;
      return { action: "SELL", symbol, quantity, suggestion, reasons };
    }

    case "HOLD":
    default:
      return { action: "HOLD", symbol, quantity: 0, suggestion, reasons };
  }
}
