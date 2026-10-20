"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartPoint, ChartRange } from "@/lib/fundamentals/yahooFundamentals";

const RANGES: ChartRange[] = ["1M", "6M", "1Y", "3Y", "5Y", "MAX"];
const W = 800;
const H = 260;
const PAD = { top: 12, right: 56, bottom: 24, left: 8 };
const VOL_H = 48; // volume band height at the bottom of the plot

function fmtDate(t: number, range: ChartRange) {
  const d = new Date(t * 1000);
  return d.toLocaleDateString("en-IN", range === "1M" || range === "6M" ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" });
}

/**
 * Screener-style price chart: range chips, price line with volume bars
 * underneath, crosshair + tooltip on hover. Plain SVG (no chart lib).
 * One series, so no legend - the card title names it; the axis on the
 * right carries price.
 */
export default function PriceChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<ChartRange>("1Y");
  const [data, setData] = useState<ChartPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/stocks/india/${encodeURIComponent(symbol)}/chart?range=${range}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load chart");
        if (!cancelled) setData(body);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load chart"));
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  const geom = useMemo(() => {
    if (!data || data.length < 2) return null;
    const closes = data.map((d) => d.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const lo = min - span * 0.05;
    const hi = max + span * 0.05;
    const maxVol = Math.max(...data.map((d) => d.volume)) || 1;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (data.length - 1)) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (plotH - VOL_H - 8);
    const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.close).toFixed(1)}`).join(" ");
    const area = `${line} L${x(data.length - 1).toFixed(1)},${(PAD.top + plotH - VOL_H - 8).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH - VOL_H - 8).toFixed(1)} Z`;
    const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4);
    const barW = Math.max(1, plotW / data.length - 1);
    return { x, y, line, area, ticks, maxVol, plotW, plotH, barW };
  }, [data]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!data || !geom || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / geom.plotW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  const first = data?.[0]?.close;
  const last = data?.[data.length - 1]?.close;
  const periodChange = first && last ? ((last - first) / first) * 100 : null;
  const hp = hover != null && data ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === range}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                r === range
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {r === "MAX" ? "Max" : r}
            </button>
          ))}
        </div>
        {periodChange != null && (
          <span className={`text-sm font-medium tabular-nums ${periodChange >= 0 ? "text-gain dark:text-gain-dark" : "text-loss"}`}>
            {periodChange >= 0 ? "▲" : "▼"} {Math.abs(periodChange).toFixed(2)}% over {range === "MAX" ? "all time" : range}
          </span>
        )}
      </div>

      <div className="relative">
        {error && <p className="py-16 text-center text-sm text-loss">{error}</p>}
        {!error && !geom && <div className="h-[260px] animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/60" />}
        {geom && data && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-[260px] w-full touch-none select-none"
            preserveAspectRatio="none"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`${symbol} price, ${range}`}
          >
            {geom.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(t)} y2={geom.y(t)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
                <text x={W - PAD.right + 6} y={geom.y(t) + 4} className="fill-slate-400 text-[11px]">
                  {Math.round(t).toLocaleString("en-IN")}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const h = (d.volume / geom.maxVol) * VOL_H;
              return (
                <rect
                  key={d.t}
                  x={geom.x(i) - geom.barW / 2}
                  y={PAD.top + geom.plotH - h}
                  width={geom.barW}
                  height={h}
                  className={hover === i ? "fill-blue-400/70" : "fill-slate-300/70 dark:fill-slate-700/80"}
                />
              );
            })}
            <path d={geom.area} className="fill-blue-500/10 dark:fill-blue-400/10" />
            <path d={geom.line} fill="none" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
              <text key={i} x={geom.x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-slate-400 text-[11px]">
                {fmtDate(data[i].t, range)}
              </text>
            ))}
            {hp && hover != null && (
              <g>
                <line x1={geom.x(hover)} x2={geom.x(hover)} y1={PAD.top} y2={PAD.top + geom.plotH} className="stroke-slate-400 dark:stroke-slate-500" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <circle cx={geom.x(hover)} cy={geom.y(hp.close)} r={4} className="fill-[#2a78d6] stroke-white dark:fill-[#3987e5] dark:stroke-slate-900" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>
        )}
        {hp && hover != null && geom && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900/95"
            style={{
              left: `${(geom.x(hover) / W) * 100}%`,
              transform: geom.x(hover) > W * 0.7 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <div className="text-slate-500 dark:text-slate-400">
              {new Date(hp.t * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900 dark:text-white">
              ₹{hp.close.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="tabular-nums text-slate-500 dark:text-slate-400">Vol {hp.volume.toLocaleString("en-IN")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
