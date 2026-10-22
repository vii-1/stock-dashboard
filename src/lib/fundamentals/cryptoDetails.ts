import { withCache } from "@/lib/cache/ttlCache";
import { coingeckoProvider } from "@/lib/providers/coingeckoProvider";
import { scoreHolding, type SuggestionResult } from "@/lib/suggestions/scoreHolding";
import { buildCryptoProsCons } from "./cryptoAnalysis";
import type { ChartPoint, ChartRange } from "./yahooFundamentals";

// Coin "fundamentals" from CoinGecko's /coins/{id} - the crypto
// counterpart of stockDetails.ts. One call per coin per 10 minutes
// (cached), since CoinGecko's keyless tier rate-limits hard.

const CG = "https://api.coingecko.com/api/v3";

async function cgFetch(path: string): Promise<any> {
  const res = await fetch(`${CG}${path}`, {
    headers: process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : undefined,
    cache: "no-store",
  });
  if (res.status === 429) throw new Error("CoinGecko rate limit hit - try again in a minute.");
  if (res.status === 404) throw new Error("Unknown coin");
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
  return res.json();
}

export interface CoinStat {
  label: string;
  value: number | string | null;
  value2?: number | null; // second figure for High / Low pairs
  // usd: price-like; usdBig: compact ($1.6T); pct: %; supply: token count; text/date
  kind: "usd" | "usdBig" | "pct" | "supply" | "text" | "date";
  hint?: string;
}

export interface CryptoDetails {
  id: string; // CoinGecko id, "bitcoin"
  ticker: string; // "BTC"
  name: string;
  image: string | null;
  rank: number | null;
  categories: string[];
  website: string | null;
  description: string | null;
  priceUsd: number;
  priceInr: number | null;
  changePercent: number; // 24h
  stats: CoinStat[];
  pros: string[];
  cons: string[];
  technical: SuggestionResult | null;
  warnings: string[];
}

interface CoinRaw {
  id: string;
  symbol: string;
  name: string;
  image?: { small?: string; large?: string };
  market_cap_rank: number | null;
  categories: (string | null)[];
  genesis_date: string | null;
  hashing_algorithm: string | null;
  links?: { homepage?: string[] };
  description?: { en?: string };
  market_data: any;
}

