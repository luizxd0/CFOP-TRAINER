import { useMemo } from "react";
import type { KPattern } from "cubing/kpuzzle";
import { F2L_CORNER_SLOTS, F2L_EDGE_SLOTS, collectNewlySolvedSlots, type OrbitSlot } from "../lib/cubeState";
import { guideStepView, type GuideStepInternal } from "../lib/guide";
import { remapAlgForOrientation, remapMoveForOrientation, simplifyAlgText, stripCubeRotations, toPlainAlgText, type CubeOrientation } from "../lib/notation";
import { joinAlgs } from "../lib/trainer";
import type { CubeKpuzzle } from "../lib/cubePattern";

type CaseForTraining = {
  name: string;
  setup: string;
  stage: string;
  solutions: Array<{ alg: string }>;
};

type UseTrainingDerivedStateParams = {
  activeCaseWithTrainingSetup: CaseForTraining;
  isFreeMode: boolean;
  freeScramble: string;
  cubeOrientation: CubeOrientation;
  smartCubeMoves: string[];
  liveSessionStartMoves: string[];
  sessionAwareSetupAlg: string | null;
  smartCubeConnected: boolean;
  setupGuideComplete: boolean;
  demoPlayerEnabled: boolean;
  liveSessionMoveCount: number;
  setupGuideSteps: GuideStepInternal[];
  cubeKpuzzle: CubeKpuzzle | null;
};

