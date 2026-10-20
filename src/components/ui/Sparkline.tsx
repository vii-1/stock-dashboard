// Tiny inline trend line (Groww / Tickertape style). Server-rendered SVG,
// no chart library. Colour follows direction over the window shown, and
// a dotted baseline marks the first close so "up vs down" reads at a glance.
export default function Sparkline({
  values,
  width = 96,
  height = 32,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label?: string;
}) {
  if (values.length < 2) return <div style={{ width, height }} aria-hidden />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - pad * 2);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "#0ca30c" : "#d03b3b";
  const baseY = y(values[0]);
  const change = ((values[values.length - 1] - values[0]) / values[0]) * 100;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" className="shrink-0 overflow-visible">
      <title>{`${label ? label + ": " : ""}${change >= 0 ? "+" : ""}${change.toFixed(2)}% over ${values.length} sessions (low ${min.toFixed(2)}, high ${max.toFixed(2)})`}</title>
      <line
        x1={pad}
        x2={width - pad}
        y1={baseY}
        y2={baseY}
        className="stroke-slate-300 dark:stroke-slate-600"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.25} fill={stroke} />
    </svg>
  );
}
