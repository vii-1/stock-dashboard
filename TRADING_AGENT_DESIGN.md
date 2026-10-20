# Autonomous Trading Agent — Design Doc

Last updated: 2026-09-06

## 0. Read this first

This extends the dashboard project with an agent that picks trades and
executes them with no per-trade human approval, gated by hard limits it
cannot override. Before any of this touches real money:

- **I'm not a financial advisor and this isn't financial advice.** You are
  solely responsible for any strategy you run and any money you risk.
- **Most automated retail strategies underperform buy-and-hold** once fees,
  slippage, and taxes are counted. Treat this as a systems/engineering
  project first and a money-maker second — that's the honest framing.
- **Regulatory reality in India (researched Sept 2026):** SEBI'a algo
  trading framework is fully enforceable from April 1, 2026. Per Zerodha's
  own explainer, a personal bot trading only your own account does **not**
  need separate strategy registration as long as your order rate stays
  under the exchange-prescribed threshold (Zerodha's own API cap is 10
  orders/sec, far above what a personal bot needs) — but you **do** need a
  **static IP whitelisted with your broker** before placing live orders via
  API. Sharing the strategy or running it for anyone but yourself/family
  changes this. Re-verify current rules with Zerodha/SEBI directly before
  going live — this space is actively changing and I'm summarizing, not
  certifying compliance.
  Sources: [Zerodha - Explaining the latest SEBI algo trading regulations](https://zerodha.com/z-connect/business-updates/explaining-the-latest-sebi-algo-trading-regulations), [Preparing to comply with SEBI's retail algo rules](https://kite.trade/forum/discussion/15912/preparing-to-comply-with-sebis-retail-algo-rules-static-ip-ratelimits-order-types)
- **Kite Connect has no paper trading / sandbox mode** ([Zerodha support](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/api-sandbox) confirms this explicitly) and is a paid subscription. So "paper trading India stocks" in this project means: pull real quotes, simulate fills and P&L entirely in our own database — not a Zerodha feature.
- **Binance does have a real testnet** ([Binance Spot Testnet docs](https://developers.binance.com/en/docs/products/spot/testnet/rest-api)) — free API keys, fake funds, real order-matching API. This is a genuinely good first "real API integration" step with zero financial risk, which is why crypto is the recommended starting market.

## 1. Design principle: autonomy earns trust in stages

You chose "autonomous with hard kill-switches" — the agent decides and
executes on its own, but inside limits it literally cannot cross. The
staged rollout that makes that safe:

```
Backtest  →  Paper trade (weeks)  →  Testnet (crypto)  →  Tiny real capital  →  Scale up
(no risk)    (no risk, real data)    (no $ risk)           (real, capped)       (only after track record)
```

Nothing here should let the agent skip a stage automatically. Moving to
the next stage is a manual decision you make after reviewing the audit
log from the previous one.

## 2. Architecture

Extends the existing dashboard project (same Next.js repo, same Prisma
DB) with a `src/agent/` module that runs as a standalone script
(`npm run agent:run`), not a web request — it's a background loop, not
something a page triggers.

```
src/agent/
  riskManager.ts       - hard caps + kill switch (see §4)
  broker/
    types.ts           - Broker interface (placeOrder, getPositions, getCashBalance)
    paperBroker.ts      - fully implemented: simulated fills against live quotes
    binanceTestnetBroker.ts - fully implemented: real Binance testnet API, fake funds
    kiteLiveBroker.ts   - TODO stub, real money, requires explicit setup (§6)
    binanceLiveBroker.ts - TODO stub, real money, requires explicit setup (§6)
  strategy/
    decisionEngine.ts   - wraps src/lib/suggestions/scoreHolding.ts into BUY/SELL/HOLD + size
  backtest/
    runBacktest.ts      - replay strategy over historical data, report metrics
  runAgent.ts           - the orchestration loop (see §5)
```

Reuses from the dashboard: `MarketDataProvider`s (Yahoo, CoinGecko), the
Prisma client, and the suggestion-engine functions once you've
implemented them (`calculateSMA`, `calculateRSI`, `scoreHolding`) — the
decision engine is a thin wrapper that turns a `SuggestionResult` into an
actual order size, it doesn't reinvent the signal logic.

## 3. Data model additions

```
model Order {
  id          String   @id @default(cuid())
  mode        String   // "PAPER" | "TESTNET" | "LIVE"
  side        String   // "BUY" | "SELL"
  assetClass  String
  symbol      String
  quantity    Float
  price       Float    // fill price
  status      String   // "FILLED" | "REJECTED"
  rejectReason String?
  createdAt   DateTime @default(now())
}

// Singleton row (one per mode) tracking today's risk counters + the kill switch.
model AgentState {
  id               String   @id  // e.g. "PAPER", "LIVE"
  killSwitchActive Boolean  @default(false)
  killSwitchReason String?
  tradesToday      Int      @default(0)
  realizedLossToday Float   @default(0)
  lastResetDate    DateTime @default(now())
}

// Every decision the agent makes, whether or not it resulted in an order -
// this is what you actually review during the paper-trading weeks.
model DecisionLog {
  id         String   @id @default(cuid())
  symbol     String
  suggestion String   // STRONG_BUY | HOLD | TRIM | SELL_REVIEW
  reasons    String   // JSON array of strings
  executed   Boolean
  blockReason String? // set when risk manager blocked an otherwise-actionable signal
  createdAt  DateTime @default(now())
}
```

## 4. Risk manager (the "protection" layer)

This is the part that has to be boring and rigid. Every check runs
*before* an order reaches a `Broker`, and any failure blocks the order
outright — no soft warnings, no "proceed anyway."

Hard caps (all configurable, ship with conservative defaults):

1. **Kill switch** — if `AgentState.killSwitchActive` is true, block
   everything immediately. Can be set manually (a CLI command / DB flag)
   or auto-tripped by any rule below.
2. **Max position size** — a single symbol can't exceed N% of total
   portfolio value (default 10%).
3. **Max daily loss** — if `realizedLossToday` exceeds N% of portfolio
   value (default 2%), auto-trip the kill switch for the rest of the day.
4. **Max trades per day** — hard cap (default 10) regardless of how many
   signals fire — mirrors the SEBI order-frequency spirit even in paper
   mode, and keeps a runaway loop from placing hundreds of orders.
5. **Mandatory stop-loss** — every BUY order must be paired with a
   stop-loss level recorded at entry; a separate monitoring pass checks
   open positions against their stop-loss every run and force-sells on
   breach regardless of what the strategy currently says.
6. **Market-hours / connectivity guard** — refuse to place India-stock
   orders outside NSE hours, and refuse *any* order if the last
   successful quote fetch is older than a staleness threshold (don't
   trade on stale data).

Write unit tests for the risk manager before anything else in `src/agent`
— this is the one module where a bug has direct financial consequences.

## 5. Agent runner loop

```
loop (e.g. every 5 min during market hours):
  if killSwitch.active -> log "skipped: kill switch" -> stop
  resetDailyCountersIfNewDay()
  for each symbol in watchlist:
    quote    = provider.getQuote(symbol)
    history  = provider.getHistory(symbol, 90)
    decision = decisionEngine.decide({ quote, history, currentHoldings })
    log decision to DecisionLog (always, even HOLD)
    if decision is actionable (BUY/SELL/TRIM):
      riskCheck = riskManager.check(decision, portfolioState)
      if riskCheck.blocked:
        log block reason to DecisionLog, continue
      else:
        result = broker.placeOrder(...)
        log result to Order table
  checkOpenPositionsAgainstStopLoss()
```

Run this via `npm run agent:run` locally to start, or a cron-triggered
scheduled task later — never as a `setInterval` inside the Next.js web
process, since that couples the trading loop's lifetime to the dashboard
server by accident.

## 6. Going from paper/testnet to real money (explicitly manual)

`kiteLiveBroker.ts` and `binanceLiveBroker.ts` are stubs on purpose. When
you're ready for either:

- **Binance live**: get real API keys (not testnet ones), and I'd add a
  required `I_UNDERSTAND_THIS_IS_REAL_MONEY=true` env var the broker
  refuses to start without, on top of everything in §4.
- **Kite live**: requires a paid Kite Connect subscription, a static IP
  whitelisted with Zerodha (see §0), and your own current read of SEBI's
  rules at the time you go live — don't take this doc's summary as final,
  the rules were still being phased in as of this research.

Neither of these should ever be something I wire up and run automatically
on your behalf — you'll need to supply the credentials, review the
backtest + paper-trading results yourself, and consciously flip the
switch.

## 7. Open questions to revisit

- Position sizing formula (fixed % of capital vs. volatility-adjusted) —
  a good thing to make configurable and backtest both ways.
- What "watchlist" the agent trades — start with the same
  `NIFTY_WATCHLIST` / a short curated crypto list already in the
  dashboard providers, don't scan the whole market on day one.
- Whether to add alerting (push notification / email) on kill-switch
  trips and large moves, so you're not relying on manually checking logs.
