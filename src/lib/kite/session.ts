import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

// Read-only account link - no orders are ever placed through this.
// Single row since this is a single-user dashboard. Kite's login flow
// (see https://kite.trade/docs/connect/v3/user/#login-flow):
//   1. Redirect the user to the login URL below.
//   2. Kite redirects back to our registered redirect URL with a
//      short-lived, single-use `request_token`.
//   3. Exchange that for an `access_token` via a signed POST - the
//      signature is SHA-256(api_key + request_token + api_secret).
// The access token is valid for the rest of the trading day only -
// there's no refresh token for personal use, so re-login is a daily,
// manual step (see /kite), not something to automate away.

const SESSION_ID = "default";
const KITE_LOGIN_URL = "https://kite.zerodha.com/connect/login";
const KITE_TOKEN_URL = "https://api.kite.trade/session/token";

export function isKiteConfigured(): boolean {
  return Boolean(process.env.KITE_API_KEY && process.env.KITE_API_SECRET);
}

export function getLoginUrl(): string {
  const apiKey = process.env.KITE_API_KEY;
  if (!apiKey) throw new Error("KITE_API_KEY is not set");
  return `${KITE_LOGIN_URL}?v=3&api_key=${encodeURIComponent(apiKey)}`;
}

export async function exchangeRequestToken(requestToken: string): Promise<{ accessToken: string; userId: string }> {
  const apiKey = process.env.KITE_API_KEY;
  const apiSecret = process.env.KITE_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("KITE_API_KEY/KITE_API_SECRET are not set");

  const checksum = crypto
    .createHash("sha256")
    .update(apiKey + requestToken + apiSecret)
    .digest("hex");

  const res = await fetch(KITE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }),
    cache: "no-store",
  });

  const body = await res.json();
  if (!res.ok || body.status !== "success") {
    throw new Error(body?.message ?? `Kite token exchange failed: ${res.status}`);
  }

  const accessToken: string = body.data.access_token;
  const userId: string = body.data.user_id;

  await prisma.kiteSession.upsert({
    where: { id: SESSION_ID },
    create: { id: SESSION_ID, accessToken, kiteUserId: userId },
    update: { accessToken, kiteUserId: userId, fetchedAt: new Date() },
  });

  return { accessToken, userId };
}

// Approximates Kite's "valid for the rest of the trading day" rule as
// "issued today" (server-local calendar day) - same convention
// runAgent.ts uses for its own daily reset. Not exact around midnight,
// fine for a personal dashboard.
export async function getValidKiteSession() {
  const session = await prisma.kiteSession.findUnique({ where: { id: SESSION_ID } });
  if (!session) return null;
  const isSameDay = new Date().toDateString() === session.fetchedAt.toDateString();
  return isSameDay ? session : null;
}

// Ends the session on Kite's side (DELETE /session/token) and locally.
// A failure upstream (token already expired) still clears the local row.
export async function logoutKite(): Promise<void> {
  const session = await prisma.kiteSession.findUnique({ where: { id: SESSION_ID } });
  if (!session) return;
  const apiKey = process.env.KITE_API_KEY;
  if (apiKey) {
    await fetch(
      `${KITE_TOKEN_URL}?api_key=${encodeURIComponent(apiKey)}&access_token=${encodeURIComponent(session.accessToken)}`,
      { method: "DELETE", headers: { "X-Kite-Version": "3", Authorization: `token ${apiKey}:${session.accessToken}` }, cache: "no-store" }
    ).catch(() => {});
  }
  await prisma.kiteSession.delete({ where: { id: SESSION_ID } }).catch(() => {});
}
