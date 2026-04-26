import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Alg } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import {
  casesForStage,
  joinAlgs,
  pickRandomCase,
  stages,
} from "./lib/trainer";
import {
  type CrossSide,
} from "./lib/cubeState";
import {
  simplifyAlgText,
  stripCubeRotations,
  type CubeOrientation,
} from "./lib/notation";
import { resolveStageCaseSetup } from "./lib/practiceEngine";
import { generateRandomScramble } from "./lib/scramble";
import {
  buildGuideStepsFromAlg,
  type GuideStepInternal,
} from "./lib/guide";
import {
  recordForCase,
  timingStatsLabel,
  type LearningProgressFilter,
} from "./lib/learning";
import {
  type GyroQuaternion,
} from "./lib/cubePattern";
import {
  stageMeta,
  type Stage,
} from "./data/cfopData";
import { AppHeader } from "./components/AppHeader";
import { HomePage } from "./components/HomePage";
import { DashboardPage } from "./components/DashboardPage";
import { LearnPage } from "./components/LearnPage";
import { TrainingPage } from "./components/TrainingPage";
import { useLearningData } from "./hooks/useLearningData";
import { useCaseCollections } from "./hooks/useCaseCollections";
import { useThemeMode } from "./hooks/useThemeMode";
import { useServiceWorker } from "./hooks/useServiceWorker";
import { useScreenWakeLock } from "./hooks/useScreenWakeLock";
import { initTwistyDebug } from "./lib/twisty";
import { useTrainingDerivedState } from "./hooks/useTrainingDerivedState";
import { useFreeSolveStats } from "./hooks/useFreeSolveStats";
import { useCrossCaseGenerator } from "./hooks/useCrossCaseGenerator";
import { advanceSetupGuideSteps } from "./lib/setupGuideTracker";
import { resetAttemptSessionState } from "./lib/trainingSession";
import { useSmartCubeBootstrap } from "./hooks/useSmartCubeBootstrap";
import { useTrainingControls } from "./hooks/useTrainingControls";
import { useCubeKpuzzle } from "./hooks/useCubeKpuzzle";
import { useSelectionSync } from "./hooks/useSelectionSync";
import { appendCompressedDisplayMove, appendLiveCountMoveTokens } from "./lib/moveDisplay";
import { useAttemptLifecycle } from "./hooks/useAttemptLifecycle";
import type {
  AppMode,
  AppView,
  CubeSkin,
  FreeSolveRecord,
  LearningSubsetFilter,
  LearnStage,
} from "./types/app";
import "./styles.css";

initTwistyDebug();

