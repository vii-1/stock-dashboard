import { NextResponse } from "next/server";
import { logoutAngel } from "@/lib/brokers/angel";

// POST /api/brokers/angel/logout - ends the session on Angel's side too.
export async function POST() {
  await logoutAngel();
  return new NextResponse(null, { status: 204 });
}
