import { NextRequest, NextResponse } from "next/server";
import { yahooUsProvider } from "@/lib/providers/yahooProvider";

// GET /api/stocks/us/movers?direction=gainers&limit=10
export async function GET(request: NextRequest) {
  const direction = request.nextUrl.searchParams.get("direction") === "losers" ? "losers" : "gainers";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 10);

  try {
    const quotes = await yahooUsProvider.getMovers(direction, limit);
    return NextResponse.json({ quotes });
  } catch (err) {
    console.error("Failed to fetch US movers", err);
    return NextResponse.json(
      { error: "Failed to fetch market data. Try again shortly." },
      { status: 502 }
    );
  }
}