function getCoin(id: string): Promise<CoinRaw> {
  return withCache(`cg:coin:${id}`, 600, () =>
    cgFetch(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`)
  );
}

// CoinGecko descriptions are HTML with links; keep plain text paragraphs.
function plainText(html: string | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

export async function getCryptoDetails(id: string): Promise<CryptoDetails> {
  const warnings: string[] = [];
  const [coin, history] = await Promise.all([
    getCoin(id),
    coingeckoProvider.getHistory(id, 120).catch(() => {
      warnings.push("Price history for the technical view is unavailable right now.");
      return [];
    }),
  ]);
  const m = coin.market_data ?? {};
  const price = num(m.current_price?.usd) ?? 0;
  const marketCap = num(m.market_cap?.usd);
  const fdv = num(m.fully_diluted_valuation?.usd);
  const volume = num(m.total_volume?.usd);
  const circulating = num(m.circulating_supply);
  const total = num(m.total_supply);
  const max = num(m.max_supply);
  const categories = (coin.categories ?? []).filter((c): c is string => !!c);
  const isStablecoin = categories.some((c) => /stablecoin/i.test(c));

  const stats: CoinStat[] = [
    { label: "Market Cap", value: marketCap, kind: "usdBig" },
    { label: "Current Price", value: price, kind: "usd" },
    { label: "24h High / Low", value: num(m.high_24h?.usd), value2: num(m.low_24h?.usd), kind: "usd" },
    { label: "Fully Diluted Value", value: fdv, kind: "usdBig", hint: "Market cap if the maximum supply were all in circulation" },
    { label: "24h Volume", value: volume, kind: "usdBig" },
    { label: "Volume / Market Cap", value: volume != null && marketCap ? (volume / marketCap) * 100 : null, kind: "pct", hint: "How much of the market cap traded in 24h - a liquidity gauge" },
    { label: "Circulating Supply", value: circulating, kind: "supply" },
    { label: "Max Supply", value: max ?? (total != null ? "Uncapped" : null), kind: max != null ? "supply" : "text", hint: max == null && total != null ? `No hard cap; total supply today ${Math.round(total).toLocaleString("en-US")}` : undefined },
    { label: "Supply Issued", value: max && circulating ? (circulating / max) * 100 : null, kind: "pct", hint: "Circulating / max supply" },
    { label: "All-Time High", value: num(m.ath?.usd), kind: "usd", hint: m.ath_date?.usd ? `On ${m.ath_date.usd.slice(0, 10)}` : undefined },
    { label: "From ATH", value: num(m.ath_change_percentage?.usd), kind: "pct" },
    { label: "All-Time Low", value: num(m.atl?.usd), kind: "usd", hint: m.atl_date?.usd ? `On ${m.atl_date.usd.slice(0, 10)}` : undefined },
    { label: "7d Change", value: num(m.price_change_percentage_7d), kind: "pct" },
    { label: "30d Change", value: num(m.price_change_percentage_30d), kind: "pct" },
    { label: "1y Change", value: num(m.price_change_percentage_1y), kind: "pct" },
    { label: "Launched", value: coin.genesis_date, kind: "date" },
    { label: "Algorithm", value: coin.hashing_algorithm, kind: "text" },
  ];

  const { pros, cons } = buildCryptoProsCons({
    name: coin.name,
    rank: coin.market_cap_rank,
    marketCap,
    fdv,
    volume24h: volume,
    circulating,
    maxSupply: max,
    athChangePct: num(m.ath_change_percentage?.usd),
    ath: num(m.ath?.usd),
    athDate: m.ath_date?.usd ?? null,
    change1y: num(m.price_change_percentage_1y),
    genesisDate: coin.genesis_date,
    isStablecoin,
  });

  let technical: SuggestionResult | null = null;
  if (history.length > 30 && price > 0) {
    // Same engine as the portfolio badges, no position (see stockDetails).
    technical = scoreHolding({ avgBuyPrice: price, currentPrice: price, history, portfolioWeightPct: 0 });
  }

  return {
    id: coin.id,
    ticker: coin.symbol.toUpperCase(),
    name: coin.name,
    image: coin.image?.small ?? null,
    rank: coin.market_cap_rank,
    categories: categories.slice(0, 4),
    website: coin.links?.homepage?.find((u) => !!u) ?? null,
    description: plainText(coin.description?.en),
    priceUsd: price,
    priceInr: num(m.current_price?.inr),
    changePercent: num(m.price_change_percentage_24h) ?? 0,
    stats,
    pros,
    cons,
    technical,
    warnings,
  };
}

// --- chart ---
// CoinGecko's free tier serves at most 365 days of history, so 3Y / 5Y /
// Max come from Yahoo's "TICKER-USD" series instead - but only when
// Yahoo's name for that ticker matches the coin (tickers collide: many
// small coins share symbols), otherwise we'd silently chart the wrong coin.

const CG_DAYS: Partial<Record<ChartRange, number>> = { "1M": 30, "6M": 180, "1Y": 365 };
const YAHOO_RANGE: Partial<Record<ChartRange, { range: string; interval: string }>> = {
  "3Y": { range: "5y", interval: "1wk" }, // trimmed to 3 years below
  "5Y": { range: "5y", interval: "1wk" },
  MAX: { range: "max", interval: "1mo" },
};

export function getCryptoChart(id: string, range: ChartRange): Promise<ChartPoint[]> {
  return withCache(`cg:chart:${id}:${range}`, range === "1M" ? 600 : 3600, async () => {
    const days = CG_DAYS[range];
    if (days) {
      const body = await cgFetch(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}${days > 90 ? "&interval=daily" : ""}`);
      const vols = new Map<number, number>((body.total_volumes ?? []).map((v: [number, number]) => [v[0], v[1]]));
      return (body.prices ?? []).map((p: [number, number]) => ({ t: Math.floor(p[0] / 1000), close: p[1], volume: vols.get(p[0]) ?? 0 }));
    }

    const coin = await getCoin(id);
    const ticker = `${coin.symbol.toUpperCase()}-USD`;
    const yr = YAHOO_RANGE[range]!;
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${yr.range}&interval=${yr.interval}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" },
      cache: "no-store",
    });
    const result = res.ok ? (await res.json())?.chart?.result?.[0] : null;
    const yahooName: string = (result?.meta?.shortName ?? result?.meta?.longName ?? "").toLowerCase().replace(/\s+usd$/, "").trim();
    if (!result || !yahooName || !(yahooName === coin.name.toLowerCase() || yahooName.startsWith(coin.name.toLowerCase()))) {
      throw new Error(`History beyond 1 year isn't available for ${coin.name}.`);
    }
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    let points: ChartPoint[] = ts.flatMap((t, i) => (typeof q.close?.[i] === "number" ? [{ t, close: q.close[i], volume: q.volume?.[i] ?? 0 }] : []));
    if (range === "3Y") {
      const cutoff = Date.now() / 1000 - 3 * 365.25 * 86400;
      points = points.filter((p) => p.t >= cutoff);
    }
    return points;
  });
}
