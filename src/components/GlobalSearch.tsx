"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Search, X } from "lucide-react";
import type { SearchResult } from "@/lib/search";
import { detailPath } from "@/lib/fundamentals/paths";
import SymbolAvatar from "@/components/ui/SymbolAvatar";

const GROUPS: { market: SearchResult["market"]; label: string }[] = [
  { market: "india", label: "Indian stocks" },
  { market: "us", label: "US stocks" },
  { market: "crypto", label: "Crypto" },
];
const RECENT_KEY = "recentSearches";
const MAX_RECENT = 6;

function loadRecent(): SearchResult[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Header search: type a company, ticker or coin -> grouped results
 * (Indian stocks / US stocks / Crypto) -> opens that fundamentals page.
 * Keyboard: Ctrl/⌘+K or "/" to focus, ↑/↓ to move, Enter to open, Esc to
 * close. Recent picks are remembered in this browser only.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => setRecent(loadRecent()), []);

  // Global shortcuts: Ctrl/⌘+K anywhere, "/" when not typing elsewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking outside.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Debounced fetch; ignores stale responses if the query moved on.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setFailed([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const body = await res.json();
        if (!cancelled) {
          setResults(body.results ?? []);
          setFailed(body.failed ?? []);
          setActive(0);
        }
      } catch {
        if (!cancelled) setFailed(["stocks", "crypto"]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const showingRecent = q.trim().length < 2;
  // Flat list in display order, so ↑/↓ follows what's on screen.
  const ordered = useMemo(
    () => (showingRecent ? recent : GROUPS.flatMap((g) => results.filter((r) => r.market === g.market))),
    [showingRecent, recent, results]
  );

  const pick = useCallback(
    (r: SearchResult) => {
      const next = [r, ...loadRecent().filter((x) => !(x.symbol === r.symbol && x.market === r.market))].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable - recents just won't persist
      }
      setRecent(next);
      setOpen(false);
      setQ("");
      inputRef.current?.blur();
      router.push(detailPath(r.market, r.symbol));
    },
    [router]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(ordered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && ordered[active]) {
      e.preventDefault();
      pick(ordered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const row = (r: SearchResult, i: number) => (
    <li key={`${r.market}:${r.symbol}`} role="option" aria-selected={i === active}>
      <button
        type="button"
        onMouseEnter={() => setActive(i)}
        onClick={() => pick(r)}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}
      >
        {r.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.image} alt="" width={28} height={28} className="h-7 w-7 rounded-full" />
        ) : (
          <SymbolAvatar ticker={r.ticker} size="sm" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{r.name}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {r.ticker} · {r.exchange}
            {r.kind === "ETF" && " · ETF"}
          </span>
        </span>
      </button>
    </li>
  );

  let index = 0;
  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">Search stocks and crypto</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search stocks, ETFs or crypto - e.g. Reliance, AAPL, Solana"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-16 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <X size={14} />
            </button>
          ) : (
            <kbd className="hidden rounded border border-slate-200 px-1.5 text-[10px] font-medium text-slate-400 dark:border-slate-700 sm:inline">Ctrl K</kbd>
          )}
        </span>
      </label>

      {open && (showingRecent ? recent.length > 0 : true) && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {showingRecent ? (
            <>
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Clock size={11} /> Recent
              </div>
              <ul>{recent.map((r) => row(r, index++))}</ul>
            </>
          ) : (
            <>
              {GROUPS.map((g) => {
                const items = results.filter((r) => r.market === g.market);
                if (items.length === 0) return null;
                return (
                  <div key={g.market}>
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
                    <ul>{items.map((r) => row(r, index++))}</ul>
                  </div>
                );
              })}
              {!loading && results.length === 0 && (
                <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No stocks or coins match &ldquo;{q.trim()}&rdquo;.</p>
              )}
              {failed.length > 0 && (
                <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {failed.includes("stocks") && failed.includes("crypto")
                    ? "Search is unavailable right now."
                    : `${failed.includes("crypto") ? "Crypto" : "Stock"} search is unavailable right now.`}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
