import type { HistoryPoint } from "@/lib/providers/types";

// The interview-prep centerpiece - see DESIGN.md section 7. Rule-based,
// explainable signals combined into one suggestion. Implemented as pure,
// independently testable functions.

export type Suggestion = "STRONG_BUY" | "HOLD" | "TRIM" | "SELL_REVIEW";

export interface SuggestionResult {
  suggestion: Suggestion;
  reasons: string[];
}

const CONCENTRATION_LIMIT_PCT = 25;
const LOSS_REVIEW_THRESHOLD_PCT = -15;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

/**
 * Simple Moving Average over the last `period` closes.
 * closes[closes.length - 1] is the most recent price.
 * Returns null if there isn't enough history yet.
 */
export function calculateSMA(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period) return null;
  const window = closes.slice(closes.length - period);
  const sum = window.reduce((total, close) => total + close, 0);
  return sum / period;
}

/**
 * Relative Strength Index over `period` (typically 14) days, using the
 * simple (unsmoothed) average of gains/losses across the window.
 * RS = avgGain / avgLoss, RSI = 100 - (100 / (1 + RS)).
 * Returns null if there isn't enough history.
 */
export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  const window = closes.slice(closes.length - (period + 1));
  let totalGain = 0;
  let totalLoss = 0;

  for (let i = 1; i < window.length; i++) {
    const diff = window[i] - window[i - 1];
    if (diff >= 0) totalGain += diff;
    else totalLoss += -diff;
  }

  const avgGain = totalGain / period;
  const avgLoss = totalLoss / period;

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Exponential Moving Average series over the full `closes` array (not a
 * single trailing window like calculateSMA - MACD needs the EMA's full
 * history to compute its own signal line). Seeded with an SMA of the
 * first `period` closes, standard EMA smoothing after that. Entries
 * before the seed are null.
 */
function calculateEMASeries(closes: number[], period: number): (number | null)[] {
  const series: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period) return series;

  const seedWindow = closes.slice(0, period);
  let ema = seedWindow.reduce((total, close) => total + close, 0) / period;
  series[period - 1] = ema;

  const smoothing = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * smoothing + ema * (1 - smoothing);
    series[i] = ema;
  }
  return series;
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD(12,26,9) - the fast/slow EMA spread (the "MACD line"), its own
 * 9-period EMA (the "signal line"), and the difference between them.
 * Same well-documented formula used across every retail trading
 * platform (Freqtrade, TradingView, StockSharp, etc.) - public-domain
 * technical analysis, not any one product's proprietary logic.
 * Returns null if there isn't enough history for the signal line too.
 */
