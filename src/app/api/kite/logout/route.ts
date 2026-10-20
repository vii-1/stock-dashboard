import { NextResponse } from "next/server";
import { logoutKite } from "@/lib/kite/session";

// POST /api/kite/logout - invalidates today's Kite token (read-only link).
export async function POST() {
  await logoutKite();
  return new NextResponse(null, { status: 204 });
}
