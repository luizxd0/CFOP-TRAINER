import React from "react";
import { BarChart3, BookOpen, House, Moon, Sun } from "lucide-react";

type AppView = "home" | "training" | "dashboard" | "learn";
type ThemeMode = "light" | "dark";

export function AppHeader({
  view,
  themeMode,
  onViewChange,
  onToggleTheme,
}: {
  view: AppView;
  themeMode: ThemeMode;
  onViewChange: (view: AppView) => void;
  onToggleTheme: () => void;
}) {
  return (
    <header className="training-topbar">
      <a className="brand-lockup" href="/" aria-label="CFOP Trainer home">
        <span className="brand-mark">c</span>
        <span>
          <strong>cfop trainer</strong>
          <em>Level up your cubing</em>
        </span>
      </a>
      <nav className="app-nav app-nav-horizontal" aria-label="App pages">
        <button
          className={view === "home" ? "active" : ""}
          onClick={() => onViewChange("home")}
        >
          <House size={16} />
          Home
        </button>
        <button
          className={view === "training" ? "active" : ""}
          onClick={() => onViewChange("training")}
        >
          <BookOpen size={16} />
          Training
        </button>
        <button
          className={view === "learn" ? "active" : ""}
          onClick={() => onViewChange("learn")}
        >
          <BookOpen size={16} />
          Learn
        </button>
        <button
          className={view === "dashboard" ? "active" : ""}
          onClick={() => onViewChange("dashboard")}
        >
          <BarChart3 size={16} />
          Dashboard
        </button>
      </nav>
      <button
        className="theme-toggle"
        onClick={onToggleTheme}
        title={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}
