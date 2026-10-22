import type { HistoryPoint } from "@/lib/providers/types";

// Price levels for the stock panel: support/resistance, volume profile,
// big-buyer cost basis (NSE bulk/block deals) and a long-term buy zone
// where those agree. Pure functions - no I/O - so every number on the
// card can be unit-tested.
//
// These are REFERENCE levels, not predictions. A support is where buyers
// stepped in before; nothing guarantees they will again. The card says
// so, and the buy zone reports how often its own zone actually held.

export interface Level {
  price: number;
  low: number; // zone bounds - a level is a band, not a line
  high: number;
  touches: number; // swing highs/lows that formed in this band
  lastTouched: string; // ISO date
}

export interface VolumeProfile {
  poc: number; // "point of control" - the price band with the most volume
  valueAreaLow: number; // band holding 70% of volume around the POC
  valueAreaHigh: number;
  days: number;
}

export interface Deal {
  date: string; // ISO date
  client: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number; // weighted average trade price
  kind: "bulk" | "block";
}

export interface BigBuyer {
  client: string;
  quantity: number; // net shares bought
  avgPrice: number;
  value: number;
  firstDate: string;
  lastDate: string;
}

export interface BigBuyerSummary {
  buyers: BigBuyer[]; // top net buyers by value
  avgPrice: number | null; // value-weighted cost basis of all net buyers
  totalQuantity: number;
  tradersExcluded: number; // clients who both bought and sold (HFT/prop/arbitrage)
  dealCount: number;
}

export interface BuyZone {
  low: number;
  high: number;
  mid: number;
  distancePct: number; // from current price to zone top; 0 = price is in the zone
  evidence: string[]; // which levels agree, human-readable
  tests: number; // past episodes where price came down into the zone
  holds: number; // ...and did NOT close >3% below it within the next 20 sessions
}

const SWING_WINDOW = 5; // bars each side for a swing high/low
const CLUSTER_PCT = 1.5; // swings within this % of each other are one level
const VALUE_AREA = 0.7;
const PROFILE_BUCKETS = 50;
const ZONE_MERGE_PCT = 3; // candidates within this % form one buy zone
const BREAK_PCT = 3; // close this far below the zone = it broke
const TEST_LOOKAHEAD = 20;

/** Indices of swing lows (or highs): the extreme of a ±window neighbourhood. */
function swings(history: HistoryPoint[], kind: "low" | "high", window = SWING_WINDOW): number[] {
  const value = (i: number) => (kind === "low" ? history[i].low ?? history[i].close : history[i].high ?? history[i].close);
  const out: number[] = [];
  for (let i = window; i < history.length - window; i++) {
    let extreme = true;
    for (let j = i - window; j <= i + window && extreme; j++) {
      if (j === i) continue;
      if (kind === "low" ? value(j) < value(i) : value(j) > value(i)) extreme = false;
    }
    if (extreme) out.push(i);
  }
  return out;
}

/**
 * Support and resistance from swing highs/lows, clustered into bands.
 * Both kinds feed one pool (an old resistance often becomes support once
 * broken), then split by which side of the current price they sit on.
 * Strongest = most touches, ties to the more recent.
 */
export function supportResistance(history: HistoryPoint[], currentPrice: number, perSide = 3): { supports: Level[]; resistances: Level[] } {
  const points = [
    ...swings(history, "low").map((i) => ({ price: history[i].low ?? history[i].close, date: history[i].date })),
    ...swings(history, "high").map((i) => ({ price: history[i].high ?? history[i].close, date: history[i].date })),
  ].sort((a, b) => a.price - b.price);

  const clusters: { price: number; date: string }[][] = [];
  for (const p of points) {
    const last = clusters[clusters.length - 1];
    if (last && (p.price - last[0].price) / last[0].price <= CLUSTER_PCT / 100) last.push(p);
    else clusters.push([p]);
  }

  const levels: Level[] = clusters.map((c) => {
    const prices = c.map((p) => p.price).sort((a, b) => a - b);
    return {
      price: prices[Math.floor(prices.length / 2)],
      low: prices[0],
      high: prices[prices.length - 1],
      touches: c.length,
      lastTouched: c.map((p) => p.date).sort().at(-1)!,
    };
  });

  const rank = (a: Level, b: Level) => b.touches - a.touches || b.lastTouched.localeCompare(a.lastTouched);
  // A band the price is sitting inside is neither support nor resistance yet.
  const supports = levels.filter((l) => l.high < currentPrice).sort(rank).slice(0, perSide).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.low > currentPrice).sort(rank).slice(0, perSide).sort((a, b) => a.price - b.price);
  return { supports, resistances };
}

