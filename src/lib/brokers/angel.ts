import { prisma } from "@/lib/prisma";
import { BrokerSessionError, type BrokerHolding } from "./types";

// Angel One SmartAPI - read-only. Login + holdings + profile only; there
// is deliberately no order function here (same rule as lib/kite/client.ts).
//
// Login uses SmartAPI's documented loginByPassword: client code + MPIN +
// the current 6-digit TOTP from your authenticator app. Those three go
// straight to Angel and are never stored - only the resulting session
// JWT is kept (BrokerSession row "angel"), and it lasts about a day.
// (SmartAPI's redirect "publisher login" was the alternative, but its
// returned tokens are inconsistently documented - see forum threads.)

const BASE = "https://apiconnect.angelone.in";
const BROKER = "angel";

export function isAngelConfigured(): boolean {
  return Boolean(process.env.ANGEL_API_KEY);
}

function headers(jwt?: string): Record<string, string> {
  const apiKey = process.env.ANGEL_API_KEY;
  if (!apiKey) throw new Error("ANGEL_API_KEY is not set in .env");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    // SmartAPI requires these headers; it accepts placeholders for a
    // local app (they're used for its own audit logging).
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": apiKey,
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
}

// SmartAPI answers { status, message, errorcode, data }. Token problems
// come back as AG8001/AG8002/AG8003 (sometimes with HTTP 401).
const TOKEN_ERRORS = new Set(["AG8001", "AG8002", "AG8003"]);

async function angelCall<T>(path: string, init: { method: "GET" | "POST"; jwt?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: headers(init.jwt),
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON (e.g. plain-text 401 / rate-limit page)
  }
  if (res.status === 401 || TOKEN_ERRORS.has(body?.errorcode)) {
    throw new BrokerSessionError(body?.message ?? "Angel One session expired - log in again");
  }
  if (!res.ok || !body || body.status === false) {
    throw new Error(body?.message ? `${body.message}${body.errorcode ? ` (${body.errorcode})` : ""}` : `Angel One ${path} failed: ${res.status} ${text.slice(0, 120)}`);
  }
  return body.data as T;
}

// Angel sessions last ~24-28h; treat them as valid until 5 AM IST the
// next day so the UI asks for a fresh login each trading day, like Kite.
function nextExpiry(now = new Date()): Date {
  const IST_OFFSET_MS = 5.5 * 3600 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const expiryIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (ist.getUTCHours() >= 5 ? 1 : 0), 5);
  return new Date(expiryIst - IST_OFFSET_MS);
}

export async function loginAngel(input: { clientCode: string; mpin: string; totp: string }): Promise<{ userId: string; userName: string | null }> {
  const data = await angelCall<{ jwtToken: string; refreshToken: string; feedToken: string }>(
    "/rest/auth/angelbroking/user/v1/loginByPassword",
    { method: "POST", body: { clientcode: input.clientCode, password: input.mpin, totp: input.totp } }
  );
  const jwt = data?.jwtToken?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Angel One login succeeded but returned no session token");

  let userName: string | null = null;
  try {
    const profile = await angelCall<{ clientcode: string; name: string }>("/rest/secure/angelbroking/user/v1/getProfile", { method: "GET", jwt });
    userName = profile?.name?.trim() || null;
  } catch {
    // name is cosmetic - keep the session even if the profile call fails
  }

  const userId = input.clientCode.toUpperCase();
  await prisma.brokerSession.upsert({
    where: { broker: BROKER },
    create: { broker: BROKER, accessToken: jwt, userId, userName, expiresAt: nextExpiry() },
    update: { accessToken: jwt, userId, userName, fetchedAt: new Date(), expiresAt: nextExpiry() },
  });
  return { userId, userName };
}

export async function getAngelSession() {
  const session = await prisma.brokerSession.findUnique({ where: { broker: BROKER } });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

export async function logoutAngel(): Promise<void> {
  const session = await prisma.brokerSession.findUnique({ where: { broker: BROKER } });
  if (!session) return;
  try {
    await angelCall("/rest/secure/angelbroking/user/v1/logout", { method: "POST", jwt: session.accessToken, body: { clientcode: session.userId } });
  } catch {
    // already invalid on Angel's side - just drop it locally
  }
  await prisma.brokerSession.delete({ where: { broker: BROKER } });
}

interface AngelRawHolding {
  tradingsymbol: string; // "SBIN-EQ"
  exchange: string;
  isin: string;
  quantity: number;
  t1quantity: number;
  averageprice: number;
  ltp: number;
  close: number;
  profitandloss: number;
}

// "SBIN-EQ" / "XYZ-BE" -> "SBIN" / "XYZ": Angel suffixes the NSE series.
export function normaliseAngelSymbol(tradingsymbol: string): string {
  return tradingsymbol.replace(/-(EQ|BE|BZ|SM|ST|GB|N\d|X\d)$/i, "").toUpperCase();
}

export function mapAngelHolding(h: AngelRawHolding): BrokerHolding {
  const qty = Number(h.quantity) || 0;
  const t1 = Number(h.t1quantity) || 0;
  const avg = Number(h.averageprice) || 0;
  const ltp = Number(h.ltp) || 0;
  const close = Number(h.close) || 0;
  return {
    broker: "angel",
    tradingsymbol: normaliseAngelSymbol(h.tradingsymbol),
    exchange: h.exchange === "BSE" ? "BSE" : "NSE",
    isin: h.isin,
    quantity: qty,
    t1Quantity: t1,
    averagePrice: avg,
    lastPrice: ltp,
    closePrice: close,
    // Computed rather than trusting profitandloss - Angel has returned 0
    // there for individual holdings in the past (their forum, 2024).
    pnl: (ltp - avg) * (qty + t1),
    dayChangePct: close > 0 ? ((ltp - close) / close) * 100 : 0,
  };
}

export async function getAngelHoldings(): Promise<BrokerHolding[]> {
  const session = await getAngelSession();
  if (!session) throw new BrokerSessionError("Not logged in to Angel One today");
  try {
    const data = await angelCall<AngelRawHolding[] | null>("/rest/secure/angelbroking/portfolio/v1/getHolding", {
      method: "GET",
      jwt: session.accessToken,
    });
    return (data ?? []).map(mapAngelHolding);
  } catch (err) {
    // A rejected token won't recover - clear it so the UI shows "log in".
    if (err instanceof BrokerSessionError) await prisma.brokerSession.delete({ where: { broker: BROKER } }).catch(() => {});
    throw err;
  }
}
