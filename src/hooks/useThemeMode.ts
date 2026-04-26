import { useEffect, useState } from "react";
import { initialThemeMode } from "../lib/appConstants";
import type { ThemeMode } from "../types/app";

export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", themeMode);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cfopTheme", themeMode);
    }
  }, [themeMode]);

  return { themeMode, setThemeMode };
}
