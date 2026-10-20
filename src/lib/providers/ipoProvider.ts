import { withCache } from "@/lib/cache/ttlCache";

// Two separate free IPO calendar APIs (India via ipoalerts.in, US via
// Finnhub) - kept out of the MarketDataProvider interface since IPOs
// aren't quotes/movers/history, just a normalized list per market.

export interface UpcomingIpo {
  name: string;
  exchange: string;
  openDate: string | null;
  closeDate: string | null;
  priceBand: string | null;
}

export function isIndiaIpoConfigured(): boolean {
  return Boolean(process.env.IPOALERTS_API_KEY);
}

export function isUsIpoConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

// ipoalerts.in's free plan is more restrictive than their docs suggest
// (confirmed by hitting the live API): `status=upcoming` and most other
// status values 400 with "not supported for free plan users" - only
// `status=open` (IPOs currently accepting bids) works. It also caps free
// responses at 1 result/page and 6 requests/minute, so this is cached
// hard (30 min) to avoid burning that quota on repeat page loads.
export async function getUpcomingIndiaIpos(): Promise<UpcomingIpo[]> {
  const apiKey = process.env.IPOALERTS_API_KEY;
  if (!apiKey) throw new Error("IPOALERTS_API_KEY is not set");

  return withCache("ipoalerts:open", 1800, async () => {
    const res = await fetch("https://api.ipoalerts.in/ipos?status=open", {
      headers: { "x-api-key": apiKey },
      cache: "no-store", // see yahooFetch - withCache handles freshness
    });
    if (!res.ok) throw new Error(`ipoalerts.in request failed: ${res.status}`);

    const body = await res.json();
    const ipos: any[] = body.ipos ?? [];

    return ipos.map((ipo) => ({
      name: ipo.name ?? "Unknown",
      exchange: ipo.source ? ipo.source.toUpperCase() : "NSE/BSE",
      openDate: ipo.startDate ?? null,
      closeDate: ipo.endDate ?? null,
      priceBand: ipo.priceRange ? `₹${ipo.priceRange}` : null,
    }));
  });
}

export async function getUpcomingUsIpos(): Promise<UpcomingIpo[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY is not set");

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return withCache(`finnhub:ipo:${from}:${to}`, 1800, async () => {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${apiKey}`,
      { cache: "no-store" } // see yahooFetch - withCache handles freshness
    );
    if (!res.ok) throw new Error(`Finnhub request failed: ${res.status}`);

    const body = await res.json();
    const ipos: any[] = body.ipoCalendar ?? [];

    return ipos.map((ipo) => ({
      name: ipo.name ?? "Unknown",
      exchange: ipo.exchange ?? "US",
      openDate: ipo.date ?? null,
      closeDate: ipo.date ?? null,
      priceBand:
        ipo.price != null && ipo.price !== "" ? `$${ipo.price}` : ipo.numberOfShares ? "TBD" : null,
    }));
  });
}
