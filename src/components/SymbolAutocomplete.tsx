"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { SearchResult } from "@/lib/search";

// Symbol box for the add-holding form: suggestions from /api/search,
// narrowed to the selected asset class. Picking one fills the exact
// provider symbol (RELIANCE.NS / AAPL / ethereum), so the holding always
// gets a live price. Free typing still works - the server resolves and
// verifies whatever is submitted (lib/portfolio/resolveSymbol.ts).

const MARKET_FOR_CLASS: Record<string, "india" | "us" | "crypto"> = {
  IN_STOCK: "india",
  US_STOCK: "us",
  CRYPTO: "crypto",
};

const PLACEHOLDER: Record<string, string> = {
  IN_STOCK: "Search e.g. Reliance, TCS, GOLDBEES",
  US_STOCK: "Search e.g. Apple, NVDA",
  CRYPTO: "Search e.g. Ethereum, BTC",
};

const DEBOUNCE_MS = 250;

export default function SymbolAutocomplete({
  assetClass,
  name,
  onSelect,
  inputClassName,
}: {
  assetClass: string;
  name: string;
  onSelect: (result: SearchResult | null) => void;
  inputClassName: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const market = MARKET_FOR_CLASS[assetClass];

  // Switching asset class invalidates whatever was typed/picked.
  useEffect(() => {
    setQuery("");
    setResults([]);
    setSelected(null);
    onSelect(null);
    // onSelect is a stable setter from the parent; re-running on it isn't wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetClass]);

  useEffect(() => {
    const q = query.trim();
    if (selected || q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}&market=${market}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((body: { results: SearchResult[]; failed: string[] }) => {
          setResults(body.results ?? []);
          setUnavailable((body.failed ?? []).length > 0);
          setActive(0);
          setLoading(false);
        })
        .catch((err) => {
          if (err?.name !== "AbortError") {
            setUnavailable(true);
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, market, selected]);

  // Close the list on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(r: SearchResult) {
    setSelected(r);
    setQuery(r.symbol);
    setOpen(false);
    onSelect(r);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault(); // pick, don't submit the form
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && !selected && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative">
      <input
        name={name}
        required
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={PLACEHOLDER[assetClass]}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (selected) {
            setSelected(null);
            onSelect(null);
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`${inputClassName} w-full pr-8`}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        {loading ? <Loader2 size={14} className="animate-spin" /> : selected ? <Check size={14} className="text-gain dark:text-gain-dark" /> : null}
      </span>

      {selected && (
        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
          {selected.name} · {selected.exchange}
        </p>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {results.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              {unavailable ? "Suggestions unavailable right now - you can still type the symbol." : "No matches - you can still type the symbol."}
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.symbol}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus; mousedown fires before the input's blur
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${
                i === active ? "bg-slate-100 dark:bg-slate-800" : ""
              }`}
            >
              {r.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image} alt="" className="h-5 w-5 shrink-0 rounded-full" />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {r.ticker.slice(0, 2)}
                </span>
              )}
              <span className="w-24 shrink-0 truncate font-medium text-slate-900 dark:text-white">{r.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.name}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {r.kind === "ETF" ? "ETF · " : ""}
                {r.exchange}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
