import { NextRequest, NextResponse } from "next/server";
import { isAngelConfigured, loginAngel } from "@/lib/brokers/angel";

// POST /api/brokers/angel/login { clientCode, mpin, totp }
// Credentials are forwarded to Angel One once and never stored or
// logged - only the session token Angel returns is saved.
export async function POST(request: NextRequest) {
  if (!isAngelConfigured()) {
    return NextResponse.json({ error: "Add ANGEL_API_KEY to .env first." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const clientCode = typeof body?.clientCode === "string" ? body.clientCode.trim() : "";
  const mpin = typeof body?.mpin === "string" ? body.mpin.trim() : "";
  const totp = typeof body?.totp === "string" ? body.totp.replace(/\s/g, "") : "";
  if (!clientCode || !/^\d{4,6}$/.test(mpin) || !/^\d{6}$/.test(totp)) {
    return NextResponse.json({ error: "Enter your client ID, 4-6 digit MPIN and the current 6-digit TOTP." }, { status: 400 });
  }
  try {
    return NextResponse.json(await loginAngel({ clientCode, mpin, totp }));
  } catch (err) {
    // Angel's message (e.g. "Invalid totp and client combination") is safe to show.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Login failed" }, { status: 401 });
  }
}
