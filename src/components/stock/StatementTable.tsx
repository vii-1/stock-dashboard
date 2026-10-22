import type { RowUnit, StatementTable as Table } from "@/lib/fundamentals/analysis";

export function formatCell(value: number | null, unit: RowUnit, locale = "en-IN"): string {
  if (value == null || !Number.isFinite(value)) return "--";
  switch (unit) {
    case "money":
      return Math.round(value).toLocaleString(locale);
    case "pct":
      return `${Math.round(value)}%`;
    case "perShare":
      return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "x":
      return value.toFixed(2);
  }
}

// Tiny per-row trend (our addition to Screener's layout): one bar per
// period, scaled within the row, latest bar emphasised. Negative values
// hang below the midline so losses read as losses.
function TrendBars({ values }: { values: (number | null)[] }) {
  const nums = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (nums.length < 2) return null;
  const max = Math.max(...nums.map(Math.abs)) || 1;
  const hasNeg = nums.some((x) => x < 0);
  const h = 18;
  const w = 4;
  const gap = 2;
  const mid = hasNeg ? h / 2 : h;
  return (
    <svg width={values.length * (w + gap)} height={h} aria-hidden className="inline-block align-middle">
      {values.map((x, i) => {
        if (x == null || !Number.isFinite(x)) return null;
        const len = Math.max(1, (Math.abs(x) / max) * (hasNeg ? h / 2 : h));
        const last = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={x >= 0 ? mid - len : mid}
            width={w}
            height={len}
            rx={1}
            className={
              x < 0
                ? "fill-red-400/70"
                : last
                  ? "fill-blue-500 dark:fill-blue-400"
                  : "fill-slate-300 dark:fill-slate-600"
            }
          />
        );
      })}
    </svg>
  );
}

/**
 * Screener-style financial statement grid (₹ crores or $ millions, per table.locale): labels pinned on the left,
 * one column per period (oldest -> newest), subtotal rows in bold, the
 * latest period tinted. Scrolls horizontally on narrow screens with the
 * label column sticky.
 */
export default function StatementTable({ table, unitNote }: { table: Table; unitNote?: string }) {
  if (table.periods.length === 0 || table.rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500 dark:text-slate-400">No data available from the source for this section.</p>;
  }
  const lastIdx = table.periods.length - 1;

  return (
    <div>
      {unitNote && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{unitNote}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5 text-left dark:bg-slate-800">&nbsp;</th>
              {table.periods.map((p, i) => (
                <th
                  key={p}
                  className={`whitespace-nowrap px-4 py-2.5 text-right ${i === lastIdx ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : ""}`}
                >
                  {p}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right">Trend</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.label}
                className={`border-t border-slate-100 dark:border-slate-800 ${row.emphasis ? "font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"}`}
              >
                <th
                  scope="row"
                  title={row.hint}
                  className={`sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 text-left dark:bg-slate-900 ${row.emphasis ? "font-semibold" : "font-normal"} ${row.hint ? "cursor-help underline decoration-slate-300 decoration-dotted underline-offset-4 dark:decoration-slate-600" : ""}`}
                >
                  {row.label}
                </th>
                {row.values.map((x, i) => {
                  const prev = i > 0 ? row.values[i - 1] : null;
                  const change =
                    row.unit === "money" && x != null && prev != null && prev !== 0 ? ((x - prev) / Math.abs(prev)) * 100 : null;
                  return (
                    <td
                      key={i}
                      title={change != null ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs ${table.periods[i - 1]}` : undefined}
                      className={`whitespace-nowrap px-4 py-2 text-right ${i === lastIdx ? "bg-blue-50/60 dark:bg-blue-500/5" : ""} ${x != null && x < 0 ? "text-loss" : ""}`}
                    >
                      {formatCell(x, row.unit, table.locale)}
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right">
                  <TrendBars values={row.values} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
