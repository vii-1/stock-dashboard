import { NextResponse } from "next/server";
import { getLoginUrl } from "@/lib/kite/session";

// GET /api/kite/login -> redirect to Kite's hosted login page. The user
// authenticates there (and on their phone/TOTP, outside this app
// entirely) - we never see their Zerodha password.
export async function GET() {
  try {
    return NextResponse.redirect(getLoginUrl());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build Kite login URL" },
      { status: 500 }
    );
  }
}
