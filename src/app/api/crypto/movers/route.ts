import { NextRequest, NextResponse } from "next/server";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";

// GET /api/crypto/movers?direction=gainers&limit=10
export async function GET(request: NextRequest) {
  const direction = request.nextUrl.searchParams.get("direction") === "losers" ? "losers" : "gainers";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 10);

  try {
    const quotes = await coingeckoProvider.getMovers(direction, limit);
    return NextResponse.json({ quotes });
  } catch (err) {
    console.error("Failed to fetch crypto movers", err);
    return NextResponse.json(
      { error: "Failed to fetch market data. Try again shortly." },
      { status: 502 }
    );
  }
}
