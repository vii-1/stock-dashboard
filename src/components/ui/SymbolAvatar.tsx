// Logo stand-in: we have no licensed logo source, so each symbol gets a
// stable initials tile (same symbol -> same tint on every page), the way
// Groww/Tickertape render a logo column.
const TINTS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300",
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export default function SymbolAvatar({ ticker, size = "md" }: { ticker: string; size?: "sm" | "md" }) {
  const initials = ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const dims = size === "sm" ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-xs";
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-semibold ${dims} ${TINTS[hash(ticker) % TINTS.length]}`}
    >
      {initials}
    </span>
  );
}
