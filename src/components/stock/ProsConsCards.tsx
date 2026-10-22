import { ThumbsDown, ThumbsUp } from "lucide-react";

// Screener-style green/red Pros & Cons boxes, shared by the stock and
// crypto panels. Hidden entirely when there is nothing to say.
export default function ProsConsCards({ pros, cons, note }: { pros: string[]; cons: string[]; note: string }) {
  if (pros.length === 0 && cons.length === 0) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-green-300 bg-green-50/40 p-5 dark:border-green-800 dark:bg-green-900/10">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-800 dark:text-green-300">
          <ThumbsUp size={14} /> Pros
        </h3>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {pros.length ? pros.map((p) => <li key={p}>{p}</li>) : <li className="-ml-5 list-none text-slate-400">Nothing stands out.</li>}
        </ul>
      </div>
      <div className="rounded-2xl border border-red-300 bg-red-50/40 p-5 dark:border-red-900 dark:bg-red-900/10">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-800 dark:text-red-300">
          <ThumbsDown size={14} /> Cons
        </h3>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {cons.length ? cons.map((c) => <li key={c}>{c}</li>) : <li className="-ml-5 list-none text-slate-400">Nothing stands out.</li>}
        </ul>
      </div>
      <p className="text-xs text-slate-400 md:col-span-2">* {note}</p>
    </div>
  );
}
