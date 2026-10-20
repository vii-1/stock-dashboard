import { prisma } from "@/lib/prisma";
import type { Broker, BrokerPosition, OrderResult, PlaceOrderParams } from "./types";

// Fully implemented: simulated fills against live quotes, no real money,
// no broker API. Fills happen immediately at the price the caller passes
// in (the quote it already fetched) - no slippage/partial-fill modeling,
// which is a fine simplification for a personal paper-trading loop but
// would understate real-world execution cost if you ever compared this
// against a live account.

const STARTING_CASH = 100_000;

// A flat per-trade fee, applied to both BUY and SELL, approximating a
// typical crypto-exchange taker fee (Binance's default tier is ~0.1%) -
// a rough ballpark across India/US equities and crypto, not an exact
// per-market model (Zerodha charges ~0 brokerage on equity delivery;
// this errs toward overstating cost there, not understating it).
// runBacktest.ts imports this same constant so a backtest's return
// reflects the same friction the live paper agent would see, instead of
// the unrealistically clean "zero fees" number that let the original
// backtest overstate how good a strategy looked - see TRADING_AGENT_DESIGN.md
// §0 on most retail strategies underperforming once costs are counted.
export const TRANSACTION_COST_PCT = 0.1;

// Intraday (MIS-style) round trips on Zerodha cost roughly 0.1% all-in
// (0.03% brokerage per side, 0.025% STT on the sell, exchange/SEBI/
// stamp/GST) - ~0.05% per side. Rounded up to 0.08% per side to leave
// an allowance for slippage, since paper fills are at the exact quote.
export const INTRADAY_COST_PCT = 0.08;

// One simulated account per mode - "PAPER" (daily agent) and
// "PAPER_INTRADAY" (intraday agent) keep separate cash and positions so
// their results can be judged independently.
export function createPaperBroker(MODE: string, costPct: number = TRANSACTION_COST_PCT): Broker {
  async function getOrCreateAccount() {
    const existing = await prisma.paperAccount.findUnique({ where: { mode: MODE } });
    if (existing) return existing;
    return prisma.paperAccount.create({ data: { mode: MODE, cash: STARTING_CASH } });
  }

  return {
    async getCashBalance(): Promise<number> {
      const account = await getOrCreateAccount();
      return account.cash;
    },

    async getPositions(): Promise<BrokerPosition[]> {
      const positions = await prisma.paperPosition.findMany({ where: { mode: MODE } });
      return positions.map((p) => ({
        symbol: p.symbol,
        assetClass: p.assetClass,
        quantity: p.quantity,
        avgBuyPrice: p.avgBuyPrice,
      }));
    },

    async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
      const { symbol, assetClass, side, quantity, price } = params;

      if (quantity <= 0) {
        return { status: "REJECTED", rejectReason: "Quantity must be positive" };
      }
      if (price <= 0) {
        return { status: "REJECTED", rejectReason: "Price must be positive" };
      }

      const account = await getOrCreateAccount();
      const existing = await prisma.paperPosition.findUnique({
        where: { mode_symbol: { mode: MODE, symbol } },
      });

      const feeRate = costPct / 100;

      if (side === "BUY") {
        const grossCost = quantity * price;
        const fee = grossCost * feeRate;
        const totalCost = grossCost + fee;
        if (totalCost > account.cash) {
          return {
            status: "REJECTED",
            rejectReason: `Insufficient cash: need ${totalCost.toFixed(2)} (incl. ${fee.toFixed(2)} fee), have ${account.cash.toFixed(2)}`,
          };
        }

        const newQuantity = (existing?.quantity ?? 0) + quantity;
        // Weighted-average cost basis across the combined position,
        // including the fee - the fee is a real cost of acquiring the
        // position, same as the price paid.
        const newAvgBuyPrice = existing
          ? (existing.avgBuyPrice * existing.quantity + totalCost) / newQuantity
          : totalCost / quantity;

        await prisma.$transaction([
          prisma.paperAccount.update({ where: { mode: MODE }, data: { cash: account.cash - totalCost } }),
          existing
            ? prisma.paperPosition.update({
                where: { mode_symbol: { mode: MODE, symbol } },
                data: { quantity: newQuantity, avgBuyPrice: newAvgBuyPrice },
              })
            : prisma.paperPosition.create({
                data: { mode: MODE, symbol, assetClass, quantity, avgBuyPrice: newAvgBuyPrice },
              }),
        ]);

        return { status: "FILLED", price, fee };
      }

      // SELL
      if (!existing || existing.quantity < quantity) {
        return {
          status: "REJECTED",
          rejectReason: `Insufficient position: have ${existing?.quantity ?? 0}, tried to sell ${quantity}`,
        };
      }

      const grossProceeds = quantity * price;
      const fee = grossProceeds * feeRate;
      const netProceeds = grossProceeds - fee;
      const realizedPnl = netProceeds - existing.avgBuyPrice * quantity;
      const remaining = existing.quantity - quantity;

      await prisma.$transaction([
        prisma.paperAccount.update({ where: { mode: MODE }, data: { cash: account.cash + netProceeds } }),
        remaining > 1e-8
          ? prisma.paperPosition.update({
              where: { mode_symbol: { mode: MODE, symbol } },
              data: { quantity: remaining },
            })
          : prisma.paperPosition.delete({ where: { mode_symbol: { mode: MODE, symbol } } }),
      ]);

      return { status: "FILLED", price, realizedPnl, fee };
    },
  };
}

export const paperBroker: Broker = createPaperBroker("PAPER");
