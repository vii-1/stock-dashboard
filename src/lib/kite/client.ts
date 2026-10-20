import { getValidKiteSession } from "@/lib/kite/session";

// Read-only Kite REST calls - holdings, mutual funds/SIPs and margins only. There is
// deliberately no order/GTT function in this file; don't add one here
// (see TRADING_AGENT_DESIGN.md §6 - real-money orders are a manual,
// explicit step, never something the dashboard does).
//
// Types below cover only the fields we use, and were checked against a
// real account's responses (via the Kite MCP, 2026-10-19) rather than
// guessed from docs. Kite wraps every REST response as
// { status: "success", data: ... } or { status: "error", message, error_type }.

const KITE_API_BASE = "https://api.kite.trade";

export interface KiteHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  quantity: number;
  t1_quantity: number;
  average_price: number;
  last_price: number;
  close_price: number;
  // (last_price - average_price) * quantity - confirmed on real data.
  pnl: number;
  day_change: number;
  day_change_percentage: number;
}

interface KiteMarginSegment {
  enabled: boolean;
  net: number;
  available: { cash: number; live_balance: number; opening_balance: number; collateral: number };
  utilised: { debits: number };
}

export interface KiteMargins {
  equity: KiteMarginSegment;
  commodity: KiteMarginSegment;
}

export class KiteSessionError extends Error {}

async function kiteGet<T>(path: string): Promise<T> {
  const apiKey = process.env.KITE_API_KEY;
  const session = await getValidKiteSession();
  if (!apiKey || !session) throw new KiteSessionError("Not connected to Kite, or today's token has expired");

  const res = await fetch(`${KITE_API_BASE}${path}`, {
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${apiKey}:${session.accessToken}`,
    },
    cache: "no-store",
  });

  const body = await res.json();
  if (!res.ok || body.status !== "success") {
    // TokenException means the token was revoked/expired before our
    // "same calendar day" check caught it - treat as a re-login prompt.
    if (body?.error_type === "TokenException") throw new KiteSessionError(body.message);
    throw new Error(body?.message ?? `Kite ${path} failed: ${res.status}`);
  }
  return body.data as T;
}

export function getHoldings(): Promise<KiteHolding[]> {
  return kiteGet<KiteHolding[]>("/portfolio/holdings");
}

export function getMargins(): Promise<KiteMargins> {
  return kiteGet<KiteMargins>("/user/margins");
}

// --- Mutual funds (Zerodha Coin) ---
// Coin MF units don't sit in the demat holdings above - they need their
// own endpoints. Fields checked against a real account 2026-10-19.

export interface KiteMfHolding {
  tradingsymbol: string; // ISIN, e.g. "INF179K01XQ0"
  fund: string;
  folio: string;
  quantity: number; // units
  average_price: number; // avg NAV paid
  last_price: number; // latest NAV
  last_price_date: string; // often "" in practice
  // Kite returns 0 here for every fund (observed on real data) - compute
  // P&L from units * (NAV - avg NAV) instead of reading this.
  pnl: number;
}

export interface KiteSip {
  sip_id: string;
  tradingsymbol: string; // ISIN, joins to KiteMfHolding.tradingsymbol
  fund: string;
  status: string; // "ACTIVE" | "PAUSED" | "CANCELLED" ...
  frequency: string; // "monthly" | "weekly" | "quarterly"
  instalment_amount: number;
  instalments: number; // -1 = until cancelled
  completed_instalments: number;
  next_instalment: string; // YYYY-MM-DD
  instalment_day: number;
}

export function getMfHoldings(): Promise<KiteMfHolding[]> {
  return kiteGet<KiteMfHolding[]>("/mf/holdings");
}

export function getMfSips(): Promise<KiteSip[]> {
  return kiteGet<KiteSip[]>("/mf/sips");
}
