"use client";

import { useEffect, useState } from "react";
import { nativeCurrency, toNativeUnitPrice, type Currency, type PriceMode } from "@/lib/fxConvert";
import { formatMoney } from "@/lib/format";

export interface BuyPriceValue {
  amount: string;
  currency: Currency;
  mode: PriceMode;
}

export function defaultBuyPrice(assetClass: string): BuyPriceValue {
  // Rupees by default for everything - that's what you actually paid.
  // Crypto defaults to "total invested" since fractional quantities make
  // a per-coin price awkward to work out by hand.
  return { amount: "", currency: "INR", mode: assetClass === "CRYPTO" ? "TOTAL" : "PER_UNIT" };
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Buy-price entry with a rupee/dollar toggle and per-unit/total toggle.
 * Shows a live preview of the per-unit price that will be stored in the
 * asset's native currency (the server recomputes it on save with the
 * same buy-date USD/INR rate - see lib/fx.ts).
 */
export default function BuyPriceInput({
  assetClass,
  quantity,
  buyDate,
  value,
  onChange,
  compact = false,
}: {
  assetClass: string;
  quantity: number;
  buyDate: string; // YYYY-MM-DD, may be empty
  value: BuyPriceValue;
  onChange: (v: BuyPriceValue) => void;
  compact?: boolean;
}) {
  const native = nativeCurrency(assetClass);
  const needsFx = value.currency !== native;
  const [fx, setFx] = useState<{ rate: number; asOf: string } | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);

  // Indian stocks only trade in rupees - no dollar option there.
  useEffect(() => {
    if (native === "INR" && value.currency !== "INR") onChange({ ...value, currency: "INR" });
  }, [native, value, onChange]);

  useEffect(() => {
    if (!needsFx) return;
    let cancelled = false;
    setFxError(null);
    fetch(`/api/fx/usdinr${buyDate ? `?date=${buyDate}` : ""}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Rate unavailable");
        if (!cancelled) setFx(body);
      })
      .catch((err) => !cancelled && setFxError(err instanceof Error ? err.message : "Rate unavailable"));
    return () => {
      cancelled = true;
    };
  }, [needsFx, buyDate]);

  const amount = Number(value.amount);
  let preview: string | null = null;
  if (amount > 0 && quantity > 0 && (!needsFx || fx)) {
    try {
      const unit = toNativeUnitPrice({
        amount,
        mode: value.mode,
        quantity,
        inputCurrency: value.currency,
        native,
        usdInr: fx?.rate ?? null,
      });
      const parts = [`${formatMoney(unit, native)} per unit`];
      if (needsFx && fx) parts.push(`at ₹${fx.rate.toFixed(2)}/$ (${fx.asOf})`);
      if (value.mode === "TOTAL" || needsFx) preview = `Stored as ${parts.join(" ")}`;
    } catch {
      preview = null;
    }
  } else if (value.mode === "TOTAL" && !(quantity > 0)) {
    preview = "Enter a quantity to work out the per-unit price";
  }

  const symbol = value.currency === "INR" ? "₹" : "$";

  return (
    <div className="flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{value.mode === "TOTAL" ? "Total amount invested" : "Avg buy price"}</span>
        <div className="flex gap-1.5">
          <Segmented
            label="Price entered as"
            value={value.mode}
            onChange={(mode) => onChange({ ...value, mode })}
            options={[
              { value: "PER_UNIT", label: "Per unit" },
              { value: "TOTAL", label: "Total" },
            ]}
          />
          {native === "USD" && (
            <Segmented
              label="Currency"
              value={value.currency}
              onChange={(currency) => onChange({ ...value, currency })}
              options={[
                { value: "INR", label: "₹ INR" },
                { value: "USD", label: "$ USD" },
              ]}
            />
          )}
        </div>
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">{symbol}</span>
        <input
          type="number"
          step="any"
          min="0"
          required
          aria-label={value.mode === "TOTAL" ? "Total amount invested" : "Average buy price"}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          className={`w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2.5 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15 ${compact ? "text-xs" : ""}`}
        />
      </div>
      {fxError && needsFx ? (
        <span className="text-xs text-loss">{fxError}</span>
      ) : (
        preview && <span className="text-xs text-slate-500 dark:text-slate-400">{preview}</span>
      )}
    </div>
  );
}
