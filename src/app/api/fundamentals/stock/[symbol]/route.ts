import { NextRequest, NextResponse } from "next/server";
import { getStockDetails, STOCK_SYMBOL } from "@/lib/fundamentals/stockDetails";

// GET /api/fundamentals/stock/JSWSTEEL.NS  (or /AAPL) -> StockDetails
// Loaded lazily when a stock row is expanded (see StockDetailPanel).
export async function GET(_request: NextRequest, { params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  if (!STOCK_SYMBOL.test(symbol)) {
    return NextResponse.json({ error: "Expected a symbol like RELIANCE.NS or AAPL" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getStockDetails(symbol));
  } catch (err) {
    console.error(`Stock details failed for ${symbol}`, err);
    return NextResponse.json({ error: "Couldn't load this stock right now. Try again in a bit." }, { status: 502 });
  }
}
