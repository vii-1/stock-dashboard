"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/stocks/india", label: "India Stocks" },
  { href: "/stocks/us", label: "US Stocks" },
  { href: "/crypto", label: "Crypto" },
  { href: "/ipos", label: "IPOs" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/agent", label: "Paper Agent" },
  { href: "/brokers", label: "Broker Connect" },
];

// The sidebar (Sidebar.tsx) only renders at md+ (see its `hidden md:flex`).
// Below that, this is the whole nav - a slim top bar with a horizontally
// scrolling chip row, same links as the sidebar's flattened out.
export default function MobileNav() {
  const pathname = usePathname();

  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-teal-500 text-white">
            <Activity size={15} strokeWidth={2.5} />
          </span>
          Market Dashboard
        </span>
        <ThemeToggle />
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname?.startsWith(link.href + "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`chip whitespace-nowrap !py-1 text-xs ${active ? "chip-active" : ""}`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
