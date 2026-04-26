import { useMemo } from "react";
import { formatMs } from "../lib/time";
import type { FreeSolveRecord } from "../types/app";

type FreeStepMarks = {
  crossMs: number | null;
  f2lMs: number | null;
  ollMs: number | null;
};

type UseFreeSolveStatsParams = {
  freeLastSolves: FreeSolveRecord[];
  freeStepMarks: FreeStepMarks;
  timerElapsedMs: number;
  isFreeMode: boolean;
  freeInspectionEnabled: boolean;
  freeInspectionRunning: boolean;
  freeInspectionRemainingMs: number | null;
};

export function useFreeSolveStats(params: UseFreeSolveStatsParams) {
  const {
    freeLastSolves,
    freeStepMarks,
    timerElapsedMs,
    isFreeMode,
    freeInspectionEnabled,
    freeInspectionRunning,
    freeInspectionRemainingMs,
  } = params;

  const timerLabel = useMemo(() => {
    if (isFreeMode && freeInspectionEnabled && freeInspectionRunning) {
      return `I ${Math.max(0, Math.ceil((freeInspectionRemainingMs ?? 0) / 1000))}s`;
    }
    return formatMs(timerElapsedMs);
  }, [freeInspectionEnabled, freeInspectionRemainingMs, freeInspectionRunning, isFreeMode, timerElapsedMs]);

  const freeInspectionText = freeInspectionEnabled
    ? freeInspectionRunning
      ? `${Math.max(0, Math.ceil((freeInspectionRemainingMs ?? 0) / 1000))}s`
      : freeInspectionRemainingMs === 0
        ? "Done"
        : "Ready"
    : "Unlimited";

  const freeCurrentSplits = useMemo(() => {
    const cross = freeStepMarks.crossMs;
    const f2l =
      freeStepMarks.crossMs !== null && freeStepMarks.f2lMs !== null
        ? Math.max(0, freeStepMarks.f2lMs - freeStepMarks.crossMs)
        : null;
    const oll =
      freeStepMarks.f2lMs !== null && freeStepMarks.ollMs !== null
        ? Math.max(0, freeStepMarks.ollMs - freeStepMarks.f2lMs)
        : null;
    const pll =
      freeStepMarks.ollMs !== null
        ? Math.max(0, timerElapsedMs - freeStepMarks.ollMs)
        : null;
    return { cross, f2l, oll, pll, total: timerElapsedMs };
  }, [freeStepMarks.crossMs, freeStepMarks.f2lMs, freeStepMarks.ollMs, timerElapsedMs]);

  const sessionBestMs = useMemo(() => {
    if (freeLastSolves.length === 0) {
      return null;
    }
    return Math.min(...freeLastSolves.map((solve) => solve.totalMs));
  }, [freeLastSolves]);

  const recentSolves = useMemo(
    () => [...freeLastSolves].sort((a, b) => b.finishedAt - a.finishedAt),
    [freeLastSolves],
  );

  const best5Solves = useMemo(
    () => [...freeLastSolves].sort((a, b) => a.totalMs - b.totalMs).slice(0, 5),
    [freeLastSolves],
  );

  const best5AverageMs = useMemo(() => {
    if (best5Solves.length === 0) {
      return null;
    }
    const total = best5Solves.reduce((sum, solve) => sum + solve.totalMs, 0);
    return total / best5Solves.length;
  }, [best5Solves]);

  const averageSplitMs = useMemo(() => {
    if (freeLastSolves.length === 0) {
      return null;
    }
    const totals = freeLastSolves.reduce(
      (acc, solve) => {
        acc.cross += solve.crossMs;
        acc.f2l += solve.f2lMs;
        acc.oll += solve.ollMs;
        acc.pll += solve.pllMs;
        acc.total += solve.totalMs;
        return acc;
      },
      { cross: 0, f2l: 0, oll: 0, pll: 0, total: 0 },
    );
    return {
      cross: totals.cross / freeLastSolves.length,
      f2l: totals.f2l / freeLastSolves.length,
      oll: totals.oll / freeLastSolves.length,
      pll: totals.pll / freeLastSolves.length,
      total: totals.total / freeLastSolves.length,
    };
  }, [freeLastSolves]);

  return {
    timerLabel,
    freeInspectionText,
    freeCurrentSplits,
    sessionBestMs,
    recentSolves,
    best5AverageMs,
    averageSplitMs,
  };
}