function App() {
  const { themeMode, setThemeMode } = useThemeMode();
  const [view, setView] = useState<AppView>("training");
  const [mode, setMode] = useState<AppMode>("trainer");
  const [stage, setStage] = useState<Stage>("cross");
  const [learnStage, setLearnStage] = useState<LearnStage>("oll");
  const [learnSubset, setLearnSubset] = useState<LearningSubsetFilter>("all");
  const [learnProgressFilter, setLearnProgressFilter] =
    useState<LearningProgressFilter>("all");
  const [learnSearch, setLearnSearch] = useState("");
  const {
    selectedLearnCaseId,
    setSelectedLearnCaseId,
    learningData,
    customAlgDraft,
    setCustomAlgDraft,
    customAlgLabelDraft,
    setCustomAlgLabelDraft,
    editingCustomAlgId,
    setEditingCustomAlgId,
    cycleLearningState,
    setLearningState,
    saveCustomAlgorithm,
    editCustomAlgorithm,
    removeCustomAlgorithm,
    setPrimaryAlgorithm,
    togglePracticeSelection,
    selectVisiblePracticeCases,
    selectOnlyLearningPracticeCases,
    clearPracticeSelection,
    logPracticeTiming,
  } = useLearningData();
  const [trainingSubsetFilter, setTrainingSubsetFilter] =
    useState<LearningSubsetFilter>("all");
  const [cubeOrientation, setCubeOrientation] =
    useState<CubeOrientation>("yellow-top");
  const [cubeSkin, setCubeSkin] = useState<CubeSkin>("classic");
  const [mirrorHintsEnabled, setMirrorHintsEnabled] = useState(true);
  const [smartCubeConnected, setSmartCubeConnected] = useState(false);
  const [smartCubeMoves, setSmartCubeMoves] = useState<string[]>([]);
  const smartCubeMovesRef = useRef<string[]>([]);
  const [smartCubeDisplayMoves, setSmartCubeDisplayMoves] = useState<string[]>([]);
  const [liveSessionMoveCount, setLiveSessionMoveCount] = useState(0);
  const [liveSessionStartMoves, setLiveSessionStartMoves] = useState<string[]>([]);
  const [trainingSessionId, setTrainingSessionId] = useState(0);
  const [virtualSessionStartAlg, setVirtualSessionStartAlg] = useState("");
  const [sessionAwareSetupAlg, setSessionAwareSetupAlg] = useState<string | null>(null);
  const [smartCubeStateBootstrapped, setSmartCubeStateBootstrapped] = useState(false);
  const [smartCubeGyro, setSmartCubeGyro] = useState<GyroQuaternion | null>(null);
  const [smartCubeGyroSession, setSmartCubeGyroSession] = useState(0);
  const [setupGuideSteps, setSetupGuideSteps] = useState<GuideStepInternal[]>([]);
  const [setupGuideComplete, setSetupGuideComplete] = useState(false);
  const [attemptStartPattern, setAttemptStartPattern] = useState<KPattern | null>(null);
  const [demoPlayerEnabled, setDemoPlayerEnabled] = useState(false);
  const [movesAfterSetup, setMovesAfterSetup] = useState(0);
  const [attemptFinished, setAttemptFinished] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStartAt, setTimerStartAt] = useState<number | null>(null);
  const [timerElapsedMs, setTimerElapsedMs] = useState(0);
  const [freeInspectionEnabled, setFreeInspectionEnabled] = useState(true);
  const [freeInspectionRunning, setFreeInspectionRunning] = useState(false);
  const [freeInspectionRemainingMs, setFreeInspectionRemainingMs] = useState<number | null>(null);
  const [freeScramble, setFreeScramble] = useState(generateRandomScramble);
  const [freeStepMarks, setFreeStepMarks] = useState<{
    crossMs: number | null;
    f2lMs: number | null;
    ollMs: number | null;
  }>({
    crossMs: null,
    f2lMs: null,
    ollMs: null,
  });
  const [freeLastSolves, setFreeLastSolves] = useState<FreeSolveRecord[]>([]);
  const freeSolveLoggedRef = useRef(false);
  const freeLastSplitMoveCountRef = useRef(0);
  const freeSplitSideRef = useRef<CrossSide | null>(null);
  const liveSessionCountTokensRef = useRef<string[]>([]);
  const cubeKpuzzle = useCubeKpuzzle();
  const setupGuideCompleteRef = useRef(false);
  const timerRunningRef = useRef(false);
  const timerStartAtRef = useRef<number | null>(null);
  const attemptFinishedRef = useRef(false);
  const autoAdvanceTimeoutRef = useRef<number | null>(null);
  const prevSetupGuideCompleteRef = useRef(false);
  const prevAttemptFinishedRef = useRef(false);
  const queuedPracticeCaseIdRef = useRef<string | null>(null);
  const [difficulty, setDifficulty] = useState<number | "all">(1);
  const [selectedCaseId, setSelectedCaseId] = useState("cross-1");
  const [showPanelSolution, setShowPanelSolution] = useState(false);
  const [crossRefresh, setCrossRefresh] = useState(0);
  const shouldKeepScreenAwake = smartCubeConnected || timerRunning;
  useServiceWorker();
  useScreenWakeLock(shouldKeepScreenAwake);

  useEffect(() => {
    if (cubeSkin === "f2l" && mirrorHintsEnabled) {
      setMirrorHintsEnabled(false);
    }
  }, [cubeSkin, mirrorHintsEnabled]);

  useEffect(() => {
    smartCubeMovesRef.current = smartCubeMoves;
  }, [smartCubeMoves]);

  useEffect(() => {
    timerRunningRef.current = timerRunning;
  }, [timerRunning]);

  useEffect(() => {
    timerStartAtRef.current = timerStartAt;
  }, [timerStartAt]);

  useEffect(() => {
    attemptFinishedRef.current = attemptFinished;
  }, [attemptFinished]);


  const isFreeMode = mode === "free";
  const {
    stageCases,
    availableDifficulties,
    filteredCases,
    activeCase,
    learnCases,
    selectedLearnCase,
    selectedLearnRecord,
    allLearnableCases,
    selectedPracticeCases,
    weakestPracticeCase,
    progressTotals,
    subsetOptions,
  } = useCaseCollections({
    stage,
    trainingSubsetFilter,
    difficulty,
    selectedCaseId,
    learnStage,
    learnSubset,
    learnProgressFilter,
    learnSearch,
    selectedLearnCaseId,
    learningData,
  });
  const isCross = stage === "cross";
  const crossDifficulty = difficulty === "all" ? 1 : difficulty;
  const crossGenerated = useCrossCaseGenerator(stage, crossDifficulty, selectedCaseId, crossRefresh);

  const activeCaseWithTrainingSetup = useMemo(() => {
    if (isCross) {
      const setup = crossGenerated.setup;
      const solution = crossGenerated.solution;
      return {
        ...activeCase,
        name: `${crossDifficulty} move cross`,
        recognition: crossGenerated.loading
          ? `Generating exact ${crossDifficulty}-move cross case...`
          : crossGenerated.error
            ? `Generator error: ${crossGenerated.error}`
            : `Generated state with exact optimal cross distance ${crossDifficulty}.`,
        baseSetup: setup,
        setup,
        solutions: [
          {
            alg: solution,
            label: "Optimal",
            source: "Cross distance search",
            notes: "One optimal HTM cross solution",
          },
        ],
      };
    }

    const normalizedCaseSetup = resolveStageCaseSetup(activeCase, cubeKpuzzle);
    const setup = joinAlgs([normalizedCaseSetup]);
    return { ...activeCase, setup };
  }, [activeCase, cubeKpuzzle, crossDifficulty, crossGenerated, isCross]);

  useEffect(() => {
    setShowPanelSolution(false);
  }, [activeCaseWithTrainingSetup.id, activeCaseWithTrainingSetup.setup]);

  const {
    solution,
    solutionForPattern,
    targetSetupAlgCanonical,
    expectedPostAttemptAlg,
    setupAlgForOrientation,
    solutionAlgForOrientation,
    smartCubeAlgCanonical,
    smartCubeAlgForOrientation,
    liveSessionStartAlgCanonical,
    targetSetupAlgForPlayback,
    solutionAlgForPlayback,
    smartCubeAlgForPlayback,
    setupGuideAlg,
    demoPlayerAvailable,
    isDemoViewer,
    isLiveViewer,
    viewerTitle,
    viewerSetup,
    viewerAlg,
    viewerContextMoves,
    setupGuideStepViews,
    currentLivePattern,
    solvedPattern,
    setupTargetPattern,
    solvedTargetPattern,
    requiredSolvedSlots,
    f2lRequiredSolvedSlots,
    f2lCaseUnsolvedSlots,
  } = useTrainingDerivedState({
    activeCaseWithTrainingSetup,
    isFreeMode,
    freeScramble,
    cubeOrientation,
    smartCubeMoves,
    liveSessionStartMoves,
    sessionAwareSetupAlg,
    smartCubeConnected,
    setupGuideComplete,
    demoPlayerEnabled,
    liveSessionMoveCount,
    setupGuideSteps,
    cubeKpuzzle,
    attemptStartPattern,
  });
  const {
    timerLabel,
    freeInspectionText,
    freeCurrentSplits,
    sessionBestMs,
    recentSolves,
    best5AverageMs,
    averageSplitMs,
  } = useFreeSolveStats({
    freeLastSolves,
    freeStepMarks,
    timerElapsedMs,
    isFreeMode,
    freeInspectionEnabled,
    freeInspectionRunning,
    freeInspectionRemainingMs,
  });
  const totalCaseCount = useMemo(
    () => stages.reduce((sum, item) => sum + casesForStage(item).length, 0),
    [],
  );

  const handleSmartCubeMove = useCallback((move: { raw: string; display: string }) => {
    setSmartCubeMoves((current) => [...current, move.raw].slice(-500));
    liveSessionCountTokensRef.current = appendLiveCountMoveTokens(liveSessionCountTokensRef.current, move.raw);
    setLiveSessionMoveCount(liveSessionCountTokensRef.current.length);
    setSmartCubeDisplayMoves((current) =>
      appendCompressedDisplayMove(current, move.display, 19),
    );
    if (setupGuideCompleteRef.current) {
      if (isFreeMode && freeInspectionRunning) {
        setFreeInspectionRunning(false);
        setFreeInspectionRemainingMs(0);
      }
      if (!timerRunningRef.current && !attemptFinishedRef.current) {
        const startedAt = performance.now();
        timerStartAtRef.current = startedAt;
        timerRunningRef.current = true;
        setTimerStartAt(startedAt);
        setTimerElapsedMs(0);
        setTimerRunning(true);
      }
      setMovesAfterSetup((current) => current + 1);
      return;
    }
    setSetupGuideSteps((current) =>
      advanceSetupGuideSteps(current, move.raw, cubeOrientation),
    );
  }, [cubeOrientation, freeInspectionRunning, isFreeMode]);

  const handleSmartCubeGyro = useCallback((quaternion: GyroQuaternion | null) => {
    setSmartCubeGyro(quaternion);
  }, []);

  const hardResetLiveCubeState = useCallback(() => {
    setSmartCubeMoves([]);
    smartCubeMovesRef.current = [];
    liveSessionCountTokensRef.current = [];
    setLiveSessionStartMoves([]);
    setVirtualSessionStartAlg("");
    setSmartCubeStateBootstrapped(false);
    resetAttemptSessionState({
      setLiveSessionMoveCount,
      setSmartCubeDisplayMoves,
      setSessionAwareSetupAlg,
      setTrainingSessionId,
      setSetupGuideComplete,
      setupGuideCompleteRef,
      prevSetupGuideCompleteRef,
      setAttemptStartPattern,
      setMovesAfterSetup,
      setAttemptFinished,
      attemptFinishedRef,
      setTimerRunning,
      timerRunningRef,
      setTimerStartAt,
      timerStartAtRef,
      setTimerElapsedMs,
      freeLastSplitMoveCountRef,
      setFreeInspectionRunning,
      setFreeInspectionRemainingMs,
      setFreeStepMarks,
      freeSolveLoggedRef,
    });
  }, []);

  const resetTrainingSessionFromCurrentState = useCallback(() => {
    const currentMoves = [...smartCubeMovesRef.current];
    setLiveSessionStartMoves(currentMoves);
    liveSessionCountTokensRef.current = [];
    setSmartCubeStateBootstrapped(currentMoves.length > 0);
    resetAttemptSessionState({
      setLiveSessionMoveCount,
      setSmartCubeDisplayMoves,
      setSessionAwareSetupAlg,
      setTrainingSessionId,
      setSetupGuideComplete,
      setupGuideCompleteRef,
      prevSetupGuideCompleteRef,
      setAttemptStartPattern,
      setMovesAfterSetup,
      setAttemptFinished,
      attemptFinishedRef,
      setTimerRunning,
      timerRunningRef,
      setTimerStartAt,
      timerStartAtRef,
      setTimerElapsedMs,
      freeLastSplitMoveCountRef,
      setFreeInspectionRunning,
      setFreeInspectionRemainingMs,
      setFreeStepMarks,
      freeSolveLoggedRef,
    });
  }, []);

  const resetAttemptSessionFromBootstrap = useCallback(() => {
    liveSessionCountTokensRef.current = [];
    resetAttemptSessionState({
      setLiveSessionMoveCount,
      setSmartCubeDisplayMoves,
      setSessionAwareSetupAlg,
      setTrainingSessionId,
      setSetupGuideComplete,
      setupGuideCompleteRef,
      prevSetupGuideCompleteRef,
      setAttemptStartPattern,
      setMovesAfterSetup,
      setAttemptFinished,
      attemptFinishedRef,
      setTimerRunning,
      timerRunningRef,
      setTimerStartAt,
      timerStartAtRef,
      setTimerElapsedMs,
      freeLastSplitMoveCountRef,
    });
  }, []);

  const applyBootstrappedMoves = useCallback((nextMoves: string[]) => {
    setSmartCubeMoves(nextMoves);
    smartCubeMovesRef.current = nextMoves;
    setLiveSessionStartMoves([...nextMoves]);
    resetAttemptSessionFromBootstrap();
  }, [resetAttemptSessionFromBootstrap]);

  const {
    handleSmartCubeFacelets,
    handleSmartCubeConnectionChange,
    handleSmartCubeResetLiveState,
  } = useSmartCubeBootstrap({
    cubeKpuzzle,
    smartCubeConnected,
    setSmartCubeConnected,
    setSmartCubeStateBootstrapped,
    setSmartCubeGyro,
    setSmartCubeGyroSession,
    onBootstrapMoves: applyBootstrappedMoves,
    onConnectedReset: resetTrainingSessionFromCurrentState,
    onDisconnectedReset: hardResetLiveCubeState,
  });

  const {
    handleStageChange,
    handleFreeMode,
    handleNewFreeScramble,
    handleDifficultyChange,
    handleCaseChange,
    practiceWeakestSelectedCase,
  } = useTrainingControls({
    mode,
    stage,
    difficulty,
    selectedCaseId,
    selectedPracticeCases,
    learningData,
    queuedPracticeCaseIdRef,
    resetTrainingSessionFromCurrentState,
    setView,
    setMode,
    setStage,
    setTrainingSubsetFilter,
    setDifficulty,
    setSelectedCaseId,
    setFreeScramble,
  });

  useEffect(() => {
    setTrainingSubsetFilter("all");
    const nextDifficulty = stage === "cross" ? 1 : "all";
    setDifficulty(nextDifficulty);
    const queuedPracticeCaseId = queuedPracticeCaseIdRef.current;
    const queuedCase = queuedPracticeCaseId
      ? casesForStage(stage).find((item) => item.id === queuedPracticeCaseId)
      : undefined;
    queuedPracticeCaseIdRef.current = null;
    const nextCase = queuedCase ?? casesForStage(stage).find((item) =>
      nextDifficulty === "all" ? true : item.difficulty === nextDifficulty,
    );
    setSelectedCaseId(nextCase?.id ?? casesForStage(stage)[0].id);
  }, [stage]);

  useSelectionSync({
    learnCases,
    selectedLearnCaseId,
    setSelectedLearnCaseId,
    selectedLearnCaseIdForDraftReset: selectedLearnCase.id,
    setCustomAlgDraft,
    setCustomAlgLabelDraft,
    setEditingCustomAlgId,
    filteredCases,
    selectedCaseId,
    stageCases,
    setSelectedCaseId,
  });

  useEffect(() => {
    if (isFreeMode) {
      setSessionAwareSetupAlg(null);
      return;
    }

    if (!smartCubeConnected) {
      const normalizeToSolved =
        virtualSessionStartAlg.trim().length > 0
          ? new Alg(virtualSessionStartAlg).invert().toString()
          : "";
      setSessionAwareSetupAlg(
        simplifyAlgText(joinAlgs([normalizeToSolved, targetSetupAlgCanonical])),
      );
      return;
    }
    let cancelled = false;

    const applyFallback = () => {
      const normalizeToSolved =
        liveSessionStartAlgCanonical.trim().length > 0
          ? new Alg(liveSessionStartAlgCanonical).invert().toString()
          : "";
      const canonical = simplifyAlgText(
        joinAlgs([normalizeToSolved, targetSetupAlgCanonical]),
      );
      setSessionAwareSetupAlg(
        canonical,
      );
    };

    if (!cubeKpuzzle) {
      applyFallback();
      return;
    }

    const sessionStartPattern = cubeKpuzzle.defaultPattern().applyAlg(liveSessionStartAlgCanonical);
    // Always normalize from the actual current cube state, then apply the
    // target setup. Stage shortcuts can drift from the intended exact case.
    void experimentalSolve3x3x3IgnoringCenters(sessionStartPattern)
      .then((solveToSolved) => {
        if (cancelled) {
          return;
        }
        const canonical = simplifyAlgText(
          joinAlgs([stripCubeRotations(solveToSolved.toString()), targetSetupAlgCanonical]),
        );
        setSessionAwareSetupAlg(
          canonical,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        applyFallback();
      });

    return () => {
      cancelled = true;
    };
  }, [
    cubeKpuzzle,
    isFreeMode,
    liveSessionStartAlgCanonical,
    targetSetupAlgCanonical,
    cubeOrientation,
    smartCubeConnected,
    trainingSessionId,
    virtualSessionStartAlg,
  ]);

  useEffect(() => {
    if (!smartCubeConnected) {
      setLiveSessionStartMoves([]);
      return;
    }
    setVirtualSessionStartAlg("");
  }, [smartCubeConnected]);

  useEffect(() => {
    const nextSteps = buildGuideStepsFromAlg(setupGuideAlg);
    setSetupGuideSteps(nextSteps);
    const complete = nextSteps.length === 0;
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
    prevSetupGuideCompleteRef.current = complete;
    setAttemptStartPattern(null);
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    attemptFinishedRef.current = false;
    setTimerRunning(false);
    timerRunningRef.current = false;
    setTimerStartAt(null);
    timerStartAtRef.current = null;
    setTimerElapsedMs(0);
    setDemoPlayerEnabled(false);
    freeLastSplitMoveCountRef.current = 0;
  }, [setupGuideAlg, smartCubeGyroSession, trainingSessionId]);

  useEffect(() => {
    const complete =
      setupGuideSteps.length > 0 &&
      setupGuideSteps.every((step) => step.doneAtoms >= step.atoms.length);
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
  }, [setupGuideSteps]);

  useAttemptLifecycle({
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
    activeCaseId: activeCaseWithTrainingSetup.id,
    activeCaseStage: activeCaseWithTrainingSetup.stage,
    freeStepMarks,
    freeSplitSideRef,
    freeSolveLoggedRef,
    freeLastSplitMoveCountRef,
    timerRunningRef,
    attemptFinishedRef,
    setupGuideCompleteRef,
    prevSetupGuideCompleteRef,
    prevAttemptFinishedRef,
    onSetSetupGuideComplete: setSetupGuideComplete,
    onSetAttemptStartPattern: setAttemptStartPattern,
    onSetDemoPlayerEnabled: setDemoPlayerEnabled,
    onSetLiveSessionMoveCount: (value) => {
      if (value === 0) {
        liveSessionCountTokensRef.current = [];
      }
      setLiveSessionMoveCount(value);
    },
    onSetMovesAfterSetup: setMovesAfterSetup,
    onSetAttemptFinished: setAttemptFinished,
    onSetTimerRunning: setTimerRunning,
    onSetTimerStartAt: setTimerStartAt,
    onSetTimerElapsedMs: setTimerElapsedMs,
    onSetFreeInspectionRunning: setFreeInspectionRunning,
    onSetFreeInspectionRemainingMs: setFreeInspectionRemainingMs,
    onSetFreeStepMarks: setFreeStepMarks,
    onSetFreeLastSolves: setFreeLastSolves,
    logPracticeTiming,
    demoPlayerAvailable,
  });

  useEffect(() => {
    if (view !== "training" || smartCubeConnected) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();

      if (timerRunning) {
        const totalMs = timerStartAt !== null ? performance.now() - timerStartAt : timerElapsedMs;
        if (!isFreeMode && activeCaseWithTrainingSetup.stage !== "cross") {
          logPracticeTiming(activeCaseWithTrainingSetup.id, totalMs);
        }
        setTimerRunning(false);
        timerRunningRef.current = false;
        setTimerElapsedMs(totalMs);
        setAttemptFinished(true);
        attemptFinishedRef.current = true;
        return;
      }

      setAttemptFinished(false);
      attemptFinishedRef.current = false;
      setTimerElapsedMs(0);
      const startedAt = performance.now();
      setTimerStartAt(startedAt);
      timerStartAtRef.current = startedAt;
      setTimerRunning(true);
      timerRunningRef.current = true;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeCaseWithTrainingSetup.id,
    activeCaseWithTrainingSetup.stage,
    isFreeMode,
    logPracticeTiming,
    smartCubeConnected,
    timerElapsedMs,
    timerRunning,
    timerStartAt,
    view,
  ]);

  function randomTrainingCase() {
    resetTrainingSessionFromCurrentState();
    if (stage === "cross") {
      setCrossRefresh((value) => value + 1);
      return;
    }
    const candidates = filteredCases.length > 0 ? filteredCases : stageCases;
    const next =
      candidates[Math.floor(Math.random() * candidates.length)] ??
      pickRandomCase(stage, difficulty === "all" ? undefined : difficulty);
    setSelectedCaseId(next.id);
  }

  const repeatCurrentTrainingCase = useCallback(() => {
    setVirtualSessionStartAlg(expectedPostAttemptAlg);
    resetTrainingSessionFromCurrentState();
    if (stage === "cross") {
      setCrossRefresh((value) => value + 1);
      return;
    }
  }, [expectedPostAttemptAlg, resetTrainingSessionFromCurrentState, stage]);

  useEffect(() => {
    if (autoAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
  }, [attemptFinished, isFreeMode, view]);

  if (view === "training") {
    return (
      <main className="app-shell-training">
        <AppHeader
          view={view}
          themeMode={themeMode}
          onViewChange={setView}
          onToggleTheme={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
        />

        <TrainingPage
          isFreeMode={isFreeMode}
          handleFreeMode={handleFreeMode}
          stages={stages}
          stage={stage}
          handleStageChange={handleStageChange}
          stageMeta={stageMeta}
          cubeOrientation={cubeOrientation}
          setCubeOrientation={setCubeOrientation}
          cubeSkin={cubeSkin}
          setCubeSkin={setCubeSkin}
          mirrorHintsEnabled={mirrorHintsEnabled}
          setMirrorHintsEnabled={setMirrorHintsEnabled}
          freeInspectionEnabled={freeInspectionEnabled}
          setFreeInspectionEnabled={setFreeInspectionEnabled}
          handleNewFreeScramble={handleNewFreeScramble}
          smartCubeConnected={smartCubeConnected}
          freeCurrentSplits={freeCurrentSplits}
          freeInspectionText={freeInspectionText}
          difficulty={difficulty}
          availableDifficulties={availableDifficulties}
          handleDifficultyChange={handleDifficultyChange}
          subsetOptions={subsetOptions}
          trainingSubsetFilter={trainingSubsetFilter}
          resetTrainingSessionFromCurrentState={resetTrainingSessionFromCurrentState}
          setTrainingSubsetFilter={setTrainingSubsetFilter}
          setDifficulty={setDifficulty}
          activeCase={activeCase}
          filteredCases={filteredCases}
          handleCaseChange={handleCaseChange}
          randomTrainingCase={randomTrainingCase}
          crossGenerated={crossGenerated}
          showPanelSolution={showPanelSolution}
          setShowPanelSolution={setShowPanelSolution}
          solutionAlgForOrientation={solutionAlgForOrientation}
          activeCaseWithTrainingSetup={activeCaseWithTrainingSetup}
          viewerTitle={viewerTitle}
          viewerSetup={viewerSetup}
          viewerAlg={viewerAlg}
          viewerContextMoves={viewerContextMoves}
          setupGuideAlg={setupGuideAlg}
          timerRunning={timerRunning}
          freeInspectionRunning={freeInspectionRunning}
          isDemoViewer={isDemoViewer}
          smartCubeDisplayMoves={smartCubeDisplayMoves}
          setupGuideStepViews={setupGuideStepViews}
          demoPlayerAvailable={demoPlayerAvailable}
          demoPlayerEnabled={demoPlayerEnabled}
          setDemoPlayerEnabled={setDemoPlayerEnabled}
          timerLabel={timerLabel}
          isLiveViewer={isLiveViewer}
          smartCubeGyro={smartCubeGyro}
          smartCubeGyroSession={smartCubeGyroSession}
          handleSmartCubeMove={handleSmartCubeMove}
          handleSmartCubeGyro={handleSmartCubeGyro}
          handleSmartCubeFacelets={handleSmartCubeFacelets}
          handleSmartCubeConnectionChange={handleSmartCubeConnectionChange}
          handleSmartCubeResetLiveState={handleSmartCubeResetLiveState}
          smartCubeStateBootstrapped={smartCubeStateBootstrapped}
          freeLastSolves={freeLastSolves}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <AppHeader
        view={view}
        themeMode={themeMode}
        onViewChange={setView}
        onToggleTheme={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
      />

      <section className="app-workspace">
        {view === "home" && (
          <HomePage
            totalCaseCount={totalCaseCount}
            smartCubeConnected={smartCubeConnected}
            sessionBestMs={sessionBestMs}
            onOpenTraining={() => setView("training")}
            onOpenDashboard={() => setView("dashboard")}
          />
        )}

        {view === "learn" && (
          <LearnPage
            progressTotals={progressTotals}
            learnStage={learnStage}
            learnSubset={learnSubset}
            learnProgressFilter={learnProgressFilter}
            learnSearch={learnSearch}
            selectedPracticeCount={selectedPracticeCases.length}
            weakestPracticeLabel={
              weakestPracticeCase
                ? `${weakestPracticeCase.name} (${timingStatsLabel(recordForCase(learningData, weakestPracticeCase.id))})`
                : "Select cases to start."
            }
            onLearnStageChange={(item) => {
              setLearnStage(item);
              setLearnSubset("all");
              setLearnSearch("");
            }}
            onLearnSubsetChange={setLearnSubset}
            onLearnProgressFilterChange={setLearnProgressFilter}
            onLearnSearchChange={setLearnSearch}
            onSelectVisiblePracticeCases={() => selectVisiblePracticeCases(learnCases)}
            onSelectOnlyLearningPracticeCases={() =>
              selectOnlyLearningPracticeCases(learnCases, allLearnableCases)
            }
            onClearPracticeSelection={() => clearPracticeSelection(allLearnableCases)}
            onPracticeWeakestSelectedCase={practiceWeakestSelectedCase}
            learnCases={learnCases}
            learningData={learningData}
            selectedLearnCase={selectedLearnCase}
            selectedLearnRecord={selectedLearnRecord}
            cubeOrientation={cubeOrientation}
            onTogglePracticeSelection={togglePracticeSelection}
            onCycleLearningState={cycleLearningState}
            onSelectLearnCaseId={setSelectedLearnCaseId}
            onSetLearningState={setLearningState}
            onSetPrimaryAlgorithm={setPrimaryAlgorithm}
            onEditCustomAlgorithm={editCustomAlgorithm}
            onRemoveCustomAlgorithm={removeCustomAlgorithm}
            editingCustomAlgId={editingCustomAlgId}
            customAlgLabelDraft={customAlgLabelDraft}
            customAlgDraft={customAlgDraft}
            onCustomAlgLabelDraftChange={setCustomAlgLabelDraft}
            onCustomAlgDraftChange={setCustomAlgDraft}
            onSaveCustomAlgorithm={() => saveCustomAlgorithm(selectedLearnCase.id)}
            onClearCustomAlgorithmDraft={() => {
              setEditingCustomAlgId(null);
              setCustomAlgDraft("");
              setCustomAlgLabelDraft("Custom");
            }}
          />
        )}

        {view === "dashboard" && (
          <DashboardPage
            sessionBestMs={sessionBestMs}
            best5AverageMs={best5AverageMs}
            recentSolves={recentSolves}
            smartCubeConnected={smartCubeConnected}
            averageSplitMs={averageSplitMs}
          />
        )}

      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