export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdResult | null {
  const fastEma = calculateEMASeries(closes, fastPeriod);
  const slowEma = calculateEMASeries(closes, slowPeriod);

  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const fast = fastEma[i];
    const slow = slowEma[i];
    if (fast !== null && slow !== null) macdSeries.push(fast - slow);
  }
  if (macdSeries.length < signalPeriod) return null;

  const signalSeries = calculateEMASeries(macdSeries, signalPeriod);
  const signal = signalSeries[signalSeries.length - 1];
  if (signal === null) return null;

  const macd = macdSeries[macdSeries.length - 1];
  return { macd, signal, histogram: macd - signal };
}

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Bollinger Bands: an SMA(period) midline with upper/lower bands
 * `stdDevMultiplier` standard deviations away - a volatility-relative
 * read on price, distinct from RSI's momentum read even though both
 * flag "oversold"/"overbought". Returns null if there isn't enough
 * history for the SMA.
 */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandsResult | null {
  const middle = calculateSMA(closes, period);
  if (middle === null) return null;

  const window = closes.slice(closes.length - period);
  const variance = window.reduce((sum, close) => sum + (close - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDevMultiplier * stdDev,
    middle,
    lower: middle - stdDevMultiplier * stdDev,
  };
}

const ADX_PERIOD = 14;
const ADX_TREND_THRESHOLD = 25;

/**
 * Wilder's Average Directional Index (ADX) - a trend-*strength* read
 * (0-100, no direction) used to tell a real trend apart from a choppy,
 * sideways market. Needs high/low, not just closes, which is why it
 * returns null for providers that don't supply them (CoinGecko's
 * market_chart - see coingeckoProvider.ts) rather than approximating.
 *
 * Found necessary the hard way: backtesting after adding MACD showed
 * SMA(20)/SMA(50) flipping golden-cross/death-cross repeatedly in
 * sideways stretches, each flip treated as a fresh signal and producing
 * a string of low-conviction trades. ADX is the standard fix - gate
 * trend-following signals (SMA, MACD) on it in scoreHolding() below,
 * rather than trusting every crossover equally.
 */
export function calculateADX(history: HistoryPoint[], period = ADX_PERIOD): number | null {
  if (history.length < period * 2 + 1) return null;
  if (history.some((point) => point.high == null || point.low == null)) return null;

  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < history.length; i++) {
    const high = history[i].high!;
    const low = history[i].low!;
    const prevHigh = history[i - 1].high!;
    const prevLow = history[i - 1].low!;
    const prevClose = history[i - 1].close;

    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing: a running total that keeps (period-1)/period of
  // itself and adds the new value - seeded with a plain sum of the
  // first `period` values, the standard ADX convention (not an EMA).
  function wilderSmooth(values: number[]): number[] {
    const smoothed: number[] = new Array(values.length).fill(NaN);
    let running = values.slice(0, period).reduce((total, value) => total + value, 0);
    smoothed[period - 1] = running;
    for (let i = period; i < values.length; i++) {
      running = running - running / period + values[i];
      smoothed[i] = running;
    }
    return smoothed;
  }

  const smoothedTR = wilderSmooth(trueRanges);
  const smoothedPlusDM = wilderSmooth(plusDMs);
  const smoothedMinusDM = wilderSmooth(minusDMs);

  const dxSeries: number[] = [];
  for (let i = period - 1; i < trueRanges.length; i++) {
    const tr = smoothedTR[i];
    if (!tr) continue;
    const plusDI = (100 * smoothedPlusDM[i]) / tr;
    const minusDI = (100 * smoothedMinusDM[i]) / tr;
    const diSum = plusDI + minusDI;
    dxSeries.push(diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / diSum);
  }
  if (dxSeries.length < period) return null;

  // ADX is itself a Wilder-smoothed average of DX, seeded with a plain
  // average of the first `period` DX values.
  let adx = dxSeries.slice(0, period).reduce((total, dx) => total + dx, 0) / period;
  for (let i = period; i < dxSeries.length; i++) {
    adx = (adx * (period - 1) + dxSeries[i]) / period;
  }
  return adx;
}

/**
 * Combines unrealized P&L, SMA trend, RSI momentum, MACD momentum,
 * Bollinger Band mean-reversion, and concentration risk into one
 * suggestion with every contributing reason - not just the winning one,
 * so the UI can show *why*. SMA/MACD (the trend-following pair) are
 * discounted when ADX says the market's too choppy to trust them.
 */
export function scoreHolding(params: {
  avgBuyPrice: number;
  currentPrice: number;
  history: HistoryPoint[];
  portfolioWeightPct: number;
}): SuggestionResult {
  const { avgBuyPrice, currentPrice, history, portfolioWeightPct } = params;
  const closes = history.map((point) => point.close);

  const pnlPct = avgBuyPrice > 0 ? ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollingerBands(closes);
  const adx = calculateADX(history);
  // Benefit of the doubt when ADX is unavailable (crypto, or too little
  // history) - we can't tell trend from chop, so don't suppress signals
  // we have no evidence against. When it IS available, require it to
  // confirm a real trend before trusting trend-following signals.
  const trendConfirmed = adx === null || adx >= ADX_TREND_THRESHOLD;
  const concentrationRisk = portfolioWeightPct > CONCENTRATION_LIMIT_PCT;

  const reasons: string[] = [];
  let score = 0;

  if (pnlPct < LOSS_REVIEW_THRESHOLD_PCT) {
    reasons.push(
      `Down ${Math.abs(pnlPct).toFixed(1)}% from your average buy price - large unrealized loss, worth a hard look.`
    );
    score -= 3;
  }

  if (sma20 !== null && sma50 !== null) {
    if (sma20 > sma50) {
      if (trendConfirmed) {
        reasons.push(`SMA(20) is above SMA(50) (${sma20.toFixed(2)} vs ${sma50.toFixed(2)}) - golden cross, bullish trend.`);
        score += 1;
      } else {
        reasons.push(`SMA(20) is above SMA(50), but ADX (${adx!.toFixed(1)}) is under ${ADX_TREND_THRESHOLD} - weak/choppy, discounting this golden cross.`);
      }
    } else if (sma20 < sma50) {
      if (trendConfirmed) {
        reasons.push(`SMA(20) is below SMA(50) (${sma20.toFixed(2)} vs ${sma50.toFixed(2)}) - death cross, bearish trend.`);
        score -= 1;
      } else {
        reasons.push(`SMA(20) is below SMA(50), but ADX (${adx!.toFixed(1)}) is under ${ADX_TREND_THRESHOLD} - weak/choppy, discounting this death cross.`);
      }
    }
  }

  if (rsi14 !== null) {
    if (rsi14 > RSI_OVERBOUGHT) {
      reasons.push(`RSI(14) is ${rsi14.toFixed(0)} - overbought.`);
      score -= 1;
    } else if (rsi14 < RSI_OVERSOLD) {
      reasons.push(`RSI(14) is ${rsi14.toFixed(0)} - oversold, potential buying opportunity.`);
      score += 1;
    }
  }

  if (macd !== null) {
    if (macd.macd > macd.signal) {
      if (trendConfirmed) {
        reasons.push(
          `MACD (${macd.macd.toFixed(2)}) is above its signal line (${macd.signal.toFixed(2)}) - bullish momentum.`
        );
        score += 1;
      } else {
        reasons.push(`MACD is above its signal line, but ADX (${adx!.toFixed(1)}) is under ${ADX_TREND_THRESHOLD} - weak/choppy, discounting this.`);
      }
    } else if (macd.macd < macd.signal) {
      if (trendConfirmed) {
        reasons.push(
          `MACD (${macd.macd.toFixed(2)}) is below its signal line (${macd.signal.toFixed(2)}) - bearish momentum.`
        );
        score -= 1;
      } else {
        reasons.push(`MACD is below its signal line, but ADX (${adx!.toFixed(1)}) is under ${ADX_TREND_THRESHOLD} - weak/choppy, discounting this.`);
      }
    }
  }

  if (bollinger !== null) {
    if (currentPrice < bollinger.lower) {
      reasons.push(
        `Price (${currentPrice.toFixed(2)}) is below the lower Bollinger Band (${bollinger.lower.toFixed(2)}) - stretched below its usual range, potential mean-reversion buy.`
      );
      score += 1;
    } else if (currentPrice > bollinger.upper) {
      reasons.push(
        `Price (${currentPrice.toFixed(2)}) is above the upper Bollinger Band (${bollinger.upper.toFixed(2)}) - stretched above its usual range, overbought.`
      );
      score -= 1;
    }
  }

  if (concentrationRisk) {
    reasons.push(
      `This holding is ${portfolioWeightPct.toFixed(1)}% of your portfolio, above the ${CONCENTRATION_LIMIT_PCT}% concentration threshold - trim regardless of other signals.`
    );
  }

  let suggestion: Suggestion;
  if (pnlPct < LOSS_REVIEW_THRESHOLD_PCT) {
    suggestion = "SELL_REVIEW";
  } else if (concentrationRisk) {
    suggestion = "TRIM";
  } else if (score >= 2) {
    suggestion = "STRONG_BUY";
  } else if (score <= -2) {
    suggestion = "TRIM";
  } else {
    suggestion = "HOLD";
  }

  if (reasons.length === 0) {
    reasons.push("No strong signals either way - holding steady.");
  }

  return { suggestion, reasons };
}
