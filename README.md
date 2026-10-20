# Stock Market Dashboard

Personal investment dashboard: market movers for India stocks, US stocks,
and crypto, plus your own portfolio with P&L and buy/hold/sell suggestions.
See `DESIGN.md` for the full architecture writeup.

This was scaffolded in a sandbox with no npm registry access, so nothing
here has been installed or run yet — follow the steps below on your own
machine.

## 1. Install

```bash
npm install
cp .env.example .env
```

`.env` already points `DATABASE_URL` at a local SQLite file, so no
external DB setup is needed. Leave `IPOALERTS_API_KEY` / `FINNHUB_API_KEY`
blank until you get to the IPOs page exercise.

## 2. Set up the database

```bash
npm run prisma:migrate
```

This creates `dev.db` from `prisma/schema.prisma` (the `Holding` and
`QuoteCache` tables).

## 3. Run it

```bash
npm run dev
```

Open http://localhost:3000 — it redirects to `/dashboard`. Click **India
Stocks** in the nav to see live NSE quotes (no API key needed) and top
gainers/losers.

## What's already built

- Next.js + TypeScript + Tailwind + Prisma/SQLite project setup
- `Holding` / `QuoteCache` schema (`prisma/schema.prisma`)
- `MarketDataProvider` interface (`src/lib/providers/types.ts`) — every
  data source implements this, so pages never call an SDK directly
- `yahooProvider.ts` — fully implemented, covers both India (`.NS`
  tickers via a curated watchlist) and US (Yahoo's screener) equities
- `coingeckoProvider.ts` — fully implemented, crypto quotes/movers/history
- `ttlCache.ts` — DB-backed cache so repeat requests don't hit the
  upstream APIs every time
- Sidebar nav (`Sidebar.tsx`, desktop) + top bar (`MobileNav.tsx`,
  small screens) — grouped sections (Overview / Markets / Your money),
  active-link highlighting, `lucide-react` icons
- `/stocks/india`, `/stocks/us`, `/crypto` — all three movers pages,
  live end-to-end
- Portfolio CRUD (`/api/portfolio` GET/POST, `/api/portfolio/[id]`
  PATCH/DELETE) with server-side validation
- `/portfolio` — holdings table with live prices, unrealized P&L
  (currency + %), portfolio weight, add/edit/remove
- Suggestion engine (`src/lib/suggestions/scoreHolding.ts`) —
  `calculateSMA`, `calculateRSI`, `calculateMACD`, `calculateBollingerBands`,
  `scoreHolding`, wired into the portfolio table as a badge (hover for
  the reasons that fired)
- `/ipos` — tabbed India/US view via `src/lib/providers/ipoProvider.ts`;
  shows setup instructions until you add the free API keys below
- `/dashboard` — total portfolio value, today's P&L, allocation by
  asset class, top 3 movers per market

## UI design

Redesigned using the project's `dataviz` skill rather than cloning any
specific product's look — general fintech-dashboard conventions (sidebar
nav, dense tables, uppercase muted table headers, `tabular-nums` on
numeric columns, a stat-tile contract of label/value/delta) applied with
the skill's validated reference palette, not an ad hoc color pick:

- `gain` (`#006300`) / `gain-dark` (`#0ca30c`) / `loss` (`#d03b3b`) in
  `tailwind.config.ts` are the skill's status palette (good/critical)
  verbatim. The gain/gain-dark split exists because the skill's own
  reference flags `#0ca30c` as under the 4.5:1 text-contrast floor on a
  light surface (3.27:1) and names `#006300` as the light-mode "success
  text" variant specifically for that case - `loss` has no such
  documented alternative, so it's one hex in both modes.
- Every data table follows the same shape: `bg-slate-50` uppercase
  tracking-wide header, `py-1.5` row density, a hover wash, and
  `tabular-nums` on every numeric column so figures align.
- Stat tiles (`/dashboard`, `/agent`) follow label (sentence case, no
  colon) → value (semibold, proportional figures) → optional signed/
  colored delta, each as `rounded-xl` + `shadow-sm` cards.

## Known limitations / good interview discussion points

