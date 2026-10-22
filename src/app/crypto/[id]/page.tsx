import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCryptoDetails, type CryptoDetails } from "@/lib/fundamentals/cryptoDetails";
import { COIN_ID } from "@/lib/fundamentals/paths";
import CryptoDetailPanel from "@/components/stock/CryptoDetailPanel";

// /crypto/bitcoin - full coin page (CoinGecko id). Server-fetches the
// stats so the page arrives filled in; the chart loads per range.
export default async function CoinPage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id).toLowerCase();
  if (!COIN_ID.test(id)) notFound();

  let details: CryptoDetails | null = null;
  let error: string | null = null;
  try {
    details = await getCryptoDetails(id);
  } catch (err) {
    console.error(`Coin page failed for ${id}`, err);
    error = err instanceof Error && err.message === "Unknown coin" ? `No coin called "${id}" on CoinGecko.` : "Couldn't load this coin right now. Try again in a bit.";
  }

  return (
    <div className="space-y-4">
      <Link href="/crypto" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <ArrowLeft size={14} /> Crypto
      </Link>
      {error || !details ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</p>
      ) : (
        <CryptoDetailPanel id={id} variant="page" initial={details} />
      )}
    </div>
  );
}
