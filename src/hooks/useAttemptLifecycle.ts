import { useEffect } from "react";
import type { KPattern } from "cubing/kpuzzle";
import {
  areSlotsSolved,
  countSolvedF2LPairs,
  isCrossSolved,
  isCrossSolvedOnSide,
  isOllSolved,
  isSlotSolved,
  type OrbitSlot,
} from "../lib/cubeState";
import { FREE_INSPECTION_MS } from "../lib/appConstants";
import { detectFreeSplitProgress } from "../lib/freeSplits";

type PatternDataLike = { patternData: Record<string, any> };

type UseAttemptLifecycleParams = {
  isFreeMode: boolean;
  smartCubeConnected: boolean;
  setupGuideComplete: boolean;
  timerRunning: boolean;
  attemptFinished: boolean;
  movesAfterSetup: number;
  freeInspectionEnabled: boolean;
  freeInspectionRunning: boolean;
  freeInspectionRemainingMs: number | null;
  timerStartAt: number | null;
  timerElapsedMs: number;
  currentLivePattern: KPattern | null;
  setupTargetPattern: KPattern | null;
  attemptStartPattern: KPattern | null;
  solvedPattern: KPattern | null;
  solvedTargetPattern: KPattern | null;
  stage: string;
  requiredSolvedSlots: OrbitSlot[];
  f2lRequiredSolvedSlots: OrbitSlot[];
  f2lCaseUnsolvedSlots: OrbitSlot[];
  activeCaseId: string;
  activeCaseStage: string;
  freeStepMarks: {
    crossMs: number | null;
    f2lMs: number | null;
    ollMs: number | null;
  };
  freeSplitSideRef: React.MutableRefObject<"U" | "D" | null>;
  freeSolveLoggedRef: React.MutableRefObject<boolean>;
  freeLastSplitMoveCountRef: React.MutableRefObject<number>;
  timerRunningRef: React.MutableRefObject<boolean>;
  attemptFinishedRef: React.MutableRefObject<boolean>;
  setupGuideCompleteRef: React.MutableRefObject<boolean>;
  prevSetupGuideCompleteRef: React.MutableRefObject<boolean>;
  prevAttemptFinishedRef: React.MutableRefObject<boolean>;
  onSetSetupGuideComplete: (value: boolean) => void;
  onSetAttemptStartPattern: (value: KPattern | null) => void;
  onSetDemoPlayerEnabled: (value: boolean) => void;
  onSetLiveSessionMoveCount: (value: number) => void;
  onSetMovesAfterSetup: (value: number) => void;
  onSetAttemptFinished: (value: boolean) => void;
  onSetTimerRunning: (value: boolean) => void;
  onSetTimerStartAt: (value: number | null) => void;
  onSetTimerElapsedMs: (value: number) => void;
  onSetFreeInspectionRunning: (value: boolean) => void;
  onSetFreeInspectionRemainingMs: React.Dispatch<React.SetStateAction<number | null>>;
  onSetFreeStepMarks: (value: { crossMs: number | null; f2lMs: number | null; ollMs: number | null } | ((prev: { crossMs: number | null; f2lMs: number | null; ollMs: number | null }) => { crossMs: number | null; f2lMs: number | null; ollMs: number | null })) => void;
  onSetFreeLastSolves: (updater: (current: Array<{ totalMs: number; crossMs: number; f2lMs: number; ollMs: number; pllMs: number; finishedAt: number }>) => Array<{ totalMs: number; crossMs: number; f2lMs: number; ollMs: number; pllMs: number; finishedAt: number }>) => void;
  onLogStageSolve: (stage: string, totalMs: number) => void;
  logPracticeTiming: (caseId: string, totalMs: number) => void;
  demoPlayerAvailable: boolean;
};

