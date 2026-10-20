"use client";

import { useState } from "react";
import type { UpcomingIpo } from "@/lib/providers/ipoProvider";

interface Tab {
  key: string;
  label: string;
  ipos: UpcomingIpo[];
  message: string | null;
}

function IpoTable({ ipos }: { ipos: UpcomingIpo[] }) {
  if (ipos.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No upcoming IPOs found.</p>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Exchange</th>
            <th className="px-4 py-2">Open</th>
            <th className="px-4 py-2">Close</th>
            <th className="px-4 py-2 text-right">Price band</th>
          </tr>
        </thead>
        <tbody>
          {ipos.map((ipo, i) => (
            <tr
              key={`${ipo.name}-${i}`}
            >
              <td className="px-4 py-3">{ipo.name}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{ipo.exchange}</td>
              <td className="px-4 py-3 tabular-nums">{ipo.openDate ?? "--"}</td>
              <td className="px-4 py-3 tabular-nums">{ipo.closeDate ?? "--"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{ipo.priceBand ?? "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function IpoTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab.key === current?.key
                ? "border-b-2 border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {current?.message ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{current.message}</p>
      ) : (
        <IpoTable ipos={current?.ipos ?? []} />
      )}
    </div>
  );
}