export function useTrainingDerivedState(params: UseTrainingDerivedStateParams) {
  const {
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
  } = params;

  // F2L case algs and kpuzzle/smart-cube state share standard WCA face labels (U = model up).
  // Yellow-top view is handled by CubeViewer's z2 frame + F2L stickering only; remapping U↔D
  // here would double-transform and mismatch the guide vs the physical cube.
  const orientationForAlgRemap: CubeOrientation =
    isFreeMode || activeCaseWithTrainingSetup.stage !== "f2l" ? cubeOrientation : "white-top";

  const solution = useMemo(
    () =>
      activeCaseWithTrainingSetup.stage === "f2l"
        ? toPlainAlgText(activeCaseWithTrainingSetup.solutions[0].alg)
        : activeCaseWithTrainingSetup.solutions[0].alg,
    [activeCaseWithTrainingSetup.solutions, activeCaseWithTrainingSetup.stage],
  );

  const solutionForPattern = useMemo(
    () => stripCubeRotations(solution),
    [solution],
  );

  const targetSetupAlgCanonical = isFreeMode ? freeScramble : activeCaseWithTrainingSetup.setup;

  const expectedPostAttemptAlg = useMemo(
    () => simplifyAlgText(joinAlgs([targetSetupAlgCanonical, solutionForPattern])),
    [solutionForPattern, targetSetupAlgCanonical],
  );

  const setupAlgForOrientation = useMemo(
    () => remapAlgForOrientation(activeCaseWithTrainingSetup.setup, orientationForAlgRemap),
    [activeCaseWithTrainingSetup.setup, orientationForAlgRemap],
  );

  const solutionAlgForOrientation = useMemo(
    () => remapAlgForOrientation(solution, orientationForAlgRemap),
    [solution, orientationForAlgRemap],
  );

  const smartCubeAlgCanonical = useMemo(
    () => smartCubeMoves.join(" "),
    [smartCubeMoves],
  );

  const smartCubeAlgForOrientation = useMemo(
    () => smartCubeMoves.map((move) => remapMoveForOrientation(move, orientationForAlgRemap)).join(" "),
    [orientationForAlgRemap, smartCubeMoves],
  );

  const liveSessionStartAlgCanonical = useMemo(
    () => liveSessionStartMoves.join(" "),
    [liveSessionStartMoves],
  );

  const targetSetupAlgForOrientation = isFreeMode ? freeScramble : setupAlgForOrientation;
  const targetSetupAlgForPlayback = targetSetupAlgForOrientation;
  const solutionAlgForPlayback = solutionAlgForOrientation;
  const smartCubeAlgForPlayback = smartCubeAlgForOrientation;

  const setupGuideAlg = useMemo(
    () => {
      const canonical = sessionAwareSetupAlg ?? targetSetupAlgCanonical;
      const raw = remapAlgForOrientation(canonical, orientationForAlgRemap);
      return simplifyAlgText(smartCubeConnected ? stripCubeRotations(raw) : raw);
    },
    [orientationForAlgRemap, sessionAwareSetupAlg, smartCubeConnected, targetSetupAlgCanonical],
  );

  const demoPlayerAvailable = smartCubeConnected && !isFreeMode && setupGuideComplete;
  const isDemoViewer = demoPlayerAvailable && demoPlayerEnabled;
  const isLiveViewer = smartCubeConnected && !isDemoViewer;
  const viewerTitle = isDemoViewer
    ? "Solution Demo"
    : isLiveViewer
    ? "Live Smart Cube"
    : isFreeMode
      ? "Free Practice"
      : activeCaseWithTrainingSetup.name;

  const viewerSetup = isDemoViewer
    ? smartCubeConnected
      ? smartCubeAlgForPlayback
      : targetSetupAlgForPlayback
    : isLiveViewer
    ? smartCubeAlgForPlayback
    : targetSetupAlgForPlayback;
  const viewerAlg = isDemoViewer || (!isLiveViewer && !isFreeMode) ? solutionAlgForPlayback : "";
  const viewerContextMoves = isLiveViewer ? liveSessionMoveCount : 0;

  const setupGuideStepViews = useMemo(
    () => {
      const full = setupGuideSteps.map(guideStepView);
      if (full.length <= 24) {
        return full;
      }
      const firstPending = full.findIndex((step) => step.state !== "done");
      if (firstPending < 0) {
        return full.slice(Math.max(0, full.length - 24));
      }
      const start = Math.max(0, firstPending - 8);
      return full.slice(start, start + 24);
    },
    [setupGuideSteps],
  );

  const targetSetupAlgForPattern = useMemo(
    () => stripCubeRotations(targetSetupAlgCanonical),
    [targetSetupAlgCanonical],
  );

  const currentLivePattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(smartCubeAlgCanonical) : null),
    [cubeKpuzzle, smartCubeAlgCanonical],
  );
  const solvedPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern() : null),
    [cubeKpuzzle],
  );
  const setupTargetPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(targetSetupAlgForPattern) : null),
    [cubeKpuzzle, targetSetupAlgForPattern],
  );
  const solvedTargetPattern = useMemo(
    () => {
      if (isFreeMode) {
        return solvedPattern;
      }
      return setupTargetPattern
        ? setupTargetPattern.applyAlg(solutionForPattern)
        : null;
    },
    [isFreeMode, setupTargetPattern, solutionForPattern, solvedPattern],
  );
  const requiredSolvedSlots = useMemo(() => {
    if (!setupTargetPattern || !solvedTargetPattern || !solvedPattern) {
      return [] as OrbitSlot[];
    }
    return collectNewlySolvedSlots(
      setupTargetPattern as unknown as { patternData: Record<string, any> },
      solvedTargetPattern as unknown as { patternData: Record<string, any> },
      solvedPattern as unknown as { patternData: Record<string, any> },
    );
  }, [setupTargetPattern, solvedTargetPattern, solvedPattern]);

  const f2lRequiredSolvedSlots = useMemo(
    () =>
      requiredSolvedSlots.filter(
        (slot) =>
          (slot.orbit === "EDGES" && F2L_EDGE_SLOTS.includes(slot.index as (typeof F2L_EDGE_SLOTS)[number])) ||
          (slot.orbit === "CORNERS" && F2L_CORNER_SLOTS.includes(slot.index as (typeof F2L_CORNER_SLOTS)[number])),
      ),
    [requiredSolvedSlots],
  );

  return {
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
  };
}
