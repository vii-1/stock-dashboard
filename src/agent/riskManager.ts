// Hard caps + kill switch - see TRADING_AGENT_DESIGN.md §4. Every check
// here runs before an order reaches a Broker; any failure blocks the
// order outright, no soft warnings.
//
// Deliberately pure/DB-agnostic: state in, state out, no Prisma calls.
// That's what makes it unit-testable without a database, and it's reused
// as-is by both the backtest (in-memory state, replayed fast) and - once
// built - the live agent loop (which will load/save this same shape from
// the AgentState table before/after calling these functions).

export interface RiskLimits {
  maxPositionPct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  stopLossPct: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionPct: 10,
  maxDailyLossPct: 2,
  maxTradesPerDay: 10,
  stopLossPct: 8,
};

// Intraday agent (runIntraday.ts): same position-size and daily-loss
// caps as the daily agent - shorter holding periods are not a reason to
// risk more per day. More trades allowed (each round trip is two), and
// the stop-loss is the strategy's 1% (see intradayStrategy.ts), since an
// 8% stop is meaningless inside one session.
export const INTRADAY_RISK_LIMITS: RiskLimits = {
  maxPositionPct: 10,
  maxDailyLossPct: 2,
  maxTradesPerDay: 20,
  stopLossPct: 1,
};

export interface RiskState {
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  tradesToday: number;
  realizedLossToday: number;
}

export function freshRiskState(): RiskState {
  return {
    killSwitchActive: false,
    killSwitchReason: null,
    tradesToday: 0,
    realizedLossToday: 0,
  };
}

export interface TradeIntent {
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
  portfolioValue: number;
  existingPositionValue: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  blockReason: string | null;
}

export function checkTrade(
  intent: TradeIntent,
  state: RiskState,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): RiskCheckResult {
  if (state.killSwitchActive) {
    return {
      allowed: false,
      blockReason: `Kill switch active: ${state.killSwitchReason ?? "unknown reason"}`,
    };
  }

  if (state.tradesToday >= limits.maxTradesPerDay) {
    return {
      allowed: false,
      blockReason: `Max trades per day (${limits.maxTradesPerDay}) already reached`,
    };
  }

  const dailyLossPct =
    intent.portfolioValue > 0 ? (state.realizedLossToday / intent.portfolioValue) * 100 : 0;
  if (dailyLossPct >= limits.maxDailyLossPct) {
    return {
      allowed: false,
      blockReason: `Daily realized loss (${dailyLossPct.toFixed(1)}%) at or above the ${limits.maxDailyLossPct}% cap`,
    };
  }

  if (intent.action === "BUY") {
    const tradeValue = intent.quantity * intent.price;
    const positionValueAfter = intent.existingPositionValue + tradeValue;
    const positionPctAfter =
      intent.portfolioValue > 0 ? (positionValueAfter / intent.portfolioValue) * 100 : 100;
    if (positionPctAfter > limits.maxPositionPct) {
      return {
        allowed: false,
        blockReason: `Position would be ${positionPctAfter.toFixed(1)}% of portfolio, over the ${limits.maxPositionPct}% cap`,
      };
    }
  }

  return { allowed: true, blockReason: null };
}

// Call after a trade actually fills. realizedPnl is only non-zero on a
// SELL that closes/reduces a position; pass 0 for a BUY.
export function recordTrade(
  state: RiskState,
  realizedPnl: number,
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
  portfolioValue: number
): RiskState {
  const realizedLossToday = state.realizedLossToday + (realizedPnl < 0 ? -realizedPnl : 0);
  const dailyLossPct = portfolioValue > 0 ? (realizedLossToday / portfolioValue) * 100 : 0;

  const tripped = !state.killSwitchActive && dailyLossPct >= limits.maxDailyLossPct;

  return {
    killSwitchActive: state.killSwitchActive || tripped,
    killSwitchReason: tripped
      ? `Daily realized loss (${dailyLossPct.toFixed(1)}%) hit the ${limits.maxDailyLossPct}% cap`
      : state.killSwitchReason,
    tradesToday: state.tradesToday + 1,
    realizedLossToday,
  };
}

export function tripKillSwitch(state: RiskState, reason: string): RiskState {
  return { ...state, killSwitchActive: true, killSwitchReason: reason };
}

export function resetDailyCounters(state: RiskState): RiskState {
  return { ...state, tradesToday: 0, realizedLossToday: 0 };
}

// True once price has dropped stopLossPct or more below the entry price
// the position was opened at - a separate pass (not built yet, part of
// the live agent loop) checks every open position against this on every
// run and force-sells on breach regardless of what the strategy says.
export function isStopLossBreached(
  entryPrice: number,
  currentPrice: number,
  stopLossPct: number = DEFAULT_RISK_LIMITS.stopLossPct
): boolean {
  if (entryPrice <= 0) return false;
  const dropPct = ((entryPrice - currentPrice) / entryPrice) * 100;
  return dropPct >= stopLossPct;
}

// NSE equity-segment trading holidays (weekdays only - weekend-dated
// holidays are already closed). 2026 list cross-checked 2026-10-19
// against Upstox's and Kotak Neo's published NSE calendars; 01-15
// (Maharashtra municipal election) was declared mid-year and only
// appears on the latter. ADD NEXT YEAR'S LIST when NSE publishes it
// (usually December) - a year with no entry here falls back to
// weekday-only, and the agents' stale-bar/stale-quote checks are then
// the only thing stopping them on a holiday.
export const NSE_HOLIDAYS: Record<number, Record<string, string>> = {
  2026: {
    "2026-01-15": "Municipal Election Maharashtra",
    "2026-01-26": "Republic Day",
    "2026-03-03": "Holi",
    "2026-03-26": "Shri Ram Navami",
    "2026-03-31": "Shri Mahavir Jayanti",
    "2026-04-03": "Good Friday",
    "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
    "2026-05-01": "Maharashtra Day",
    "2026-05-28": "Bakri Id",
    "2026-06-26": "Muharram",
    "2026-09-14": "Ganesh Chaturthi",
    "2026-10-02": "Mahatma Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-11-10": "Diwali - Balipratipada",
    "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
    "2026-12-25": "Christmas",
  },
};

/** Holiday name if `date` (any time that IST day) is an NSE holiday, else null. */
export function nseHoliday(date: Date): string | null {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date); // YYYY-MM-DD
  return NSE_HOLIDAYS[Number(day.slice(0, 4))]?.[day] ?? null;
}

// NSE regular trading session: 9:15-15:30 IST, Monday-Friday, excluding
// NSE_HOLIDAYS above. Special sessions (Muhurat trading, Budget-day
// Sunday sessions) are deliberately NOT treated as open - short, thin,
// unusual sessions aren't what these strategies were tested on.
export function isNseMarketOpen(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  if (weekday === "Sat" || weekday === "Sun") return false;
  if (nseHoliday(date)) return false;

  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= 9 * 60 + 15 && minutesSinceMidnight <= 15 * 60 + 30;
}

// Refuse to trade on data that's too old to reflect the current market -
// a stale-but-successful quote fetch is more dangerous than an outright
// failure because it looks fine at a glance.
export function isQuoteStale(asOf: string, thresholdMinutes: number): boolean {
  const ageMs = Date.now() - new Date(asOf).getTime();
  return ageMs > thresholdMinutes * 60 * 1000;
}
