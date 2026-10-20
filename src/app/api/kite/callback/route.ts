import { NextRequest, NextResponse } from "next/server";
import { exchangeRequestToken } from "@/lib/kite/session";

// GET /api/kite/callback - this exact path must match the redirect URL
// registered for the Kite Connect app at developers.kite.trade.
export async function GET(request: NextRequest) {
  const requestToken = request.nextUrl.searchParams.get("request_token");
  const status = request.nextUrl.searchParams.get("status");

  if (status !== "success" || !requestToken) {
    return NextResponse.redirect(new URL("/brokers?broker=kite&error=login_failed", request.url));
  }

  try {
    await exchangeRequestToken(requestToken);
    return NextResponse.redirect(new URL("/brokers?connected=kite", request.url));
  } catch (err) {
    console.error("Kite token exchange failed", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(new URL(`/brokers?broker=kite&error=${encodeURIComponent(message)}`, request.url));
  }
}
