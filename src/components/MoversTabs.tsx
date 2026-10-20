"use client";

import { useState } from "react";
import type { Quote } from "@/lib/providers/types";
import MoversTable from "@/components/MoversTable";

export interface MoversTab {
  key: string;
  label: string;
  quotes: Quote[];
}

// Chip-filter header over one movers list (Groww's "Top gainers / Top
// losers" pills). Both lists are server-fetched up front, so switching is
// instant and needs no client fetch.
export default function MoversTabs({
  tabs,
  sparks,
  details,
  footnote,
}: {
  tabs: MoversTab[];
  sparks?: Record<string, number[]>;
  details?: "expand" | "link";
  footnote?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={tab.key === current?.key}
            onClick={() => setActive(tab.key)}
            className={`chip ${tab.key === current?.key ? "chip-active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
        {footnote && <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{footnote}</span>}
      </div>
      <div role="tabpanel">{current && <MoversTable quotes={current.quotes} sparks={sparks} details={details} />}</div>
    </section>
  );
}
