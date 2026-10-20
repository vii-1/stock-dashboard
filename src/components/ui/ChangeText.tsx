import { formatPct } from "@/lib/format";

// Direction is carried by the arrow as well as colour, so it never relies
// on red/green alone. `onDark` is for always-dark surfaces (ticker tape,
// hero band) where the light-mode gain green would be too dim.
export default function ChangeText({
  pct,
  prefix,
  onDark = false,
  className = "",
}: {
  pct: number;
  prefix?: string;
  onDark?: boolean;
  className?: string;
}) {
  const up = pct >= 0;
  const tone = up ? (onDark ? "text-gain-dark" : "text-gain dark:text-gain-dark") : onDark ? "text-red-400" : "text-loss";
  const pctText = formatPct(Math.abs(pct)).replace("+", "");
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums font-medium ${tone} ${className}`}>
      <span aria-hidden className="text-[0.7em]">{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span>
      {prefix ? `${prefix} (${pctText})` : pctText}
    </span>
  );
}
