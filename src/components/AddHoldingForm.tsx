"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BuyPriceInput, { defaultBuyPrice, type BuyPriceValue } from "@/components/BuyPriceInput";

const ASSET_CLASSES = [
  { value: "IN_STOCK", label: "India Stock (e.g. RELIANCE.NS)" },
  { value: "US_STOCK", label: "US Stock (e.g. AAPL)" },
  { value: "CRYPTO", label: "Crypto (CoinGecko id, e.g. bitcoin)" },
];

// defaultAssetClass: pre-selects the class for the tab the form opens on.
export default function AddHoldingForm({ defaultAssetClass = ASSET_CLASSES[0].value }: { defaultAssetClass?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Controlled because the buy-price preview depends on them.
  const [assetClass, setAssetClass] = useState(defaultAssetClass);
  const [quantity, setQuantity] = useState("");
  const [buyDate, setBuyDate] = useState("");
  const [price, setPrice] = useState<BuyPriceValue>(defaultBuyPrice(defaultAssetClass));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    // Grab the element now - React clears event.currentTarget once we await.
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const payload = {
      assetClass: form.get("assetClass"),
      symbol: form.get("symbol"),
      displayName: form.get("displayName") || undefined,
      quantity: Number(form.get("quantity")),
      avgBuyPrice: Number(price.amount),
      priceCurrency: price.currency,
      priceMode: price.mode,
      buyDate: form.get("buyDate"),
      notes: form.get("notes") || undefined,
    };

    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to add holding");
      }

      formEl.reset();
      setQuantity("");
      setBuyDate("");
      setPrice(defaultBuyPrice(assetClass));
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add holding");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        + Add holding
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card grid basis-full gap-3 p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
        Asset class
        <select
          name="assetClass"
          required
          value={assetClass}
          onChange={(e) => {
            setAssetClass(e.target.value);
            setPrice(defaultBuyPrice(e.target.value));
          }}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15">
          {ASSET_CLASSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
        Symbol
        <input name="symbol" required className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15" />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
        Display name (optional)
        <input name="displayName" className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15" />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
        Quantity
        <input
          name="quantity"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          step="any"
          min="0"
          required
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15"
        />
      </label>

      <BuyPriceInput
        assetClass={assetClass}
        quantity={Number(quantity)}
        buyDate={buyDate}
        value={price}
        onChange={setPrice}
      />

      <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
        Buy date
        <input
          name="buyDate"
          type="date"
          value={buyDate}
          onChange={(e) => setBuyDate(e.target.value)}
          required
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15"
        />
      </label>

      <label className="col-span-full flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
        Notes (optional)
        <textarea name="notes" rows={2} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15" />
      </label>

      {error && <p className="col-span-full text-sm text-loss">{error}</p>}

      <div className="col-span-full flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {submitting ? "Adding..." : "Add holding"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
