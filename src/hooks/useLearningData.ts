import { useCallback, useEffect, useState } from "react";
import type { AlgorithmCase } from "../data/cfopData";
import {
  initialLearningData,
  LEARNING_STORAGE_KEY,
  nextLearningState,
  recordForCase,
  type CustomAlgorithm,
  type LearningCaseRecord,
  type LearningData,
  type LearningProgressState,
} from "../lib/learning";

export function useLearningData() {
  const [selectedLearnCaseId, setSelectedLearnCaseId] = useState("oll-01");
  const [learningData, setLearningData] = useState<LearningData>(initialLearningData);
  const [customAlgDraft, setCustomAlgDraft] = useState("");
  const [customAlgLabelDraft, setCustomAlgLabelDraft] = useState("Custom");
  const [editingCustomAlgId, setEditingCustomAlgId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(learningData));
    }
  }, [learningData]);

  const updateLearningRecord = useCallback(
    (caseId: string, updater: (record: LearningCaseRecord) => LearningCaseRecord) => {
      setLearningData((current) => {
        const nextRecord = updater(recordForCase(current, caseId));
        return {
          ...current,
          [caseId]: {
            ...nextRecord,
            selectedForPractice: nextRecord.selectedForPractice === true,
            practiceStats: nextRecord.practiceStats,
            customAlgorithms: nextRecord.customAlgorithms.map((item) => ({
              ...item,
              alg: item.alg.trim(),
              label: item.label.trim() || "Custom",
            })),
          },
        };
      });
    },
    [],
  );

  const cycleLearningState = useCallback(
    (caseId: string) => {
      updateLearningRecord(caseId, (record) => ({
        ...record,
        state: nextLearningState(record.state),
      }));
    },
    [updateLearningRecord],
  );

  const setLearningState = useCallback(
    (caseId: string, state: LearningProgressState) => {
      updateLearningRecord(caseId, (record) => ({ ...record, state }));
    },
    [updateLearningRecord],
  );

  const saveCustomAlgorithm = useCallback((selectedLearnCaseId: string) => {
    const alg = customAlgDraft.trim();
    if (!alg || !selectedLearnCaseId) {
      return;
    }
    const label = customAlgLabelDraft.trim() || "Custom";
    updateLearningRecord(selectedLearnCaseId, (record) => {
      const duplicate = record.customAlgorithms.some(
        (item) => item.alg === alg && item.id !== editingCustomAlgId,
      );
      if (duplicate) {
        return record;
      }
      if (editingCustomAlgId) {
        return {
          ...record,
          customAlgorithms: record.customAlgorithms.map((item) =>
            item.id === editingCustomAlgId ? { ...item, alg, label } : item,
          ),
        };
      }
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      return {
        ...record,
        customAlgorithms: [...record.customAlgorithms, { id, alg, label }],
        primaryAlgorithmId: record.primaryAlgorithmId ?? id,
      };
    });
    setCustomAlgDraft("");
    setCustomAlgLabelDraft("Custom");
    setEditingCustomAlgId(null);
  }, [
    customAlgDraft,
    customAlgLabelDraft,
    editingCustomAlgId,
    updateLearningRecord,
  ]);

  const editCustomAlgorithm = useCallback((algorithm: CustomAlgorithm) => {
    setEditingCustomAlgId(algorithm.id);
    setCustomAlgDraft(algorithm.alg);
    setCustomAlgLabelDraft(algorithm.label);
  }, []);

  const removeCustomAlgorithm = useCallback(
    (caseId: string, algorithmId: string) => {
      updateLearningRecord(caseId, (record) => {
        const customAlgorithms = record.customAlgorithms.filter((item) => item.id !== algorithmId);
        return {
          ...record,
          customAlgorithms,
          primaryAlgorithmId:
            record.primaryAlgorithmId === algorithmId ? undefined : record.primaryAlgorithmId,
        };
      });
      if (editingCustomAlgId === algorithmId) {
        setEditingCustomAlgId(null);
        setCustomAlgDraft("");
        setCustomAlgLabelDraft("Custom");
      }
    },
    [editingCustomAlgId, updateLearningRecord],
  );

  const setPrimaryAlgorithm = useCallback(
    (caseId: string, algorithmId?: string) => {
      updateLearningRecord(caseId, (record) => ({
        ...record,
        primaryAlgorithmId: algorithmId,
      }));
    },
    [updateLearningRecord],
  );

  const togglePracticeSelection = useCallback(
    (caseId: string) => {
      updateLearningRecord(caseId, (record) => ({
        ...record,
        selectedForPractice: !record.selectedForPractice,
      }));
    },
    [updateLearningRecord],
  );

  const selectVisiblePracticeCases = useCallback((learnCases: AlgorithmCase[]) => {
    const visibleIds = new Set(learnCases.map((item) => item.id));
    setLearningData((current) => {
      const next = { ...current };
      for (const caseId of visibleIds) {
        next[caseId] = {
          ...recordForCase(current, caseId),
          selectedForPractice: true,
        };
      }
      return next;
    });
  }, []);

  const selectOnlyLearningPracticeCases = useCallback((
    learnCases: AlgorithmCase[],
    allLearnableCases: AlgorithmCase[],
  ) => {
    const learningIds = new Set(
      learnCases
        .filter((item) => recordForCase(learningData, item.id).state === "learning")
        .map((item) => item.id),
    );
    setLearningData((current) => {
      const next = { ...current };
      for (const item of allLearnableCases) {
        const record = recordForCase(current, item.id);
        next[item.id] = {
          ...record,
          selectedForPractice: learningIds.has(item.id),
        };
      }
      return next;
    });
  }, [learningData]);

  const clearPracticeSelection = useCallback((allLearnableCases: AlgorithmCase[]) => {
    setLearningData((current) => {
      const next = { ...current };
      for (const item of allLearnableCases) {
        const record = recordForCase(current, item.id);
        if (record.selectedForPractice) {
          next[item.id] = {
            ...record,
            selectedForPractice: false,
          };
        }
      }
      return next;
    });
  }, []);

  const logPracticeTiming = useCallback(
    (caseId: string, totalMs: number) => {
      updateLearningRecord(caseId, (record) => {
        const previous = record.practiceStats;
        const attempts = (previous?.attempts ?? 0) + 1;
        const previousAverage = previous?.averageMs ?? previous?.lastMs ?? totalMs;
        return {
          ...record,
          practiceStats: {
            attempts,
            bestMs: previous?.bestMs === undefined ? totalMs : Math.min(previous.bestMs, totalMs),
            averageMs:
              previous && previous.attempts > 0
                ? ((previousAverage * previous.attempts) + totalMs) / attempts
                : totalMs,
            lastMs: totalMs,
            lastPracticedAt: Date.now(),
          },
        };
      });
    },
    [updateLearningRecord],
  );

  return {
    selectedLearnCaseId,
    setSelectedLearnCaseId,
    learningData,
    setLearningData,
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
  };
}
