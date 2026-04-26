import { useMemo } from "react";
import { allCases, type Stage } from "../data/cfopData";
import { casesForStage } from "../lib/trainer";
import {
  learningStats,
  mergeCaseWithLearning,
  recordForCase,
  timingScore,
  type LearningData,
  type LearningProgressFilter,
} from "../lib/learning";
import type { LearningSubsetFilter, LearnStage } from "../types/app";

type UseCaseCollectionsParams = {
  stage: Stage;
  trainingSubsetFilter: LearningSubsetFilter;
  difficulty: number | "all";
  selectedCaseId: string;
  learnStage: LearnStage;
  learnSubset: LearningSubsetFilter;
  learnProgressFilter: LearningProgressFilter;
  learnSearch: string;
  selectedLearnCaseId: string;
  learningData: LearningData;
};

export function useCaseCollections(params: UseCaseCollectionsParams) {
  const {
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
  } = params;

  const stageCases = useMemo(
    () =>
      casesForStage(stage)
        .filter((item) =>
          trainingSubsetFilter === "all"
            ? true
            : item.subsets?.includes(trainingSubsetFilter),
        )
        .map((item) => mergeCaseWithLearning(item, recordForCase(learningData, item.id))),
    [learningData, stage, trainingSubsetFilter],
  );

  const availableDifficulties = useMemo(
    () => [...new Set(stageCases.map((item) => item.difficulty))].sort((a, b) => a - b),
    [stageCases],
  );

  const filteredCases = useMemo(
    () =>
      stageCases.filter((item) =>
        difficulty === "all" ? true : item.difficulty === difficulty,
      ),
    [difficulty, stageCases],
  );

  const activeCase =
    filteredCases.find((item) => item.id === selectedCaseId) ??
    filteredCases[0] ??
    stageCases[0];

  const learnCases = useMemo(
    () =>
      allCases
        .filter((item) => item.stage === learnStage)
        .filter((item) =>
          learnSubset === "all" ? true : item.subsets?.includes(learnSubset),
        )
        .filter((item) => {
          const state = recordForCase(learningData, item.id).state;
          return learnProgressFilter === "all" || state === learnProgressFilter;
        })
        .filter((item) => {
          const query = learnSearch.trim().toLowerCase();
          if (!query) return true;
          return [
            item.name,
            item.group,
            item.recognition,
            ...(item.recognitionTags ?? []),
            ...item.solutions.map((solutionItem) => solutionItem.alg),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);
        })
        .map((item) => mergeCaseWithLearning(item, recordForCase(learningData, item.id))),
    [learnProgressFilter, learnSearch, learnStage, learnSubset, learningData],
  );

  const selectedLearnCase = useMemo(
    () =>
      learnCases.find((item) => item.id === selectedLearnCaseId) ??
      learnCases[0] ??
      mergeCaseWithLearning(
        allCases.find((item) => item.stage === learnStage) ?? allCases[0]!,
        recordForCase(learningData, selectedLearnCaseId),
      ),
    [learnCases, learnStage, learningData, selectedLearnCaseId],
  );

  const selectedLearnRecord = recordForCase(learningData, selectedLearnCase.id);

  const allLearnableCases = useMemo(
    () => allCases.filter((item) => item.stage === "f2l" || item.stage === "oll" || item.stage === "pll"),
    [],
  );

  const selectedPracticeCases = useMemo(
    () =>
      allLearnableCases
        .filter((item) => recordForCase(learningData, item.id).selectedForPractice)
        .map((item) => mergeCaseWithLearning(item, recordForCase(learningData, item.id))),
    [allLearnableCases, learningData],
  );

  const weakestPracticeCase = useMemo(() => {
    if (selectedPracticeCases.length === 0) {
      return null;
    }
    const ranked = [...selectedPracticeCases].sort(
      (a, b) => timingScore(recordForCase(learningData, b.id)) - timingScore(recordForCase(learningData, a.id)),
    );
    const weakestBand = ranked.slice(0, Math.min(3, ranked.length));
    return weakestBand[Math.floor(Math.random() * weakestBand.length)] ?? ranked[0];
  }, [learningData, selectedPracticeCases]);

  const progressTotals = useMemo(
    () => learningStats(allLearnableCases, learningData),
    [allLearnableCases, learningData],
  );

  const subsetOptions = useMemo(() => {
    if (stage === "oll") {
      return [
        { id: "all" as const, label: "All OLL" },
        { id: "2look-oll" as const, label: "2-look" },
      ];
    }
    if (stage === "pll") {
      return [
        { id: "all" as const, label: "All PLL" },
        { id: "2look-pll" as const, label: "2-look" },
      ];
    }
    return [{ id: "all" as const, label: "All" }];
  }, [stage]);

  return {
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
  };
}
