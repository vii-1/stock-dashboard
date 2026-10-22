import { NextResponse } from "next/server";
import { STOCK_SYMBOL } from "@/lib/fundamentals/stockDetails";
import { getStockLevels } from "@/lib/levels/stockLevels";

// GET /api/fundamentals/stock/RELIANCE.NS/levels -> StockLevels
// Separate from the main details route so the panel renders first and the
// slower NSE deals lookup fills in its own card.
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  if (!STOCK_SYMBOL.test(symbol)) {
    return NextResponse.json({ error: "Expected a stock symbol" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getStockLevels(symbol));
  } catch (err) {
    console.error(`Levels failed for ${symbol}`, err);
    return NextResponse.json({ error: "Couldn't compute price levels." }, { status: 502 });
  }
}
