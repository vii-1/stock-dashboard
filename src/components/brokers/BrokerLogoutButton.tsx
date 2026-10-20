"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shared by every broker card - POSTs to that broker's logout route,
// which ends the session on the broker's side and clears it locally.
export default function BrokerLogoutButton({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(endpoint, { method: "POST" }).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
      className="chip disabled:opacity-50"
    >
      {busy ? "Logging out..." : "Log out"}
    </button>
  );
}