- **Cross-currency totals aren't FX-converted.** Portfolio value, weight
  %, and dashboard totals sum INR (India stocks) and USD (US
  stocks/crypto) holdings as raw numbers — fine for a single-currency
  demo, misleading once you hold both. See `DESIGN.md` §9 for the FX
  open question; `src/lib/portfolio/enrich.ts` has the relevant comment.
- **"Today's P&L"** on the dashboard approximates the day's dollar move
  as `marketValue * (changePercent / 100)` rather than reconstructing
  the previous close — close enough for a personal dashboard, not
  something you'd want in production.
- **Yahoo Finance access is unofficial and access patterns can shift.**
  `yahooProvider.ts` no longer depends on the `yahoo-finance2` npm
  package — its `quote()`/`screener()` methods go through Yahoo's
  crumb-authenticated endpoints, which started returning persistent
  "Too Many Requests" regardless of actual request volume (a known,
  unfixed issue in that EOL library version). The provider now calls
  Yahoo's public chart/screener/search endpoints directly with a plain
  `fetch()` and a browser User-Agent — no crumb needed, and the chart
  endpoint's `meta` block doubles as a full quote. If Yahoo changes
  these endpoints later, `yahooProvider.ts` is still the one file that
  needs updating, thanks to the `MarketDataProvider` interface.
- **The suggestion engine's SMA "crossover"** actually just compares the
  current SMA(20) vs SMA(50) (trend direction), not a same-day cross
  event — simpler to reason about, slightly looser than the textbook
  definition.
- **CoinGecko's free tier rate-limits aggressively** - tighter than the
  "~10-30 req/min" estimate below suggests. Fetching quotes one symbol
  at a time for even half a dozen coins in quick succession reliably
  tripped a 429 on every single one in testing (found while wiring up
  the trading agent's watchlist). Always batch same-provider symbols
  into one `getQuotes()` call instead of N `getQuote()` calls - both
  `/agent` and `runAgent.ts` do this; `enrichHoldings()` (used by
  `/portfolio` and `/dashboard`) still calls `getQuote()` per holding
  and hasn't hit this in practice because real portfolios here have had
  at most one or two crypto holdings at a time - worth the same fix if
  that ever changes.

## IPOs page — one gotcha on ipoalerts.in's free plan

Both `IPOALERTS_API_KEY` and `FINNHUB_API_KEY` are wired up and tested
against the live APIs. One thing that only showed up by testing with a
real key: ipoalerts.in's free plan rejects `status=upcoming` ("not
supported for free plan users") — only `status=open` (IPOs currently
accepting bids) works, so that's what `getUpcomingIndiaIpos()` requests.
The free plan is also capped at 6 requests/minute and ~1 result/page,
which is why that call goes through the same `withCache` TTL wrapper
(30 min) as the market data providers. Finnhub's IPO calendar has no
such restriction.

## Trading agent (second track)

