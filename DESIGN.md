# Stock Market Dashboard — Design Doc

Last updated: 2026-08-16

## 1. Goal

A personal dashboard that:

1. Lists stock/crypto "movers" (top gainers/losers) across three markets — Indian equities, US equities, and crypto — each on its own page.
2. Lets you record what you've actually invested in (symbol, quantity, buy price, buy date) and tracks live P&L against it.
3. Surfaces upcoming IPOs (India and US).
4. Gives buy/hold/sell/reduce suggestions based on simple, explainable signals — not a black box.
5. Doubles as an interview-prep project: the parts most relevant to interviews (CRUD API design, algorithmic signal logic, schema design, caching) are left as guided exercises rather than fully written for you.

Build style: **hybrid**. I scaffold the plumbing — project setup, provider layer, DB schema, routing, one working end-to-end example — and leave clearly marked TODOs for you to implement the meatier logic, with my guidance.

## 2. Tech stack

- **Next.js 14 (App Router) + TypeScript** — single codebase for frontend + API routes. Common interview topic (SSR/CSR, routing, React Server Components).
- **Prisma ORM + SQLite** — real relational schema, zero external DB setup (single file `dev.db`), easy to swap for Postgres later. Good for practicing schema design, migrations, and query writing.
- **Tailwind CSS** — fast styling, no design-system overhead.
- No auth for v1 (single-user, local). Can add NextAuth later if you want to practice auth flows.

## 3. Market data sources (researched Aug 2026)

| Market | Provider | Why | Key needed? | Free limits |
|---|---|---|---|---|
| India stocks (NSE/BSE) | `yahoo-finance2` npm package | Actively maintained, native Node/TS, covers NSE (`.NS`) and BSE (`.BO`) tickers, quotes + historical + search + trending screeners, no key | No | Soft rate limit, be polite (~1-2 req/sec); we cache |
| US stocks | `yahoo-finance2` (same package) | One provider for both equity markets simplifies the adapter layer significantly | No | Same as above |
| Crypto | CoinGecko public API | No key required, generous free tier, has markets/gainers-losers endpoints | No (key optional for higher limits) | 100 calls/min, ~10,000 calls/month keyless |
| Upcoming IPOs (India) | ipoalerts.in API | Purpose-built for this, simple REST, free tier | Yes (free signup) | Check pricing page for exact cap when you sign up |
| Upcoming IPOs (US) | Finnhub IPO calendar endpoint | Free tier covers IPO calendar | Yes (free signup) | 60 calls/min free tier |

**Why one provider (Yahoo) for both stock markets instead of separate APIs per market:** it collapses the adapter surface to one implementation, avoids juggling two sets of rate limits/response shapes for the highest-traffic pages (stock movers), and is the option with no API key friction. The tradeoff — Yahoo's endpoints are unofficial and could change — is mitigated by isolating all calls behind a single `MarketDataProvider` interface (see below), so swapping providers later only touches one file.

Since these are unofficial/free endpoints, **every provider call goes through a TTL cache** (in-memory now, easy to move to the DB or Redis later) so we don't hammer rate limits and the dashboard stays fast.

## 4. Data model (Prisma)

```
model Holding {
  id          String   @id @default(cuid())
  assetClass  String   // "IN_STOCK" | "US_STOCK" | "CRYPTO"
  symbol      String   // e.g. "RELIANCE.NS", "AAPL", "bitcoin"
  displayName String?
  quantity    Float
  avgBuyPrice Float
  buyDate     DateTime
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model QuoteCache {
  key       String   @id   // e.g. "yahoo:RELIANCE.NS"
  payload   String         // JSON-serialized provider response
  fetchedAt DateTime @default(now())
}
```

`Holding` is intentionally market-agnostic (one table, `assetClass` discriminator) rather than three separate tables — keeps the portfolio/P&L aggregation queries simple (one query across all your investments) at the cost of a slightly looser schema. Worth discussing the tradeoff vs. per-asset-class tables in an interview context.

## 5. Provider interface (adapter pattern)

```ts
interface Quote {
  symbol: string;
  price: number;
  changePercent: number;
  currency: string;
  asOf: string;
}

interface MarketDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getMovers(direction: "gainers" | "losers"): Promise<Quote[]>;
  getHistory(symbol: string, days: number): Promise<{ date: string; close: number }[]>;
  search(query: string): Promise<{ symbol: string; name: string }[]>;
}
```

`yahooProvider.ts` and `coingeckoProvider.ts` both implement this. Pages/API routes never call the underlying SDK directly — only through this interface. This is what makes "swap Yahoo for a paid API later" a one-file change instead of a rewrite.

## 6. Pages

- `/dashboard` — cross-market summary: total portfolio value, today's P&L, allocation by asset class, top 3 movers from each market.
- `/stocks/india` — NSE/BSE movers (gainers/losers/most active), search + add-to-portfolio.
- `/stocks/us` — same, US market.
- `/crypto` — same, crypto market.
- `/ipos` — tabs for India / US upcoming IPOs with dates, price bands, GMP (India) where available.
- `/portfolio` — full holdings table across all asset classes: quantity, avg buy price, current price, unrealized P&L (₹/$ and %), and a suggestion badge (Buy more / Hold / Trim / Sell) per holding.

## 7. Suggestion engine (the interview-prep centerpiece)

Rule-based and explainable, not ML — the point is you implement and can explain the logic in an interview.

Inputs per holding: current price, your avg buy price, recent price history (e.g. last 90 days).

Signals to combine into a score (each is a good standalone coding exercise):

1. **Unrealized P&L %** — big unrealized loss vs. your risk tolerance threshold → flag for review.
2. **Trend** — SMA(20) vs SMA(50) crossover (golden cross / death cross) computed from `getHistory`.
3. **Momentum** — simple RSI(14) implementation from the closing-price series.
4. **Concentration risk** — this holding's % of total portfolio value vs. a configurable max (e.g. flag if any single position > 25%).

Combine into a suggestion: `STRONG_BUY | HOLD | TRIM | SELL_REVIEW` with the contributing reasons shown (not just the label) — good practice for writing testable, pure functions (`calculateSMA`, `calculateRSI`, `scoreHolding`) with unit tests.

## 8. Phased roadmap

**Scaffolded by me (this session):**
- Project setup (Next.js, TS, Tailwind, Prisma+SQLite)
- Prisma schema + migration
- Provider interface + working Yahoo + CoinGecko implementations with TTL cache
- Page shells and nav for all 6 pages
- One fully wired example: `/stocks/india` pulling live movers end-to-end

**Left for you as exercises (I'll guide/review):**
- Portfolio CRUD: add/edit/delete a holding (API routes + form UI) — classic REST+DB exercise
- `/stocks/us` and `/crypto` pages (same pattern as the India example, different provider)
- Suggestion engine: `calculateSMA`, `calculateRSI`, `scoreHolding`, wired into `/portfolio`
- IPO integration (ipoalerts.in + Finnhub)
- Polish: loading/error states, empty states, basic tests

## 9. Open questions to revisit later

- Currency handling: portfolio will mix ₹ (India) and $ (US/crypto) — v1 shows each holding in its native currency plus a converted total (need an FX rate source, e.g. exchangerate.host, free/keyless).
- Whether to add auth once this moves beyond local/single-user use.
- Whether to eventually deploy (Vercel is the natural fit for Next.js) vs. keep local-only.
