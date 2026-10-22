import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAvgBuyPrice } from "@/lib/fx";
import { resolveHoldingSymbol, SymbolNotFoundError, type ResolvedSymbol } from "@/lib/portfolio/resolveSymbol";

const ASSET_CLASSES = ["IN_STOCK", "US_STOCK", "CRYPTO"] as const;

// GET  /api/portfolio -> list all holdings
// POST /api/portfolio -> create a holding
export async function GET() {
  const holdings = await prisma.holding.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(holdings);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // priceCurrency ("INR" | "USD") and priceMode ("PER_UNIT" | "TOTAL") are
  // optional: avgBuyPrice may be typed in rupees and/or as the total paid,
  // and is converted to the asset's native per-unit price (see lib/fx.ts).
  const { assetClass, symbol, displayName, quantity, avgBuyPrice, buyDate, notes, priceCurrency, priceMode } = body;

  if (!ASSET_CLASSES.includes(assetClass)) {
    return NextResponse.json(
      { error: `assetClass must be one of ${ASSET_CLASSES.join(", ")}` },
      { status: 400 }
    );
  }
  if (typeof symbol !== "string" || symbol.trim() === "") {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  if (typeof quantity !== "number" || !(quantity > 0)) {
    return NextResponse.json({ error: "quantity must be a positive number" }, { status: 400 });
  }
  let resolvedSymbol: ResolvedSymbol;
  try {
    resolvedSymbol = await resolveHoldingSymbol(assetClass, symbol);
  } catch (err) {
    if (err instanceof SymbolNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(`Symbol lookup failed for ${assetClass} ${symbol}`, err);
    return NextResponse.json(
      { error: "Couldn't reach the price source to verify this symbol. Try again in a minute." },
      { status: 502 }
    );
  }

  const parsedBuyDate = new Date(buyDate);
  if (isNaN(parsedBuyDate.getTime())) {
    return NextResponse.json({ error: "buyDate must be a valid date" }, { status: 400 });
  }

  let resolved: Awaited<ReturnType<typeof resolveAvgBuyPrice>>;
  try {
    resolved = await resolveAvgBuyPrice({
      amount: avgBuyPrice,
      priceCurrency,
      priceMode,
      quantity,
      assetClass,
      buyDate: parsedBuyDate,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid price" }, { status: 400 });
  }

  const holding = await prisma.holding.create({
    data: {
      assetClass,
      symbol: resolvedSymbol.symbol,
      displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim() : resolvedSymbol.displayName,
      quantity,
      avgBuyPrice: resolved.avgBuyPrice,
      buyDate: parsedBuyDate,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    },
  });

  return NextResponse.json({ ...holding, fx: resolved.fx }, { status: 201 });
}
