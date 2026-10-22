import { withCache } from "@/lib/cache/ttlCache";
import type { Deal } from "./priceLevels";

// NSE bulk + block deals for one symbol over the last year - the only
// free, public record of WHO bought big and AT WHAT PRICE (each row has
// client name, side, quantity and weighted average trade price).
//
// Endpoint checked 2026-10-22: works without NSE's session cookie from
// a browser-like UA + Referer; returns {"data": []} when there were no
// deals (common for large caps - big funds mostly buy in the open market,
// which isn't disclosed per client). NSE does bot-filter, so failures are
// expected now and then: callers treat this as optional.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function ddmmyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

/** "24-JUN-2026" -> "2026-06-24" */
function isoFromNse(s: string): string {
  const [dd, mon, yyyy] = s.split("-");
  return `${yyyy}-${String(MONTHS.indexOf(mon.toUpperCase()) + 1).padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

async function fetchKind(symbol: string, kind: "bulk" | "block", from: Date, to: Date): Promise<Deal[]> {
  const url = `https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=${kind}_deals&symbol=${encodeURIComponent(symbol)}&from=${ddmmyyyy(from)}&to=${ddmmyyyy(to)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.nseindia.com/", Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NSE ${kind} deals: HTTP ${res.status}`);
  const body = await res.json(); // throws on NSE's HTML bot page - intended
  const rows: any[] = body?.data ?? [];
  return rows
    .filter((r) => r.BD_CLIENT_NAME && r.BD_QTY_TRD > 0 && r.BD_TP_WATP > 0)
    .map((r) => ({
      date: isoFromNse(r.BD_DT_DATE),
      client: String(r.BD_CLIENT_NAME).trim(),
      side: r.BD_BUY_SELL === "SELL" ? "SELL" : "BUY",
      quantity: Number(r.BD_QTY_TRD),
      price: Number(r.BD_TP_WATP),
      kind,
    }));
}

/** `symbol` is the bare NSE ticker (RELIANCE, not RELIANCE.NS). */
export async function getNseDeals(symbol: string, days = 365): Promise<Deal[]> {
  return withCache(`nse:deals:${symbol}:${days}`, 6 * 3600, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    const [bulk, block] = await Promise.all([fetchKind(symbol, "bulk", from, to), fetchKind(symbol, "block", from, to)]);
    return [...bulk, ...block].sort((a, b) => a.date.localeCompare(b.date));
  });
}