/**
 * Where shares actually changed hands. Each day's volume is spread evenly
 * across its high-low range, bucketed by price. Null without volume data.
 */
export function volumeProfile(history: HistoryPoint[]): VolumeProfile | null {
  const days = history.filter((p) => p.volume && p.volume > 0);
  if (days.length < 20) return null;
  const lo = Math.min(...days.map((p) => p.low ?? p.close));
  const hi = Math.max(...days.map((p) => p.high ?? p.close));
  if (!(hi > lo)) return null;

  const size = (hi - lo) / PROFILE_BUCKETS;
  const buckets = new Array(PROFILE_BUCKETS).fill(0);
  const bucketOf = (price: number) => Math.min(PROFILE_BUCKETS - 1, Math.max(0, Math.floor((price - lo) / size)));
  for (const p of days) {
    const a = bucketOf(p.low ?? p.close);
    const b = bucketOf(p.high ?? p.close);
    for (let k = a; k <= b; k++) buckets[k] += p.volume! / (b - a + 1);
  }

  const pocIndex = buckets.indexOf(Math.max(...buckets));
  const total = buckets.reduce((s, v) => s + v, 0);
  let [from, to, inArea] = [pocIndex, pocIndex, buckets[pocIndex]];
  while (inArea < total * VALUE_AREA && (from > 0 || to < PROFILE_BUCKETS - 1)) {
    const below = from > 0 ? buckets[from - 1] : -1;
    const above = to < PROFILE_BUCKETS - 1 ? buckets[to + 1] : -1;
    if (above >= below) inArea += buckets[++to];
    else inArea += buckets[--from];
  }
  return {
    poc: lo + (pocIndex + 0.5) * size,
    valueAreaLow: lo + from * size,
    valueAreaHigh: lo + (to + 1) * size,
    days: days.length,
  };
}

/**
 * Net buyers from NSE bulk/block deals. A client on both sides (bought
 * AND sold more than 20% of that back) is a trader - HFT, prop desk,
 * arbitrage - not someone accumulating, so they're excluded rather than
 * letting their round trips masquerade as "big money bought here".
 */
export function bigBuyers(deals: Deal[], top = 5): BigBuyerSummary {
  const byClient = new Map<string, { buyQty: number; buyValue: number; sellQty: number; dates: string[] }>();
  for (const d of deals) {
    const c = byClient.get(d.client) ?? { buyQty: 0, buyValue: 0, sellQty: 0, dates: [] };
    if (d.side === "BUY") {
      c.buyQty += d.quantity;
      c.buyValue += d.quantity * d.price;
    } else {
      c.sellQty += d.quantity;
    }
    c.dates.push(d.date);
    byClient.set(d.client, c);
  }

  let tradersExcluded = 0;
  const buyers: BigBuyer[] = [];
  for (const [client, c] of byClient) {
    if (c.buyQty === 0) continue;
    if (c.sellQty > c.buyQty * 0.2) {
      tradersExcluded++;
      continue;
    }
    const dates = c.dates.sort();
    buyers.push({
      client,
      quantity: c.buyQty - c.sellQty,
      avgPrice: c.buyValue / c.buyQty,
      value: c.buyValue,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
    });
  }
  buyers.sort((a, b) => b.value - a.value);
  const totalValue = buyers.reduce((s, b) => s + b.value, 0);
  const totalBought = buyers.reduce((s, b) => s + b.value / b.avgPrice, 0);
  return {
    buyers: buyers.slice(0, top),
    avgPrice: totalBought > 0 ? totalValue / totalBought : null,
    totalQuantity: buyers.reduce((s, b) => s + b.quantity, 0),
    tradersExcluded,
    dealCount: deals.length,
  };
}

