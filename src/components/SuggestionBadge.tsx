import type { Suggestion } from "@/lib/suggestions/scoreHolding";

const SUGGESTION_STYLES: Record<Suggestion, string> = {
  STRONG_BUY: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  HOLD: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  TRIM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  SELL_REVIEW: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// Shared by HoldingsTable (/portfolio) and BrokerHoldingsTable (broker pages).
export default function SuggestionBadge({ suggestion, reasons }: { suggestion: Suggestion; reasons: string[] }) {
  return (
    <span
      title={reasons.join("\n")}
      className={`inline-block cursor-help rounded-full px-2 py-1 text-xs font-medium ${SUGGESTION_STYLES[suggestion]}`}
    >
      {suggestion.replace("_", " ")}
    </span>
  );
}
