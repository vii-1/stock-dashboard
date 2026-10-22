import { yahooIndiaProvider, yahooUsProvider } from "@/lib/providers/yahooProvider";
import { coingeckoProvider, resolveCoinId } from "@/lib/providers/coingeckoProvider";

// Normalise and verify a holding's symbol BEFORE it's saved. The add form
// is free text, and a symbol the price providers don't recognise (e.g.
// "ETH" instead of CoinGecko's "ethereum", or "RELIANCE" without ".NS")
// used to be stored as-is - the holding then silently showed "--" for
// price/value/P&L forever. Now it's either fixed up or rejected.

export class SymbolNotFoundError extends Error {}

export interface ResolvedSymbol {
  symbol: string; // what the providers expect
  displayName: string; // provider's name, used when the user left it blank
}

async function quoteOrNull(provider: typeof yahooIndiaProvider, symbol: string) {
  try {
    return await provider.getQuote(symbol);
  } catch {
    return null;
  }
}

export async function resolveHoldingSymbol(assetClass: string, raw: string): Promise<ResolvedSymbol> {
  const input = raw.trim();

  if (assetClass === "CRYPTO") {
    const coin = await resolveCoinId(input); // network failure throws -> caller reports 502
    if (!coin) {
      throw new SymbolNotFoundError(`Couldn't find a coin called "${input}" on CoinGecko. Try its name (e.g. Ethereum) or ticker (e.g. ETH).`);
    }
    const quote = await coingeckoProvider.getQuote(coin.id);
    return { symbol: coin.id, displayName: quote.displayName || coin.name };
  }

  if (assetClass === "IN_STOCK") {
    const upper = input.toUpperCase();
    // No exchange suffix typed: NSE first (where nearly everything trades), then BSE.
    const candidates = /\.(NS|BO)$/.test(upper) ? [upper] : [`${upper}.NS`, `${upper}.BO`];
    for (const symbol of candidates) {
      const quote = await quoteOrNull(yahooIndiaProvider, symbol);
      if (quote) return { symbol, displayName: quote.displayName };
    }
    throw new SymbolNotFoundError(`Couldn't find "${input}" on NSE or BSE. Use the exchange ticker, e.g. RELIANCE or RELIANCE.NS.`);
  }

  if (assetClass === "US_STOCK") {
    const symbol = input.toUpperCase();
    const quote = await quoteOrNull(yahooUsProvider, symbol);
    if (quote) return { symbol, displayName: quote.displayName };
    throw new SymbolNotFoundError(`Couldn't find a US ticker "${input}". Use the exchange ticker, e.g. AAPL.`);
  }

  throw new SymbolNotFoundError(`Unknown asset class: ${assetClass}`);
}
