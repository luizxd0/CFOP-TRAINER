import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { KPattern } from "cubing/kpuzzle";

type SetState<T> = Dispatch<SetStateAction<T>>;

type ResetAttemptSessionOptions = {
  setLiveSessionMoveCount: SetState<number>;
  setSmartCubeDisplayMoves: SetState<string[]>;
  setSessionAwareSetupAlg: SetState<string | null>;
  setTrainingSessionId: SetState<number>;
  setSetupGuideComplete: SetState<boolean>;
  setupGuideCompleteRef: MutableRefObject<boolean>;
  prevSetupGuideCompleteRef: MutableRefObject<boolean>;
  setAttemptStartPattern: SetState<KPattern | null>;
  setMovesAfterSetup: SetState<number>;
  setAttemptFinished: SetState<boolean>;
  attemptFinishedRef: MutableRefObject<boolean>;
  setTimerRunning: SetState<boolean>;
  timerRunningRef: MutableRefObject<boolean>;
  setTimerStartAt: SetState<number | null>;
  timerStartAtRef: MutableRefObject<number | null>;
  setTimerElapsedMs: SetState<number>;
  freeLastSplitMoveCountRef: MutableRefObject<number>;
  setFreeInspectionRunning?: SetState<boolean>;
  setFreeInspectionRemainingMs?: SetState<number | null>;
  setFreeStepMarks?: SetState<{ crossMs: number | null; f2lMs: number | null; ollMs: number | null }>;
  freeSolveLoggedRef?: MutableRefObject<boolean>;
};

export function resetAttemptSessionState(options: ResetAttemptSessionOptions) {
  options.setLiveSessionMoveCount(0);
  options.setSmartCubeDisplayMoves([]);
  options.setSessionAwareSetupAlg(null);
  options.setTrainingSessionId((current) => current + 1);
  options.setSetupGuideComplete(false);
  options.setupGuideCompleteRef.current = false;
  options.prevSetupGuideCompleteRef.current = false;
  options.setAttemptStartPattern(null);
  options.setMovesAfterSetup(0);
  options.setAttemptFinished(false);
  options.attemptFinishedRef.current = false;
  options.setTimerRunning(false);
  options.timerRunningRef.current = false;
  options.setTimerStartAt(null);
  options.timerStartAtRef.current = null;
  options.setTimerElapsedMs(0);
  options.freeLastSplitMoveCountRef.current = 0;

  if (options.setFreeInspectionRunning) {
    options.setFreeInspectionRunning(false);
  }
  if (options.setFreeInspectionRemainingMs) {
    options.setFreeInspectionRemainingMs(null);
  }
  if (options.setFreeStepMarks) {
    options.setFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
  }
  if (options.freeSolveLoggedRef) {
    options.freeSolveLoggedRef.current = false;
  }
}
