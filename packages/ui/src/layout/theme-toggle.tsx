"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils.js";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "heyloo-theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];
const ICON: Record<ThemePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };
const LABEL: Record<ThemePreference, string> = {
  system: "Match system theme",
  light: "Light theme",
  dark: "Dark theme",
};

function apply(pref: ThemePreference) {
  if (pref === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pref);
}

/**
 * Three-way theme toggle (system → light → dark), no external dependency
 * (apps/web/src/app/[locale]/layout.tsx has the matching no-flash inline
 * bootstrap script — see docs/DESIGN_SYSTEM.md §Dark mode). Reads/writes
 * `localStorage["heyloo-theme"]`; a value read back from a private window
 * or blocked storage is treated as "system" (wrapped in try/catch).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePreference>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setPref(stored);
    } catch {
      // localStorage unavailable — stay on "system".
    }
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length] as ThemePreference;
    setPref(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — the in-memory toggle above still works for this tab.
    }
  }

  const Icon = ICON[pref];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={mounted ? LABEL[pref] : LABEL.system}
      title={mounted ? LABEL[pref] : LABEL.system}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
