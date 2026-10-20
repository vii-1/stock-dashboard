"use client";

import { useEffect, useState } from "react";

// The actual dark/light class is set synchronously before paint by the
// inline script in layout.tsx (see ThemeScript) so there's no
// flash-of-wrong-theme. This component just reflects and toggles that
// state, reading the class the script already applied.
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage unavailable (private browsing, etc.) - theme just
      // won't persist across reloads, which is fine.
    }
    setIsDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {isDark === null ? " " : isDark ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}
