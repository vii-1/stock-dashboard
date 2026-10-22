import { NextRequest, NextResponse } from "next/server";
import { getCryptoChart } from "@/lib/fundamentals/cryptoDetails";
import { COIN_ID } from "@/lib/fundamentals/paths";
import type { ChartRange } from "@/lib/fundamentals/yahooFundamentals";

const RANGES: ChartRange[] = ["1M", "6M", "1Y", "3Y", "5Y", "MAX"];

// GET /api/fundamentals/crypto/bitcoin/chart?range=1Y -> ChartPoint[] (USD)
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id).toLowerCase();
  const range = (request.nextUrl.searchParams.get("range") ?? "1Y").toUpperCase() as ChartRange;
  if (!COIN_ID.test(id) || !RANGES.includes(range)) {
    return NextResponse.json({ error: "Expected a coin id and range in 1M/6M/1Y/3Y/5Y/MAX" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getCryptoChart(id, range));
  } catch (err) {
    console.error(`Crypto chart failed for ${id} ${range}`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load price history." }, { status: 502 });
  }
}
