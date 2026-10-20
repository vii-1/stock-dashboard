import { NextRequest, NextResponse } from "next/server";
import { getStockDetails, INDIAN_SYMBOL } from "@/lib/fundamentals/stockDetails";

// GET /api/stocks/india/JSWSTEEL.NS/details -> StockDetails
// Loaded lazily when a stock row is expanded (see StockDetailPanel).
export async function GET(_request: NextRequest, { params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  if (!INDIAN_SYMBOL.test(symbol)) {
    return NextResponse.json({ error: "Expected an NSE/BSE symbol like RELIANCE.NS" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getStockDetails(symbol));
  } catch (err) {
    console.error(`Stock details failed for ${symbol}`, err);
    return NextResponse.json({ error: "Couldn't load this stock right now. Try again in a bit." }, { status: 502 });
  }
}
