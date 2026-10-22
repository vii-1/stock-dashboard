// Pure, testable pros/cons for a coin - the crypto counterpart of
// buildProsCons in analysis.ts. Coins have no statements, so the rules
// look at what does matter for them: size, supply/dilution, liquidity,
// distance from the all-time high, track record. Each rule only fires
// when its inputs exist and states the number behind it.

export interface CoinFacts {
  name: string;
  rank: number | null;
  marketCap: number | null; // USD
  fdv: number | null; // fully diluted valuation, USD
  volume24h: number | null; // USD
  circulating: number | null;
  maxSupply: number | null; // null = uncapped
  athChangePct: number | null; // e.g. -35.5
  ath: number | null;
  athDate: string | null; // ISO
  change1y: number | null; // %
  genesisDate: string | null; // YYYY-MM-DD
  isStablecoin: boolean;
}

const usd = (x: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: x < 1 ? 4 : 0 }).format(x);
const year = (iso: string) => iso.slice(0, 4);

export function buildCryptoProsCons(c: CoinFacts, now = new Date()): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];

  if (c.rank != null) {
    if (c.rank <= 10) pros.push(`One of the 10 largest coins by market cap (#${c.rank}).`);
    else if (c.rank > 200) cons.push(`Small coin (#${c.rank} by market cap) - usually more volatile and less liquid.`);
  }

  // Supply / dilution. Stablecoins are minted on demand by design, so the
  // "uncapped supply" warning would be noise for them.
  if (!c.isStablecoin) {
    if (c.maxSupply && c.circulating) {
      const issued = (c.circulating / c.maxSupply) * 100;
      if (issued >= 90) pros.push(`${issued.toFixed(0)}% of the maximum supply is already issued - little future dilution.`);
      else if (issued < 50) cons.push(`Only ${issued.toFixed(0)}% of the maximum supply is issued so far - more tokens are still to come.`);
    } else if (c.maxSupply == null && c.circulating != null) {
      cons.push("No maximum supply - new tokens can keep being issued.");
    }
    if (c.fdv && c.marketCap && c.fdv / c.marketCap >= 1.5) {
      cons.push(
        `Fully diluted value is ${(c.fdv / c.marketCap).toFixed(1)}x today's market cap - future token unlocks could add selling pressure.`
      );
    }
  }

  if (c.volume24h != null && c.marketCap) {
    const turnover = (c.volume24h / c.marketCap) * 100;
    if (turnover < 1) cons.push(`Thin trading: 24h volume is only ${turnover.toFixed(2)}% of market cap.`);
    else if (turnover >= 5 && !c.isStablecoin) pros.push(`Actively traded: 24h volume is ${turnover.toFixed(1)}% of market cap.`);
  }

  if (c.athChangePct != null && c.ath != null && !c.isStablecoin) {
    const when = c.athDate ? ` (${year(c.athDate)})` : "";
    if (c.athChangePct <= -70) cons.push(`Trading ${Math.abs(c.athChangePct).toFixed(0)}% below its all-time high of ${usd(c.ath)}${when}.`);
    else if (c.athChangePct >= -10) pros.push(`Within ${Math.abs(c.athChangePct).toFixed(0)}% of its all-time high of ${usd(c.ath)}${when}.`);
  }

  if (c.change1y != null && !c.isStablecoin) {
    if (c.change1y >= 50) pros.push(`Up ${c.change1y.toFixed(0)}% over the past year.`);
    else if (c.change1y <= -50) cons.push(`Down ${Math.abs(c.change1y).toFixed(0)}% over the past year.`);
  }

  if (c.genesisDate) {
    const ageYears = (now.getTime() - new Date(c.genesisDate).getTime()) / (365.25 * 86400 * 1000);
    if (ageYears >= 8) pros.push(`Long track record - launched in ${year(c.genesisDate)}.`);
    else if (ageYears < 2) cons.push(`Young project (launched ${year(c.genesisDate)}) - a short track record.`);
  }

  return { pros, cons };
}