export function sma(history: HistoryPoint[], period: number): number | null {
  if (history.length < period) return null;
  return history.slice(-period).reduce((s, p) => s + p.close, 0) / period;
}

/**
 * How often a zone held in the past: each time price came down into it
 * (from above), did it close more than BREAK_PCT below the zone within
 * the next TEST_LOOKAHEAD sessions? In-sample by construction - the zone
 * was found in this same history - so treat it as an upper bound.
 */
export function zoneTests(history: HistoryPoint[], low: number, high: number): { tests: number; holds: number } {
  let tests = 0;
  let holds = 0;
  for (let i = 1; i < history.length - 1; i++) {
    const entered = (history[i].low ?? history[i].close) <= high && (history[i - 1].low ?? history[i - 1].close) > high;
    if (!entered) continue;
    tests++;
    const window = history.slice(i, i + TEST_LOOKAHEAD + 1);
    if (!window.some((p) => p.close < low * (1 - BREAK_PCT / 100))) holds++;
    i += TEST_LOOKAHEAD; // one test per episode
  }
  return { tests, holds };
}

/**
 * Long-term buy zone: the tightest place BELOW the current price where
 * independent levels agree - swing supports, the volume POC / value-area
 * low, big buyers' average cost, the 200-day average. More agreement =
 * stronger zone. Null when nothing sits below price (e.g. at a 2-year low).
 */
export function buyZone(params: {
  history: HistoryPoint[];
  currentPrice: number;
  supports: Level[];
  profile: VolumeProfile | null;
  bigBuyerAvg: number | null;
  formatPrice: (n: number) => string;
}): BuyZone | null {
  const { history, currentPrice, supports, profile, bigBuyerAvg, formatPrice } = params;
  const sma200 = sma(history, 200);
  const candidates: { price: number; weight: number; label: string }[] = [];
  for (const s of supports) candidates.push({ price: s.price, weight: Math.min(3, s.touches), label: `Support ${formatPrice(s.price)} (${s.touches} touches)` });
  if (profile) {
    candidates.push({ price: profile.poc, weight: 2, label: `Highest-volume price ${formatPrice(profile.poc)}` });
    candidates.push({ price: profile.valueAreaLow, weight: 1, label: `Bottom of the high-volume range ${formatPrice(profile.valueAreaLow)}` });
  }
  if (bigBuyerAvg != null) candidates.push({ price: bigBuyerAvg, weight: 2, label: `Big buyers' average cost ${formatPrice(bigBuyerAvg)}` });
  if (sma200 != null) candidates.push({ price: sma200, weight: 1, label: `200-day average ${formatPrice(sma200)}` });

  // Allow levels just above price too (within the merge band) - if price
  // is already sitting on a strong level, that IS the zone.
  const below = candidates.filter((c) => c.price <= currentPrice * (1 + ZONE_MERGE_PCT / 200));
  if (below.length === 0) return null;

  let best: { members: typeof below; score: number } | null = null;
  for (const anchor of below) {
    const members = below.filter((c) => Math.abs(c.price - anchor.price) / anchor.price <= ZONE_MERGE_PCT / 100);
    const score = members.reduce((s, m) => s + m.weight, 0);
    const nearer = best && Math.max(...members.map((m) => m.price)) > Math.max(...best.members.map((m) => m.price));
    if (!best || score > best.score || (score === best.score && nearer)) best = { members, score };
  }

  const prices = best!.members.map((m) => m.price);
  let low = Math.min(...prices);
  let high = Math.max(...prices);
  if ((high - low) / low < 0.02) {
    // A single line is false precision - give it a ±1% band.
    const mid = (low + high) / 2;
    low = mid * 0.99;
    high = mid * 1.01;
  }
  const { tests, holds } = zoneTests(history, low, high);
  return {
    low,
    high,
    mid: (low + high) / 2,
    distancePct: currentPrice <= high ? 0 : ((currentPrice - high) / currentPrice) * 100,
    evidence: best!.members.sort((a, b) => b.weight - a.weight).map((m) => m.label),
    tests,
    holds,
  };
}
