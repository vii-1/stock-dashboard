import { NextRequest, NextResponse } from "next/server";
import { getUsdInrRate } from "@/lib/fx";

// GET /api/fx/usdinr?date=YYYY-MM-DD -> { rate, asOf }
// Used by the add/edit holding forms to preview a rupee -> dollar
// conversion before saving. The server re-derives the same rate on save.
export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam ? new Date(dateParam) : undefined;
  try {
    return NextResponse.json(await getUsdInrRate(date));
  } catch (err) {
    console.error("USD/INR lookup failed", err);
    return NextResponse.json({ error: "Couldn't fetch the USD/INR rate right now." }, { status: 502 });
  }
}
