import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/search";

// GET /api/search?q=reliance[&market=india|us|crypto] -> { results: SearchResult[], failed: [] }
// Powers the header search box (stocks on NSE/BSE/US + coins) and the
// add-holding form's symbol suggestions (one market only).
const MARKETS = ["india", "us", "crypto"] as const;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const m = request.nextUrl.searchParams.get("market");
  const market = MARKETS.find((x) => x === m);
  return NextResponse.json(await searchAll(q, market));
}
