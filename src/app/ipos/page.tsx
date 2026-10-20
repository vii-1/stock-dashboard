import IpoTabs from "@/components/IpoTabs";
import {
  getUpcomingIndiaIpos,
  getUpcomingUsIpos,
  isIndiaIpoConfigured,
  isUsIpoConfigured,
} from "@/lib/providers/ipoProvider";
import type { UpcomingIpo } from "@/lib/providers/ipoProvider";

async function loadTab(key: string, label: string, configured: boolean, fetcher: () => Promise<UpcomingIpo[]>) {
  if (!configured) {
    return {
      key,
      label,
      ipos: [] as UpcomingIpo[],
      message:
        key === "in"
          ? "Add IPOALERTS_API_KEY to .env (free signup at ipoalerts.in) to see India IPOs here."
          : "Add FINNHUB_API_KEY to .env (free signup at finnhub.io) to see US IPOs here.",
    };
  }

  try {
    const ipos = await fetcher();
    return { key, label, ipos, message: null };
  } catch (err) {
    console.error(`Failed to fetch ${label} IPOs`, err);
    return { key, label, ipos: [], message: "Couldn't fetch IPO data right now. Try again shortly." };
  }
}

export default async function IposPage() {
  const [india, us] = await Promise.all([
    loadTab("in", "India (open)", isIndiaIpoConfigured(), getUpcomingIndiaIpos),
    loadTab("us", "US (next 60 days)", isUsIpoConfigured(), getUpcomingUsIpos),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Upcoming IPOs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          India shows IPOs currently open for bidding, not the full upcoming calendar -
          ipoalerts.in's free plan only allows `status=open`, not `status=upcoming`.
        </p>
      </div>
      <IpoTabs tabs={[india, us]} />
    </div>
  );
}
