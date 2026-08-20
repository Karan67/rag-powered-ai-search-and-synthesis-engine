"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Reads the theme that the inline script in layout.tsx already applied, so the
 * button label matches the page on first paint instead of flipping after mount.
 */
export const ThemeToggle: React.FC<{ collapsed?: boolean }> = ({ collapsed }) => {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private mode / storage disabled — the theme just will not persist.
    }
  };

  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-850 dark:hover:text-gray-100"
    >
      {isDark ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
      {!collapsed && <span>{isDark ? "Dark" : "Light"} mode</span>}
    </button>
  );
};
