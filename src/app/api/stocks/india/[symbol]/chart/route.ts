import { NextRequest, NextResponse } from "next/server";
import { INDIAN_SYMBOL } from "@/lib/fundamentals/stockDetails";
import { getPriceHistory, type ChartRange } from "@/lib/fundamentals/yahooFundamentals";

const RANGES: ChartRange[] = ["1M", "6M", "1Y", "3Y", "5Y", "MAX"];

// GET /api/stocks/india/JSWSTEEL.NS/chart?range=1Y -> ChartPoint[]
export async function GET(request: NextRequest, { params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  const range = (request.nextUrl.searchParams.get("range") ?? "1Y").toUpperCase() as ChartRange;
  if (!INDIAN_SYMBOL.test(symbol) || !RANGES.includes(range)) {
    return NextResponse.json({ error: "Expected an NSE/BSE symbol and range in 1M/6M/1Y/3Y/5Y/MAX" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getPriceHistory(symbol, range));
  } catch (err) {
    console.error(`Chart failed for ${symbol} ${range}`, err);
    return NextResponse.json({ error: "Couldn't load price history." }, { status: 502 });
  }
}
