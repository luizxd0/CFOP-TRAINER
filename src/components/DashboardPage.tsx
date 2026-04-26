import React from "react";
import { CfopSplitBar } from "./CfopSplitBar";
import { formatMs } from "../lib/time";

type FreeSolveRecord = {
  totalMs: number;
  crossMs: number;
  f2lMs: number;
  ollMs: number;
  pllMs: number;
  finishedAt: number;
};

export function DashboardPage({
  sessionBestMs,
  best5AverageMs,
  recentSolves,
  smartCubeConnected,
  averageSplitMs,
}: {
  sessionBestMs: number | null;
  best5AverageMs: number | null;
  recentSolves: FreeSolveRecord[];
  smartCubeConnected: boolean;
  averageSplitMs: { cross: number; f2l: number; oll: number; pll: number; total: number } | null;
}) {
  return (
    <section className="dashboard-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Statistics</p>
          <h1>Session Dashboard</h1>
          <p className="hero-copy">
            Ranked best times, split averages, and latest solve history from your free-practice sessions.
          </p>
        </div>
      </header>

      <section className="dashboard-strip" aria-label="Session overview">
        <article className="metric-card">
          <span>Best Solve</span>
          <strong>{sessionBestMs === null ? "--" : formatMs(sessionBestMs)}</strong>
          <p>Fastest total solve in recent sessions.</p>
        </article>
        <article className="metric-card">
          <span>Best of 5 Avg</span>
          <strong>{best5AverageMs === null ? "--" : formatMs(best5AverageMs)}</strong>
          <p>Average of your top five solves.</p>
        </article>
        <article className="metric-card">
          <span>Recent Solves</span>
          <strong>{recentSolves.length}</strong>
          <p>Stored in this browser session.</p>
        </article>
        <article className="metric-card">
          <span>Cube Status</span>
          <strong>{smartCubeConnected ? "Connected" : "Offline"}</strong>
          <p>{smartCubeConnected ? "Live tracking enabled." : "Connect cube to track turns."}</p>
        </article>
      </section>

      <section className="dashboard-details">
        <article className="algorithm-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Splits</p>
              <h2>Average Split Times</h2>
            </div>
          </div>
          {averageSplitMs ? (
            <div className="alg-block compact-data-block">
              <CfopSplitBar
                cross={averageSplitMs.cross}
                f2l={averageSplitMs.f2l}
                oll={averageSplitMs.oll}
                pll={averageSplitMs.pll}
              />
              <div className="stat-grid compact-stat-grid">
                <p>
                  <span>Cross</span>
                  <strong>{formatMs(averageSplitMs.cross)}</strong>
                </p>
                <p>
                  <span>F2L</span>
                  <strong>{formatMs(averageSplitMs.f2l)}</strong>
                </p>
                <p>
                  <span>OLL</span>
                  <strong>{formatMs(averageSplitMs.oll)}</strong>
                </p>
                <p>
                  <span>PLL</span>
                  <strong>{formatMs(averageSplitMs.pll)}</strong>
                </p>
              </div>
              <p>Total average: {formatMs(averageSplitMs.total)}</p>
            </div>
          ) : (
            <div className="alg-block">
              <p>No solve data yet.</p>
            </div>
          )}
        </article>

        <article className="algorithm-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">History</p>
              <h2>Latest Solves</h2>
            </div>
          </div>
          <div className="alg-block">
            {recentSolves.length === 0 ? (
              <p>No solves yet.</p>
            ) : (
              <div className="solve-table-wrap">
                <table className="solve-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Total</th>
                      <th>Cross</th>
                      <th>F2L</th>
                      <th>OLL</th>
                      <th>PLL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSolves.map((solve, index) => (
                      <tr key={`${solve.finishedAt}-${index}`}>
                        <td>{index + 1}</td>
                        <td>{formatMs(solve.totalMs)}</td>
                        <td>{formatMs(solve.crossMs)}</td>
                        <td>{formatMs(solve.f2lMs)}</td>
                        <td>{formatMs(solve.ollMs)}</td>
                        <td>{formatMs(solve.pllMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </article>
      </section>
    </section>
  );
}
