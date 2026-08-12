"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "gt-theme";

/**
 * Runs before paint, inline in <head>, so the correct palette is applied on the
 * very first frame. Without this the page renders light and then snaps to dark,
 * which is worse than not having dark mode at all.
 */
export const themeBootScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode — the class still applies for this session */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");

    // Follow the OS only while the user has expressed no preference of their own.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        /* fall through and follow the OS */
      }
      const next: Theme = e.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-2 text-muted transition-colors hover:bg-surface hover:text-ink"
      aria-label={theme ? `Switch to ${next} mode` : "Switch colour theme"}
      title={theme ? `Switch to ${next} mode` : "Switch colour theme"}
    >
      {/* Both icons render; CSS picks one, so there is no hydration mismatch. */}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden className="dark:hidden">
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <line
            key={deg}
            x1="12"
            y1="2.6"
            x2="12"
            y2="5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
      </svg>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden className="hidden dark:block">
        <path
          d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