`TRADING_AGENT_DESIGN.md` — **read §0 before touching real money**, it
covers real regulatory/broker constraints (Kite Connect has no sandbox,
SEBI's 2026 algo-trading rules, Binance's genuine testnet). Built so far,
following the design's staged rollout (`Backtest → Paper trade → Testnet
→ tiny real capital → scale up`, each stage a manual decision, not an
automatic progression):

- `src/agent/riskManager.ts` — hard caps (position size, daily loss,
  trade count, stop-loss, NSE market hours, quote staleness) + kill
  switch. Pure/DB-agnostic by design so it's unit-testable without a
  database; 19 tests in `riskManager.test.ts`.
- `src/agent/strategy/decisionEngine.ts` — wraps the existing
  `scoreHolding` suggestion engine into an actual BUY/SELL/HOLD + size
  decision. 8 tests in `decisionEngine.test.ts` (mocks `scoreHolding` to
  isolate the sizing logic, since the signal logic itself is already
  exercised live via `/portfolio`). TRIM exits the whole remaining
  position once it's under 0.5% of the portfolio (`DUST_POSITION_PCT`)
  instead of halving forever - found by backtesting after adding MACD
  below, which co-signals with the SMA trend often enough to retrigger
  TRIM for weeks straight and produce dust-sized trades.
- `scoreHolding.ts` also has `calculateMACD` and `calculateBollingerBands`
  now (8 tests in `scoreHolding.test.ts`) - both standard, public-domain
  technical indicators (the same formulas Freqtrade/TradingView/every
  retail platform uses), added as genuinely complementary signals rather
  than copying any specific bot's proprietary logic. Deliberately **not**
  added: DCA-style "buy more as it drops" (contradicts the already-shipped
  "don't add to a position on repeat signals" decision in `decisionEngine.ts`,
  and is exactly the loss-amplifying-in-a-trend pattern research on real
  DCA bots warns about) and grid trading (an order-placement style, not a
  signal - doesn't fit a single-decision-per-pass architecture without a
  larger redesign).
- **ADX trend filter** — `calculateADX` in `scoreHolding.ts` (5 tests)
  gates the two trend-following signals (SMA, MACD) on whether Wilder's
  ADX says there's actually a trend to follow (threshold 25), discounting
  golden/death crosses that fire in a choppy, directionless market
  instead of trusting every one equally. Needs high/low, not just
  closes - `HistoryPoint` grew optional `high`/`low` fields, populated
  by `yahooProvider.ts` (Yahoo's chart endpoint already returns them) but
  **not** `coingeckoProvider.ts` (its `market_chart` endpoint is price-only;
  the separate `/ohlc` endpoint has a different granularity per day-range
  tier that would've risked destabilizing the working crypto indicators
  to gain this one). `calculateADX` returns `null` for crypto accordingly
  - a known gap, not a bug, and `scoreHolding` gives the benefit of the
  doubt (doesn't discount) when it can't tell trend from chop.
- **Transaction costs** — `TRANSACTION_COST_PCT` (0.1%, a crypto-exchange-
  taker-fee ballpark) in `paperBroker.ts`, applied to every BUY/SELL in
  both the live paper broker and `runBacktest.ts` (which imports the same
  constant so a backtest's return reflects the same friction the paper
  agent would see). Before this, the backtest assumed zero fees - exactly
  the "most retail strategies underperform once costs are counted" trap
  `TRADING_AGENT_DESIGN.md` §0 warns about on day one. Verified against
  the real DB: a 10-share round trip at $100→$110 costs $1.00 + $1.10 in
  fees, cost basis and realized P&L both net of fee.
- `src/agent/backtest/runBacktest.ts` — replays the strategy day-by-day
  over real historical data with no look-ahead, no DB writes, no
  broker calls. Run it: `npm run agent:backtest -- RELIANCE.NS IN_STOCK`
  (or `-- bitcoin CRYPTO`, `-- AAPL US_STOCK`). Lookback is capped at
  365 days — CoinGecko's free tier 401s above that.
- **Paper trading** — `Order`/`AgentState`/`DecisionLog`/`PaperAccount`/
  `PaperPosition` models, `src/agent/broker/paperBroker.ts` (simulated
  fills against live quotes, no real API, starts with ₹/$100,000 fake
  cash), and `src/agent/runAgent.ts` (the orchestration loop). Run it:
  `npm run agent:run`. Single-pass by design — it does one loop of
  TRADING_AGENT_DESIGN.md §5 and exits, meant to be invoked repeatedly by
  cron/Task Scheduler ("every 5 min during market hours"), not to run
  its own `setInterval` — see the comment at the top of `runAgent.ts`
  for why. The kill switch never auto-clears, even for its own
  daily-loss trips — `npm run agent:reset-kill-switch -- PAPER` clears
  it manually once you've reviewed why it tripped.
- `npm run agent:status -- PAPER` — read-only CLI snapshot: cash, open
  positions with live mark-to-market P&L, recent orders, recent
  decisions across all symbols. Safe to run anytime.
- **`/agent`** — the same snapshot as `agent:status`, as a dashboard
  page (nav: "Paper Agent"). Deliberately separate from `/portfolio` and
  visually flagged ("Simulated - not real money") so paper trades are
  never mistaken for real holdings. Quotes for open positions are
  batched per asset class (not one request per symbol) for the same
  reason noted below.
- `npm test` runs the full suite (riskManager + decisionEngine +
  scoreHolding, 40 tests).

**Not built yet**: `binanceTestnetBroker.ts` (real testnet API, needs
your own free API keys) and the `kiteLiveBroker.ts`/`binanceLiveBroker.ts`
stubs, which the design doc is explicit should never be wired up
automatically — see `TRADING_AGENT_DESIGN.md` §6.

### Intraday paper agent (test only)

A separate 5-minute-bar strategy for NSE, with its own paper account
(`PAPER_INTRADAY`, ₹1,00,000) so it never mixes with the daily agent.

- `src/agent/strategy/intradayStrategy.ts` — EMA(9)/EMA(21) crossover
  entry above session VWAP with RSI 50-70, 09:30-14:45 IST; exits at
  -1% stop / +2% target / EMA reversal / forced 15:15 square-off.
- `npm run agent:backtest-intraday` — 60 days of 5m bars, all 30
  `NIFTY_WATCHLIST` names as one shared-cash portfolio, plus an
  in-sample vs held-out walk-forward table.
- `npm run agent:run-intraday` — one live pass; schedule every 5 min
  during market hours. Exits are never blocked (not even by the kill
  switch), so nothing is carried overnight. Log: `agent-intraday.log`.
- `npm run agent:status -- PAPER_INTRADAY` for the account.

**Backtest result (2026-07-27 → 2026-10-19): it loses money.** -10.5%
over 59 sessions, ~flat *before* fees - the signal has no edge on these
large caps, and ~12 round trips/day at ~0.16% round-trip cost
(`INTRADAY_COST_PCT`, Zerodha MIS charges + slippage allowance) grinds
it down. Dropping the reversal exit didn't help out-of-sample either.
Kept runnable as a test harness for the live loop, not as a strategy
to trust.

## Kite Connect (read-only account link, third track)

`/kite` — a scaffold for showing your **real** Zerodha holdings/balance
on the dashboard, separate from the trading agent (which never touches
real brokers) and from `/portfolio` (still manually-entered holdings).
**No orders are placed through this**, by design.

What's actually wired up vs. not:
- `src/lib/kite/session.ts` + `/api/kite/login` + `/api/kite/callback` —
  the login/token-exchange flow (Kite's documented OAuth-style dance:
  redirect → short-lived `request_token` → signed exchange for an
  `access_token`). Verified against the real API.
- `src/lib/kite/client.ts` — read-only `getHoldings()` (`/portfolio/holdings`)
  and `getMargins()` (`/user/margins`), rendered on `/kite` as summary
  tiles + `KiteHoldingsTable`. No order/GTT functions exist, on purpose.
  The response types were checked against a real account's responses
  pulled through the Kite MCP (2026-10-19), not guessed from docs —
  e.g. `pnl` is confirmed as `(last_price - average_price) * quantity`.
  Verified end-to-end against the real API on 2026-10-19 (login →
  token exchange → holdings/margins render on `/kite`).
- Kite MCP (for Claude Code, not the app): `.mcp.json` points at the
  hosted `https://mcp.kite.trade/mcp`; `.claude/settings.json` denies its
  order/GTT tools, which the hosted server does expose. Read tools only.
