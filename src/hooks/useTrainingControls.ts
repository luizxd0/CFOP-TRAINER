import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AlgorithmCase, Stage } from "../data/cfopData";
import { recordForCase, timingScore, type LearningData } from "../lib/learning";
import { generateRandomScramble } from "../lib/scramble";
import type { AppMode, AppView, LearningSubsetFilter } from "../types/app";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseTrainingControlsParams = {
  mode: AppMode;
  stage: Stage;
  difficulty: number | "all";
  selectedCaseId: string;
  selectedPracticeCases: AlgorithmCase[];
  learningData: LearningData;
  queuedPracticeCaseIdRef: MutableRefObject<string | null>;
  resetTrainingSessionFromCurrentState: () => void;
  setView: SetState<AppView>;
  setMode: SetState<AppMode>;
  setStage: SetState<Stage>;
  setTrainingSubsetFilter: SetState<LearningSubsetFilter>;
  setDifficulty: SetState<number | "all">;
  setSelectedCaseId: SetState<string>;
  setFreeScramble: SetState<string>;
};

export function useTrainingControls(params: UseTrainingControlsParams) {
  const {
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
  } = params;

  const handleStageChange = useCallback(
    (nextStage: Stage) => {
      const modeSwitch = mode !== "trainer";
      if (!modeSwitch && nextStage === stage) {
        return;
      }
      resetTrainingSessionFromCurrentState();
      setMode("trainer");
      setStage(nextStage);
    },
    [mode, resetTrainingSessionFromCurrentState, setMode, setStage, stage],
  );

  const handleFreeMode = useCallback(() => {
    if (mode === "free") {
      return;
    }
    resetTrainingSessionFromCurrentState();
    setMode("free");
    setFreeScramble(generateRandomScramble());
  }, [mode, resetTrainingSessionFromCurrentState, setFreeScramble, setMode]);

  const handleNewFreeScramble = useCallback(() => {
    setFreeScramble(generateRandomScramble());
  }, [setFreeScramble]);

  const handleDifficultyChange = useCallback(
    (nextDifficulty: number | "all") => {
      if (nextDifficulty === difficulty) {
        return;
      }
      resetTrainingSessionFromCurrentState();
      setDifficulty(nextDifficulty);
    },
    [difficulty, resetTrainingSessionFromCurrentState, setDifficulty],
  );

  const handleCaseChange = useCallback(
    (nextCaseId: string) => {
      if (nextCaseId === selectedCaseId) {
        return;
      }
      resetTrainingSessionFromCurrentState();
      setSelectedCaseId(nextCaseId);
    },
    [resetTrainingSessionFromCurrentState, selectedCaseId, setSelectedCaseId],
  );

  const applyPracticeCase = useCallback(
    (practiceCase: AlgorithmCase) => {
      resetTrainingSessionFromCurrentState();
      queuedPracticeCaseIdRef.current = practiceCase.stage === stage ? null : practiceCase.id;
      setView("training");
      setMode("trainer");
      setStage(practiceCase.stage);
      setTrainingSubsetFilter("all");
      setDifficulty("all");
      setSelectedCaseId(practiceCase.id);
    },
    [
      queuedPracticeCaseIdRef,
      resetTrainingSessionFromCurrentState,
      setDifficulty,
      setMode,
      setSelectedCaseId,
      setStage,
      setTrainingSubsetFilter,
      setView,
      stage,
    ],
  );

  const practiceWeakestSelectedCase = useCallback(() => {
    if (selectedPracticeCases.length === 0) {
      return;
    }
    const ranked = [...selectedPracticeCases].sort(
      (a, b) => timingScore(recordForCase(learningData, b.id)) - timingScore(recordForCase(learningData, a.id)),
    );
    const weakestBand = ranked.slice(0, Math.min(3, ranked.length));
    const next = weakestBand[Math.floor(Math.random() * weakestBand.length)] ?? ranked[0];
    applyPracticeCase(next);
  }, [applyPracticeCase, learningData, selectedPracticeCases]);

  return {
    handleStageChange,
    handleFreeMode,
    handleNewFreeScramble,
    handleDifficultyChange,
    handleCaseChange,
    practiceWeakestSelectedCase,
  };
}
