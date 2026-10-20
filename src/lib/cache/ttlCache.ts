import { prisma } from "@/lib/prisma";

/**
 * Very small TTL cache backed by the QuoteCache table. Free/unofficial
 * market data endpoints (Yahoo, CoinGecko keyless) are rate-limited, and
 * several pages/users could request the same symbol within seconds of
 * each other - this collapses those into one upstream call per TTL window.
 *
 * Swap this for Redis later without touching any provider code, since
 * callers only ever see `withCache`.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await prisma.quoteCache.findUnique({ where: { key } });

  if (cached) {
    const ageSeconds = (Date.now() - cached.fetchedAt.getTime()) / 1000;
    if (ageSeconds < ttlSeconds) {
      return JSON.parse(cached.payload) as T;
    }
  }

  const fresh = await fetcher();

  await prisma.quoteCache.upsert({
    where: { key },
    create: { key, payload: JSON.stringify(fresh) },
    update: { payload: JSON.stringify(fresh), fetchedAt: new Date() },
  });

  return fresh;
}
