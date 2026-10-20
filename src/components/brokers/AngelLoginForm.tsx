"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const input =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-slate-100/15";

/**
 * Daily Angel One login: client ID + MPIN + the current 6-digit code from
 * the authenticator app linked to SmartAPI. They go to Angel once via
 * /api/brokers/angel/login and are never stored - only the day's session
 * token is. The client ID is remembered in this browser for convenience.
 */
export default function AngelLoginForm() {
  const router = useRouter();
  const [clientCode, setClientCode] = useState("");
  const [mpin, setMpin] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill after mount (not in useState) so server and client HTML match.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("angelClientCode");
      if (saved) setClientCode(saved);
    } catch {
      // storage unavailable - user types it
    }
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brokers/angel/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientCode, mpin, totp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Login failed");
      try {
        localStorage.setItem("angelClientCode", clientCode.trim().toUpperCase());
      } catch {
        // storage unavailable - just won't prefill next time
      }
      setMpin("");
      setTotp("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setTotp(""); // codes rotate every 30s - make them type a fresh one
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={login} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          Client ID
          <input value={clientCode} onChange={(e) => setClientCode(e.target.value)} required autoComplete="username" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          MPIN
          <input
            type="password"
            inputMode="numeric"
            value={mpin}
            onChange={(e) => setMpin(e.target.value)}
            required
            pattern="\d{4,6}"
            autoComplete="current-password"
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          TOTP code
          <input
            inputMode="numeric"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            required
            pattern="\d{6}"
            autoComplete="one-time-code"
            placeholder="6 digits"
            className={input}
          />
        </label>
      </div>
      {error && <p className="text-sm text-loss">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="chip chip-active disabled:opacity-50">
          {busy ? "Logging in..." : "Log in to Angel One"}
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">MPIN and code are sent to Angel One only - never saved.</span>
      </div>
    </form>
  );
}
