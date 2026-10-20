import { getIndexQuotes } from "@/lib/market/indices";
import { formatNumber } from "@/lib/format";
import ChangeText from "@/components/ui/ChangeText";

// Scrolling benchmark strip across the top of every page (Tickertape's
// header pattern). The list is rendered twice so the CSS marquee loops
// seamlessly; the copy is aria-hidden. Pauses on hover and is static
// under prefers-reduced-motion (see .ticker-track in globals.css).
export default async function TickerTape() {
  let items: Awaited<ReturnType<typeof getIndexQuotes>> = [];
  try {
    items = await getIndexQuotes();
  } catch (err) {
    console.error("Ticker tape failed", err);
  }
  if (items.length === 0) return null;

  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={hidden || undefined}>
      {items.map(({ label, quote }) => (
        <li key={label} className="flex items-center gap-2 whitespace-nowrap text-xs">
          <span className="font-semibold text-slate-200">{label}</span>
          <span className="tabular-nums text-slate-300">{formatNumber(quote.price, quote.currency)}</span>
          <ChangeText pct={quote.changePercent} onDark className="text-[11px]" />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ticker overflow-hidden border-b border-slate-800 bg-slate-950 py-2" aria-label="Market indices">
      <div className="ticker-track flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
