import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AlgorithmCase } from "../data/cfopData";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseSelectionSyncParams = {
  learnCases: AlgorithmCase[];
  selectedLearnCaseId: string;
  setSelectedLearnCaseId: SetState<string>;
  selectedLearnCaseIdForDraftReset: string;
  setCustomAlgDraft: SetState<string>;
  setCustomAlgLabelDraft: SetState<string>;
  setEditingCustomAlgId: SetState<string | null>;
  filteredCases: AlgorithmCase[];
  selectedCaseId: string;
  stageCases: AlgorithmCase[];
  setSelectedCaseId: SetState<string>;
};

export function useSelectionSync(params: UseSelectionSyncParams) {
  const {
    learnCases,
    selectedLearnCaseId,
    setSelectedLearnCaseId,
    selectedLearnCaseIdForDraftReset,
    setCustomAlgDraft,
    setCustomAlgLabelDraft,
    setEditingCustomAlgId,
    filteredCases,
    selectedCaseId,
    stageCases,
    setSelectedCaseId,
  } = params;

  useEffect(() => {
    if (!learnCases.some((item) => item.id === selectedLearnCaseId) && learnCases[0]) {
      setSelectedLearnCaseId(learnCases[0].id);
    }
  }, [learnCases, selectedLearnCaseId, setSelectedLearnCaseId]);

  useEffect(() => {
    setCustomAlgDraft("");
    setCustomAlgLabelDraft("Custom");
    setEditingCustomAlgId(null);
  }, [selectedLearnCaseIdForDraftReset, setCustomAlgDraft, setCustomAlgLabelDraft, setEditingCustomAlgId]);

  useEffect(() => {
    if (!filteredCases.some((item) => item.id === selectedCaseId)) {
      setSelectedCaseId(filteredCases[0]?.id ?? stageCases[0]?.id);
    }
  }, [filteredCases, selectedCaseId, setSelectedCaseId, stageCases]);
}
