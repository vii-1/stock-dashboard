import type { KiteMfHolding, KiteSip } from "@/lib/kite/client";
import { formatMoney, formatSigned } from "@/lib/format";
import SymbolAvatar from "@/components/ui/SymbolAvatar";

export interface KiteMfRow extends KiteMfHolding {
  invested: number;
  current: number;
  pnlComputed: number;
  sip: KiteSip | null;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Coin mutual funds with their SIP (if any) inline. Read-only like
// BrokerHoldingsTable. No suggestion badge: scoreHolding's indicators
// are built for traded prices, not once-a-day fund NAVs.
export default function KiteMfTable({ rows, orphanSips }: { rows: KiteMfRow[]; orphanSips: KiteSip[] }) {
  if (rows.length === 0 && orphanSips.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No mutual fund holdings or SIPs in this Kite account.</p>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="data-table [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th>Fund</th>
            <th className="text-right">Units</th>
            <th className="text-right">Avg NAV</th>
            <th className="text-right">NAV</th>
            <th className="text-right">Current value</th>
            <th className="text-right">P&amp;L</th>
            <th>SIP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.invested > 0 ? (r.pnlComputed / r.invested) * 100 : 0;
            return (
              <tr key={`${r.folio}:${r.tradingsymbol}`}>
                <td>
                  <div className="flex items-center gap-3">
                    <SymbolAvatar ticker={r.fund.replace(/^(HDFC|ICICI|SBI|AXIS|NIPPON|KOTAK|PARAG PARIKH|UTI|DSP|MIRAE)\s+/i, "")} size="sm" />
                    <div className="min-w-0">
                      <div className="max-w-[20rem] truncate font-medium text-slate-900 dark:text-slate-100" title={r.fund}>
                        {r.fund}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Folio {r.folio}</div>
                    </div>
                  </div>
                </td>
                <td className="text-right tabular-nums">{r.quantity.toFixed(3)}</td>
                <td className="text-right tabular-nums">{formatMoney(r.average_price, "INR")}</td>
                <td className="text-right tabular-nums">{formatMoney(r.last_price, "INR")}</td>
                <td className="text-right tabular-nums">
                  {formatMoney(r.current, "INR")}
                  <div className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(r.invested, "INR")} invested</div>
                </td>
                <td className={`text-right tabular-nums font-medium ${r.pnlComputed >= 0 ? "text-gain dark:text-gain-dark" : "text-loss"}`}>
                  {formatSigned(r.pnlComputed, "INR")}
                  <div className="text-xs">
                    {pct >= 0 ? "+" : ""}
                    {pct.toFixed(2)}%
                  </div>
                </td>
                <td>{r.sip ? <SipCell sip={r.sip} /> : <span className="text-xs text-slate-400 dark:text-slate-500">--</span>}</td>
              </tr>
            );
          })}
          {/* SIPs whose fund has no units yet (e.g. first instalment pending). */}
          {orphanSips.map((sip) => (
            <tr key={sip.sip_id}>
              <td>
                <div className="flex items-center gap-3">
                  <SymbolAvatar ticker={sip.fund} size="sm" />
                  <div className="max-w-[20rem] truncate font-medium" title={sip.fund}>
                    {sip.fund}
                  </div>
                </div>
              </td>
              <td colSpan={5} className="text-xs text-slate-500 dark:text-slate-400">
                No units yet
              </td>
              <td>
                <SipCell sip={sip} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SipCell({ sip }: { sip: KiteSip }) {
  const active = sip.status === "ACTIVE";
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="font-medium tabular-nums">{formatMoney(sip.instalment_amount, "INR")}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">/ {sip.frequency.replace(/ly$/, "")}</span>
        <span
          className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
            active
              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          {sip.status}
        </span>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {active && sip.next_instalment ? `Next ${shortDate(sip.next_instalment)} · ` : ""}
        {sip.completed_instalments} done
        {sip.instalments > 0 ? ` of ${sip.instalments}` : ""}
      </div>
    </div>
  );
}
