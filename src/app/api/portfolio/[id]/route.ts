import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveAvgBuyPrice } from "@/lib/fx";

// PATCH  /api/portfolio/:id -> update quantity/avgBuyPrice/displayName/notes
// DELETE /api/portfolio/:id -> remove a holding
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Prisma.HoldingUpdateInput = {};

  if (body.quantity !== undefined) {
    if (typeof body.quantity !== "number" || !(body.quantity > 0)) {
      return NextResponse.json({ error: "quantity must be a positive number" }, { status: 400 });
    }
    data.quantity = body.quantity;
  }
  let fx: Awaited<ReturnType<typeof resolveAvgBuyPrice>>["fx"] = null;
  if (body.avgBuyPrice !== undefined) {
    // Same optional priceCurrency/priceMode conversion as POST - needs the
    // stored asset class + buy date (for the historical USD/INR rate) and
    // the quantity this update will leave in place.
    const existing = await prisma.holding.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    }
    try {
      const resolved = await resolveAvgBuyPrice({
        amount: body.avgBuyPrice,
        priceCurrency: body.priceCurrency,
        priceMode: body.priceMode,
        quantity: typeof data.quantity === "number" ? data.quantity : existing.quantity,
        assetClass: existing.assetClass,
        buyDate: existing.buyDate,
      });
      data.avgBuyPrice = resolved.avgBuyPrice;
      fx = resolved.fx;
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid price" }, { status: 400 });
    }
  }
  if (body.displayName !== undefined) {
    data.displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;
  }
  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const holding = await prisma.holding.update({ where: { id: params.id }, data });
    return NextResponse.json({ ...holding, fx });
  } catch {
    return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.holding.delete({ where: { id: params.id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  }
}
