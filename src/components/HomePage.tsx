import React from "react";
import { formatMs } from "../lib/time";

export function HomePage({
  totalCaseCount,
  smartCubeConnected,
  sessionBestMs,
  onOpenTraining,
  onOpenDashboard,
}: {
  totalCaseCount: number;
  smartCubeConnected: boolean;
  sessionBestMs: number | null;
  onOpenTraining: () => void;
  onOpenDashboard: () => void;
}) {
  return (
    <section className="home-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Smart Cube App</p>
          <h1>Connect & train your CFOP solves.</h1>
          <p className="hero-copy">
            Guided setup drills, live cube tracking, session timing, and algorithm practice in one focused workspace.
          </p>
        </div>
      </header>
      <section className="home-hero-panel">
        <div>
          <p className="eyebrow">Playground Ready</p>
          <h2>Train CFOP with Smart Cube tracking in one focused workspace.</h2>
          <p>
            Use dedicated setup drills or free-play solves with inspection, split timing, and live cube sync.
          </p>
          <div className="action-row">
            <button className="primary-button" onClick={onOpenTraining}>
              Open training
            </button>
            <button className="ghost-button" onClick={onOpenDashboard}>
              View dashboard
            </button>
          </div>
        </div>
        <div className="home-hero-stats">
          <p>
            <span>Case Library</span>
            <strong>{totalCaseCount}</strong>
          </p>
          <p>
            <span>Smart Cube</span>
            <strong>{smartCubeConnected ? "Connected" : "Offline"}</strong>
          </p>
          <p>
            <span>Best Solve</span>
            <strong>{sessionBestMs === null ? "--" : formatMs(sessionBestMs)}</strong>
          </p>
        </div>
      </section>
      <section className="home-grid">
        <article className="metric-card">
          <span>Start Training</span>
          <strong>Live Practice</strong>
          <p>Open dedicated training layout with smart-cube setup guide and timer.</p>
          <div className="action-row">
            <button className="primary-button" onClick={onOpenTraining}>
              Open training
            </button>
          </div>
        </article>
        <article className="metric-card">
          <span>Detailed Stats</span>
          <strong>Dashboard</strong>
          <p>Review best-of-5 ranking, average splits, and your most recent solves.</p>
          <div className="action-row">
            <button className="ghost-button" onClick={onOpenDashboard}>
              Open dashboard
            </button>
          </div>
        </article>
        <article className="metric-card">
          <span>Case Library</span>
          <strong>{totalCaseCount}</strong>
          <p>Cross, F2L, OLL and PLL drills ready for deliberate practice.</p>
        </article>
        <article className="metric-card">
          <span>Smart Cube</span>
          <strong>{smartCubeConnected ? "Connected" : "Offline"}</strong>
          <p>{sessionBestMs === null ? "Pair to track solves." : `Best solve ${formatMs(sessionBestMs)}`}</p>
        </article>
      </section>
    </section>
  );
}
