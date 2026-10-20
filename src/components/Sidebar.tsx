"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  LineChart,
  Bitcoin,
  Rocket,
  Briefcase,
  Bot,
  Link2,
  Activity,
} from "lucide-react";
import ThemeToggle from "./ThemeToggle";

const SECTIONS = [
  {
    label: "Overview",
    links: [{ href: "/dashboard", title: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Markets",
    links: [
      { href: "/stocks/india", title: "India Stocks", icon: TrendingUp },
      { href: "/stocks/us", title: "US Stocks", icon: LineChart },
      { href: "/crypto", title: "Crypto", icon: Bitcoin },
      { href: "/ipos", title: "IPOs", icon: Rocket },
    ],
  },
  {
    label: "Your money",
    links: [
      { href: "/portfolio", title: "Portfolio", icon: Briefcase },
      { href: "/agent", title: "Paper Agent", icon: Bot },
      { href: "/brokers", title: "Broker Connect", icon: Link2 },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60 md:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-teal-500 text-white shadow-sm">
          <Activity size={18} strokeWidth={2.5} />
        </span>
        <div className="leading-tight">
          <div className="font-semibold text-slate-900 dark:text-white">Market Dashboard</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">India · US · Crypto</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-6">
            <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.links.map((link) => {
                const active = pathname === link.href || pathname?.startsWith(link.href + "/");
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-blue-600 dark:bg-blue-400" />}
                    <Icon size={17} strokeWidth={active ? 2.25 : 2} />
                    {link.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3 dark:border-slate-800">
        <span className="text-xs text-slate-400 dark:text-slate-500">Appearance</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
