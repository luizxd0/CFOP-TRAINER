import type { ThemeMode } from "../types/app";

export const CROSS_RECENT_VARIETY_WINDOW = 24;
export const CROSS_MAX_UNIQUE_ATTEMPTS = 14;
export const FREE_INSPECTION_MS = 15_000;

export function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("cfopTheme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return "dark";
}
