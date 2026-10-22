import { STOCK_SYMBOL, type DetailMarket } from "@/lib/fundamentals/paths";

// Universal search behind the header search box: NSE/BSE and US stocks
// (Yahoo) + coins (CoinGecko), normalised to things our fundamentals
// pages can open. Short-lived in-memory cache - typing produces many
// near-identical queries, and none of this needs to survive a restart.

export interface SearchResult {
  market: DetailMarket;
  symbol: string; // RELIANCE.NS / AAPL / bitcoin (CoinGecko id)
  ticker: string; // RELIANCE / AAPL / BTC
  name: string;
  exchange: string; // NSE / BSE / NASDAQ / NYSE / "Rank #1"
  kind: "Stock" | "ETF" | "Coin";
  image?: string | null;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Yahoo exchange codes we can show fundamentals for.
const INDIA_EXCHANGES: Record<string, string> = { NSI: "NSE", BSE: "BSE" };
const US_EXCHANGES: Record<string, string> = {
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NCM: "NASDAQ",
  NAS: "NASDAQ",
  NYQ: "NYSE",
  NYS: "NYSE",
  ASE: "NYSE American",
  PCX: "NYSE Arca",
  BTS: "Cboe BZX",
};

const cache = new Map<string, { at: number; results: SearchResult[] }>();
const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;

async function searchYahoo(q: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0`,
    { headers: { "User-Agent": UA }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Yahoo search failed: ${res.status}`);
  const quotes: any[] = (await res.json())?.quotes ?? [];

  const results: SearchResult[] = [];
  for (const x of quotes) {
    if (x.quoteType !== "EQUITY" && x.quoteType !== "ETF") continue;
    const symbol = String(x.symbol ?? "").toUpperCase();
    if (!STOCK_SYMBOL.test(symbol)) continue;
    const india = INDIA_EXCHANGES[x.exchange];
    const us = US_EXCHANGES[x.exchange];
    // Suffix must agree with the exchange (filters e.g. ".L"-style oddities).
    if (india && !/\.(NS|BO)$/.test(symbol)) continue;
    if (us && /\./.test(symbol) && !/\.[A-Z]$/.test(symbol)) continue;
    if (!india && !us) continue;
    results.push({
      market: india ? "india" : "us",
      symbol,
      ticker: symbol.replace(/\.(NS|BO)$/, ""),
      name: x.longname ?? x.shortname ?? symbol,
      exchange: india ?? us!,
      kind: x.quoteType === "ETF" ? "ETF" : "Stock",
    });
  }

  // Same company on NSE and BSE: keep the NSE listing only.
  const nse = new Set(results.filter((r) => r.symbol.endsWith(".NS")).map((r) => r.ticker));
  return results.filter((r) => !(r.symbol.endsWith(".BO") && nse.has(r.ticker)));
}

async function searchCoins(q: string): Promise<SearchResult[]> {
  const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, {
    headers: process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CoinGecko search failed: ${res.status}`);
  const coins: any[] = (await res.json())?.coins ?? [];
  // Drop unranked coins and "tokenized stock" wrappers (apple-xstock,
  // hdfc-bank-rstock, ...) - a search for a company should find the
  // company, not an obscure on-chain copy of its share.
  // Small coins only show when they're clearly what was typed (name or
  // ticker starts with it) - otherwise "apple" surfaces "pineapple" memes.
  const term = q.toLowerCase();
  const real = coins.filter((c) => {
    const id = String(c.id);
    const name = String(c.name ?? "").toLowerCase();
    const sym = String(c.symbol ?? "").toLowerCase();
    if (!c.market_cap_rank || /(^|-)[a-z]?stock$|tokenized/i.test(id) || /tokenized/.test(name)) return false;
    return c.market_cap_rank <= 300 || name.startsWith(term) || sym.startsWith(term);
  });
  return real.slice(0, 5).map((c) => ({
    market: "crypto" as const,
    symbol: c.id,
    ticker: String(c.symbol ?? "").toUpperCase(),
    name: c.name,
    exchange: c.market_cap_rank ? `Rank #${c.market_cap_rank}` : "Unranked",
    kind: "Coin" as const,
    image: c.thumb ?? null,
  }));
}

/**
 * Stocks first (they're what most searches are for), then coins. Either
 * source failing just drops its section - `failed` says which, so the UI
 * can say "crypto search unavailable" instead of showing nothing.
 *
 * `market` narrows to one market (the add-holding form knows its asset
 * class) - and skips the other source entirely, which matters for
 * CoinGecko's tight free-tier rate limit.
 */
export async function searchAll(
  raw: string,
  market?: DetailMarket
): Promise<{ results: SearchResult[]; failed: ("stocks" | "crypto")[] }> {
  const q = raw.trim().slice(0, 60);
  if (q.length < 2) return { results: [], failed: [] };
  const key = `${market ?? "all"}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { results: hit.results, failed: [] };

  const wantStocks = market !== "crypto";
  const wantCoins = market === undefined || market === "crypto";
  const [stocks, coins] = await Promise.allSettled([
    wantStocks ? searchYahoo(q) : Promise.resolve([]),
    wantCoins ? searchCoins(q) : Promise.resolve([]),
  ]);
  const failed: ("stocks" | "crypto")[] = [];
  if (stocks.status === "rejected") failed.push("stocks");
  if (coins.status === "rejected") failed.push("crypto");
  const results = [
    ...(stocks.status === "fulfilled" ? stocks.value.filter((r) => !market || r.market === market).slice(0, 8) : []),
    ...(coins.status === "fulfilled" ? coins.value : []),
  ];

  // Only cache complete answers, so a transient failure isn't remembered.
  if (failed.length === 0) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), results });
  }
  return { results, failed };
}
