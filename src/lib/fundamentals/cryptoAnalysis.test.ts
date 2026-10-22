import { describe, expect, it } from "vitest";
import { buildCryptoProsCons, type CoinFacts } from "./cryptoAnalysis";

// Bitcoin's shape on 2026-10-20 (CoinGecko).
const btc: CoinFacts = {
  name: "Bitcoin",
  rank: 1,
  marketCap: 1_634_757_917_851,
  fdv: 1_634_757_917_851,
  volume24h: 23_475_131_850,
  circulating: 20_098_843,
  maxSupply: 21_000_000,
  athChangePct: -35.5,
  ath: 126_080,
  athDate: "2025-10-06T10:57:42.000Z",
  change1y: -26.8,
  genesisDate: "2009-01-03",
  isStablecoin: false,
};
const now = new Date("2026-10-20");

describe("buildCryptoProsCons", () => {
  it("credits a large, mostly-issued, long-lived coin", () => {
    const { pros, cons } = buildCryptoProsCons(btc, now);
    expect(pros.some((p) => p.includes("10 largest"))).toBe(true);
    expect(pros.some((p) => p.includes("96% of the maximum supply"))).toBe(true);
    expect(pros.some((p) => p.includes("launched in 2009"))).toBe(true);
    expect(cons).toEqual([]);
  });

  it("flags dilution, thin volume, a deep drawdown and a short history", () => {
    const { cons } = buildCryptoProsCons(
      {
        ...btc,
        name: "NewToken",
        rank: 450,
        marketCap: 100_000_000,
        fdv: 400_000_000,
        volume24h: 500_000,
        circulating: 250_000_000,
        maxSupply: 1_000_000_000,
        athChangePct: -88,
        ath: 4.2,
        change1y: -70,
        genesisDate: "2025-06-01",
      },
      now
    );
    expect(cons.some((c) => c.includes("Small coin"))).toBe(true);
    expect(cons.some((c) => c.includes("Only 25% of the maximum supply"))).toBe(true);
    expect(cons.some((c) => c.includes("4.0x today's market cap"))).toBe(true);
    expect(cons.some((c) => c.includes("Thin trading"))).toBe(true);
    expect(cons.some((c) => c.includes("88% below"))).toBe(true);
    expect(cons.some((c) => c.includes("Young project"))).toBe(true);
  });

  it("doesn't warn about uncapped supply or drawdowns for stablecoins", () => {
    const { cons } = buildCryptoProsCons({ ...btc, name: "Tether", isStablecoin: true, maxSupply: null, athChangePct: -80 }, now);
    expect(cons.some((c) => c.includes("No maximum supply"))).toBe(false);
    expect(cons.some((c) => c.includes("below its all-time high"))).toBe(false);
  });
});
