import { NextRequest, NextResponse } from "next/server";
import { getCryptoDetails } from "@/lib/fundamentals/cryptoDetails";
import { COIN_ID } from "@/lib/fundamentals/paths";

// GET /api/fundamentals/crypto/bitcoin -> CryptoDetails (CoinGecko id)
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id).toLowerCase();
  if (!COIN_ID.test(id)) return NextResponse.json({ error: "Expected a CoinGecko coin id like bitcoin" }, { status: 400 });
  try {
    return NextResponse.json(await getCryptoDetails(id));
  } catch (err) {
    console.error(`Crypto details failed for ${id}`, err);
    const message = err instanceof Error && /rate limit|Unknown coin/.test(err.message) ? err.message : "Couldn't load this coin right now.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