export function useAttemptLifecycle(params: UseAttemptLifecycleParams) {
  const {
    isFreeMode,
    smartCubeConnected,
    setupGuideComplete,
    timerRunning,
    attemptFinished,
    movesAfterSetup,
    freeInspectionEnabled,
    freeInspectionRunning,
    freeInspectionRemainingMs,
    timerStartAt,
    timerElapsedMs,
    currentLivePattern,
    setupTargetPattern,
    attemptStartPattern,
    solvedPattern,
    solvedTargetPattern,
    stage,
    requiredSolvedSlots,
    f2lRequiredSolvedSlots,
    f2lCaseUnsolvedSlots,
    activeCaseId,
    activeCaseStage,
    freeStepMarks,
    freeSplitSideRef,
    freeSolveLoggedRef,
    freeLastSplitMoveCountRef,
    timerRunningRef,
    attemptFinishedRef,
    setupGuideCompleteRef,
    prevSetupGuideCompleteRef,
    prevAttemptFinishedRef,
    onSetSetupGuideComplete,
    onSetAttemptStartPattern,
    onSetDemoPlayerEnabled,
    onSetLiveSessionMoveCount,
    onSetMovesAfterSetup,
    onSetAttemptFinished,
    onSetTimerRunning,
    onSetTimerStartAt,
    onSetTimerElapsedMs,
    onSetFreeInspectionRunning,
    onSetFreeInspectionRemainingMs,
    onSetFreeStepMarks,
    onSetFreeLastSolves,
    onLogStageSolve,
    logPracticeTiming,
    demoPlayerAvailable,
  } = params;

  useEffect(() => {
    if (!setupGuideComplete && currentLivePattern && setupTargetPattern && currentLivePattern.isIdentical(setupTargetPattern)) {
      onSetSetupGuideComplete(true);
      setupGuideCompleteRef.current = true;
    }
  }, [setupGuideComplete, currentLivePattern, setupTargetPattern, onSetSetupGuideComplete, setupGuideCompleteRef]);

  useEffect(() => {
    if (!setupGuideComplete || movesAfterSetup > 0 || !currentLivePattern || attemptStartPattern) {
      return;
    }
    onSetAttemptStartPattern(currentLivePattern);
  }, [attemptStartPattern, currentLivePattern, movesAfterSetup, onSetAttemptStartPattern, setupGuideComplete]);

  useEffect(() => {
    if (!demoPlayerAvailable) {
      onSetDemoPlayerEnabled(false);
    }
  }, [demoPlayerAvailable, onSetDemoPlayerEnabled]);

  useEffect(() => {
    if (!smartCubeConnected || !setupGuideComplete || timerRunning || attemptFinished || movesAfterSetup === 0) {
      return;
    }
    const startedAt = performance.now();
    onSetTimerStartAt(startedAt);
    onSetTimerRunning(true);
  }, [attemptFinished, movesAfterSetup, onSetTimerRunning, onSetTimerStartAt, setupGuideComplete, smartCubeConnected, timerRunning]);

  useEffect(() => {
    const wasComplete = prevSetupGuideCompleteRef.current;
    if (!wasComplete && setupGuideComplete) {
      onSetLiveSessionMoveCount(0);
      onSetMovesAfterSetup(0);
      onSetAttemptFinished(false);
      onSetFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
      freeSolveLoggedRef.current = false;
      if (isFreeMode) {
        if (freeInspectionEnabled) {
          onSetFreeInspectionRemainingMs(FREE_INSPECTION_MS);
          onSetFreeInspectionRunning(true);
        } else {
          onSetFreeInspectionRemainingMs(null);
          onSetFreeInspectionRunning(false);
        }
      }
    }
    if (!setupGuideComplete) {
      onSetFreeInspectionRunning(false);
      onSetFreeInspectionRemainingMs(null);
    }
    prevSetupGuideCompleteRef.current = setupGuideComplete;
  }, [
    freeInspectionEnabled,
    isFreeMode,
    onSetAttemptFinished,
    onSetFreeInspectionRemainingMs,
    onSetFreeInspectionRunning,
    onSetFreeStepMarks,
    onSetLiveSessionMoveCount,
    onSetMovesAfterSetup,
    prevSetupGuideCompleteRef,
    setupGuideComplete,
    freeSolveLoggedRef,
  ]);

  useEffect(() => {
    if (!isFreeMode || !freeInspectionRunning || freeInspectionRemainingMs === null) {
      return;
    }
    const interval = window.setInterval(() => {
      onSetFreeInspectionRemainingMs((current) => {
        if (current === null) return null;
        const next = current - 20;
        if (next <= 0) {
          onSetFreeInspectionRunning(false);
          return 0;
        }
        return next;
      });
    }, 20);
    return () => window.clearInterval(interval);
  }, [freeInspectionRemainingMs, freeInspectionRunning, isFreeMode, onSetFreeInspectionRemainingMs, onSetFreeInspectionRunning]);

  useEffect(() => {
    if (!isFreeMode || !setupGuideComplete || movesAfterSetup > 0 || timerRunning || attemptFinished) {
      return;
    }
    if (!freeInspectionEnabled) {
      onSetFreeInspectionRunning(false);
      onSetFreeInspectionRemainingMs(null);
      return;
    }
    if (!freeInspectionRunning) {
      onSetFreeInspectionRemainingMs(FREE_INSPECTION_MS);
      onSetFreeInspectionRunning(true);
    }
  }, [
    attemptFinished,
    freeInspectionEnabled,
    freeInspectionRunning,
    isFreeMode,
    movesAfterSetup,
    onSetFreeInspectionRemainingMs,
    onSetFreeInspectionRunning,
    setupGuideComplete,
    timerRunning,
  ]);

  useEffect(() => {
    prevAttemptFinishedRef.current = attemptFinished;
  }, [attemptFinished, prevAttemptFinishedRef]);

  useEffect(() => {
    if (freeStepMarks.crossMs === null && freeStepMarks.f2lMs === null && freeStepMarks.ollMs === null && movesAfterSetup === 0) {
      freeSplitSideRef.current = null;
    }
  }, [freeStepMarks.crossMs, freeStepMarks.f2lMs, freeStepMarks.ollMs, movesAfterSetup, freeSplitSideRef]);

  useEffect(() => {
    if (!timerRunning || timerStartAt === null) return;
    const interval = window.setInterval(() => {
      onSetTimerElapsedMs(performance.now() - timerStartAt);
    }, 20);
    return () => window.clearInterval(interval);
  }, [onSetTimerElapsedMs, timerRunning, timerStartAt]);

  useEffect(() => {
    if (!isFreeMode || !timerRunning || !currentLivePattern || !solvedPattern || timerStartAt === null) return;
    if (freeLastSplitMoveCountRef.current === movesAfterSetup) return;
    const elapsed = performance.now() - timerStartAt;
    onSetFreeStepMarks((current) => {
      const next = { ...current };
      let changed = false;
      const patternLike = currentLivePattern as unknown as PatternDataLike;
      const solvedLike = solvedPattern as unknown as PatternDataLike;
      const progress = detectFreeSplitProgress(patternLike, solvedLike, freeSplitSideRef.current, "U");
      if (freeSplitSideRef.current === null && progress.cross) {
        freeSplitSideRef.current = progress.side;
      }
      if (next.crossMs === null && progress.cross) { next.crossMs = elapsed; changed = true; }
      if (next.f2lMs === null && progress.f2l) { next.f2lMs = elapsed; changed = true; }
      if (next.ollMs === null && progress.oll) { next.ollMs = elapsed; changed = true; }
      if (changed) {
        freeLastSplitMoveCountRef.current = movesAfterSetup;
      }
      return changed ? next : current;
    });
  }, [currentLivePattern, isFreeMode, movesAfterSetup, onSetFreeStepMarks, solvedPattern, timerRunning, timerStartAt, freeLastSplitMoveCountRef, freeSplitSideRef]);

  useEffect(() => {
    if (!timerRunning || !currentLivePattern || !smartCubeConnected) return;
    const exactMatch = solvedTargetPattern ? currentLivePattern.isIdentical(solvedTargetPattern) : false;
    const freeModeGoalMatch = isFreeMode && solvedPattern && currentLivePattern.isIdentical(solvedPattern);
    const crossGoalMatch = !isFreeMode && stage === "cross" && solvedPattern && (
      isCrossSolved(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike) ||
      isCrossSolvedOnSide(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike, "U")
    );
    const crossTargetGoalMatch = !isFreeMode && stage === "cross" && solvedTargetPattern && (
      isCrossSolved(currentLivePattern as unknown as PatternDataLike, solvedTargetPattern as unknown as PatternDataLike) ||
      isCrossSolvedOnSide(currentLivePattern as unknown as PatternDataLike, solvedTargetPattern as unknown as PatternDataLike, "U")
    );
    const f2lGoalMatch = !isFreeMode && stage === "f2l" && solvedPattern && (
      ((attemptStartPattern || setupTargetPattern) && countSolvedF2LPairs(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike) > countSolvedF2LPairs((attemptStartPattern ?? setupTargetPattern) as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike)) ||
      (f2lRequiredSolvedSlots.length > 0 && areSlotsSolved(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike, f2lRequiredSolvedSlots)) ||
      (f2lCaseUnsolvedSlots.length > 0 &&
        f2lCaseUnsolvedSlots.some((slot) => slot.orbit === "EDGES" && isSlotSolved(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike, slot.orbit, slot.index)) &&
        f2lCaseUnsolvedSlots.some((slot) => slot.orbit === "CORNERS" && isSlotSolved(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike, slot.orbit, slot.index)))
    );
    const ollGoalMatch = !isFreeMode && stage === "oll" && solvedPattern && isOllSolved(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike);
    const pllGoalMatch = !isFreeMode && stage === "pll" && solvedPattern && currentLivePattern.isIdentical(solvedPattern);
    const stageGoalMatch = !isFreeMode && stage !== "cross" && stage !== "f2l" && requiredSolvedSlots.length > 0 && solvedPattern && areSlotsSolved(currentLivePattern as unknown as PatternDataLike, solvedPattern as unknown as PatternDataLike, requiredSolvedSlots);

    if (freeModeGoalMatch || (!isFreeMode && (exactMatch || crossGoalMatch || crossTargetGoalMatch || f2lGoalMatch || ollGoalMatch || pllGoalMatch || stageGoalMatch))) {
      const totalMs = timerStartAt !== null ? performance.now() - timerStartAt : timerElapsedMs;
      if (!isFreeMode && activeCaseStage !== "cross") {
        logPracticeTiming(activeCaseId, totalMs);
      }
      if (!isFreeMode) {
        onLogStageSolve(stage, totalMs);
      }
      if (isFreeMode && !freeSolveLoggedRef.current) {
        const crossAt = freeStepMarks.crossMs ?? totalMs;
        const f2lAt = freeStepMarks.f2lMs ?? totalMs;
        const ollAt = freeStepMarks.ollMs ?? totalMs;
        onSetFreeLastSolves((current) => [
          { totalMs, crossMs: crossAt, f2lMs: Math.max(0, f2lAt - crossAt), ollMs: Math.max(0, ollAt - f2lAt), pllMs: Math.max(0, totalMs - ollAt), finishedAt: Date.now() },
          ...current,
        ].slice(0, 5));
        freeSolveLoggedRef.current = true;
      }
      onSetTimerRunning(false);
      timerRunningRef.current = false;
      onSetAttemptFinished(true);
      attemptFinishedRef.current = true;
      onSetTimerElapsedMs(totalMs);
    }
  }, [
    freeStepMarks.crossMs,
    freeStepMarks.f2lMs,
    freeStepMarks.ollMs,
    isFreeMode,
    smartCubeConnected,
    timerRunning,
    currentLivePattern,
    solvedTargetPattern,
    stage,
    timerElapsedMs,
    timerStartAt,
    requiredSolvedSlots,
    f2lRequiredSolvedSlots,
    f2lCaseUnsolvedSlots,
    attemptStartPattern,
    setupTargetPattern,
    solvedPattern,
    activeCaseId,
    activeCaseStage,
    onLogStageSolve,
    logPracticeTiming,
    onSetFreeLastSolves,
    onSetAttemptFinished,
    onSetTimerElapsedMs,
    onSetTimerRunning,
    freeSolveLoggedRef,
    timerRunningRef,
    attemptFinishedRef,
  ]);
}
