import { getMfHoldings, getMfSips, type KiteSip } from "@/lib/kite/client";
import { getValidKiteSession, isKiteConfigured } from "@/lib/kite/session";
import type { KiteMfRow } from "@/components/KiteMfTable";

export type MutualFundsResult =
  | { state: "unconfigured" }
  | { state: "disconnected" }
  | { state: "error"; error: string }
  | {
      state: "ok";
      rows: KiteMfRow[];
      orphanSips: KiteSip[];
      monthlySip: number;
      invested: number;
      current: number;
    };

// Rough monthly equivalent so weekly/quarterly SIPs add up sensibly.
const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3 };

// Coin mutual funds + SIPs, shared by /kite and /portfolio. Never throws:
// an MF API hiccup (or a lapsed daily token) becomes a state the section
// renders, instead of blanking the page. SIPs join to holdings on ISIN.
export async function loadMutualFunds(): Promise<MutualFundsResult> {
  if (!isKiteConfigured()) return { state: "unconfigured" };
  if (!(await getValidKiteSession())) return { state: "disconnected" };

  try {
    const [holdings, sips] = await Promise.all([getMfHoldings(), getMfSips()]);
    const live = sips.filter((s) => s.status !== "CANCELLED");
    const rows = holdings.map((h): KiteMfRow => {
      const invested = h.average_price * h.quantity;
      const current = h.last_price * h.quantity;
      return {
        ...h,
        invested,
        current,
        pnlComputed: current - invested,
        sip: live.find((s) => s.tradingsymbol === h.tradingsymbol) ?? null,
      };
    });
    const held = new Set(holdings.map((h) => h.tradingsymbol));
    return {
      state: "ok",
      rows,
      orphanSips: live.filter((s) => !held.has(s.tradingsymbol)),
      monthlySip: live
        .filter((s) => s.status === "ACTIVE")
        .reduce((sum, s) => sum + s.instalment_amount * (PER_MONTH[s.frequency] ?? 1), 0),
      invested: rows.reduce((sum, r) => sum + r.invested, 0),
      current: rows.reduce((sum, r) => sum + r.current, 0),
    };
  } catch (err) {
    return { state: "error", error: err instanceof Error ? err.message : "Unknown error" };
  }
}