- Access tokens expire at the end of every trading day - there's no
  refresh token for personal use, so `/kite` requires a manual re-login
  once a day, by design (not an oversight to "fix" with automation).

To enable: sign up at `developers.kite.trade`, create a **Connect** app
with redirect URL `http://localhost:3000/api/kite/callback`, add
`KITE_API_KEY`/`KITE_API_SECRET` to `.env`. The free **Personal** app
tier is enough - holdings and funds work on it; the paid ₹500/mo Connect
plan only adds live/historical market data, which `/kite` doesn't use.

## Notes on the data sources

- Yahoo Finance access here goes straight to Yahoo's public chart/
  screener/search endpoints via `fetch()` — no npm SDK, no API key. See
  "Known limitations" above for why (the `yahoo-finance2` package's
  auth-required endpoints stopped working reliably). Everything routes
  through the `MarketDataProvider` interface specifically so a future
  swap only touches one file.
- India movers use a fixed large-cap watchlist (`NIFTY_WATCHLIST` in
  `yahooProvider.ts`) rather than Yahoo's screener, because the screener's
  region filtering doesn't reliably scope to NSE. Fine for a personal
  dashboard; worth knowing if you want full-market coverage later.
- CoinGecko's public endpoints are keyless and fine for personal use
  (~10-30 req/min is safe); the TTL cache keeps us well under that.
