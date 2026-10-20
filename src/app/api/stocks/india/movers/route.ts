import { NextRequest, NextResponse } from "next/server";
import { yahooIndiaProvider } from "@/lib/providers/yahooProvider";

// GET /api/stocks/india/movers?direction=gainers&limit=10
// This is the one fully wired end-to-end example - use it as the
// template for /api/stocks/us/movers and /api/crypto/movers.
export async function GET(request: NextRequest) {
  const direction = request.nextUrl.searchParams.get("direction") === "losers" ? "losers" : "gainers";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 10);

  try {
    const quotes = await yahooIndiaProvider.getMovers(direction, limit);
    return NextResponse.json({ quotes });
  } catch (err) {
    console.error("Failed to fetch India movers", err);
    return NextResponse.json(
      { error: "Failed to fetch market data. Try again shortly." },
      { status: 502 }
    );
  }
}
