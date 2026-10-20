import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import TickerTape from "@/components/TickerTape";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "My Market Dashboard",
  description: "Personal portfolio + market movers dashboard (India, US, Crypto)",
};

// Runs before paint (blocking, in <head>) so the page never flashes the
// wrong theme: reads the saved preference, falls back to OS preference,
// and applies the `dark` class immediately. Kept as a plain string
// (not a JSX event handler) since this needs to run before React
// hydrates anything.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-slate-50 font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="min-w-0 flex-1">
            {/* Streams in after the page shell - a slow Yahoo call never
                blocks navigation. Empty placeholder keeps layout stable. */}
            <Suspense fallback={<div className="h-[33px] border-b border-slate-800 bg-slate-950" />}>
              <TickerTape />
            </Suspense>
            <MobileNav />
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
