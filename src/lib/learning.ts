import type { AlgorithmCase } from "../data/cfopData";
import { formatMs } from "./time";

export type LearningProgressState = "unknown" | "learning" | "learned";
export type LearningProgressFilter = "all" | LearningProgressState;

export type CustomAlgorithm = {
  id: string;
  alg: string;
  label: string;
  notes?: string;
};

export type PracticeTimingStats = {
  attempts: number;
  bestMs?: number;
  averageMs?: number;
  lastMs?: number;
  lastPracticedAt?: number;
};

export type LearningCaseRecord = {
  state: LearningProgressState;
  customAlgorithms: CustomAlgorithm[];
  primaryAlgorithmId?: string;
  selectedForPractice?: boolean;
  practiceStats?: PracticeTimingStats;
};

export type LearningData = Record<string, LearningCaseRecord>;

export const LEARNING_STORAGE_KEY = "cfopLearningProgress:v1";

export function normalizeLearningRecord(value: unknown): LearningCaseRecord {
  const raw = value && typeof value === "object" ? (value as Partial<LearningCaseRecord>) : {};
  const state: LearningProgressState =
    raw.state === "learning" || raw.state === "learned" ? raw.state : "unknown";
  const rawStats = raw.practiceStats;
  const practiceStats =
    rawStats && typeof rawStats === "object" && typeof rawStats.attempts === "number"
      ? {
          attempts: Math.max(0, rawStats.attempts),
          bestMs: typeof rawStats.bestMs === "number" ? rawStats.bestMs : undefined,
          averageMs: typeof rawStats.averageMs === "number" ? rawStats.averageMs : undefined,
          lastMs: typeof rawStats.lastMs === "number" ? rawStats.lastMs : undefined,
          lastPracticedAt:
            typeof rawStats.lastPracticedAt === "number" ? rawStats.lastPracticedAt : undefined,
        }
      : undefined;
  const customAlgorithms = Array.isArray(raw.customAlgorithms)
    ? raw.customAlgorithms
        .filter((item): item is CustomAlgorithm =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as CustomAlgorithm).id === "string" &&
              typeof (item as CustomAlgorithm).alg === "string",
          ),
        )
        .map((item) => ({
          id: item.id,
          alg: item.alg.trim(),
          label: item.label?.trim() || "Custom",
          notes: item.notes?.trim() || undefined,
        }))
        .filter((item) => item.alg.length > 0)
    : [];
  const primaryAlgorithmId =
    typeof raw.primaryAlgorithmId === "string" ? raw.primaryAlgorithmId : undefined;
  return {
    state,
    customAlgorithms,
    primaryAlgorithmId,
    selectedForPractice: raw.selectedForPractice === true,
    practiceStats,
  };
}

export function initialLearningData(): LearningData {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEARNING_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([caseId, record]) => [caseId, normalizeLearningRecord(record)]),
    );
  } catch {
    return {};
  }
}

export function nextLearningState(state: LearningProgressState): LearningProgressState {
  if (state === "unknown") return "learning";
  if (state === "learning") return "learned";
  return "unknown";
}

export function recordForCase(data: LearningData, caseId: string): LearningCaseRecord {
  return data[caseId] ?? { state: "unknown", customAlgorithms: [] };
}

export function timingScore(record: LearningCaseRecord): number {
  const stats = record.practiceStats;
  if (!stats || stats.attempts === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return stats.averageMs ?? stats.lastMs ?? 0;
}

export function timingStatsLabel(record: LearningCaseRecord): string {
  const stats = record.practiceStats;
  if (!stats || stats.attempts === 0) {
    return "No timings yet";
  }
  const average = stats.averageMs !== undefined ? formatMs(stats.averageMs) : "--";
  const best = stats.bestMs !== undefined ? formatMs(stats.bestMs) : "--";
  return `${stats.attempts} tries | avg ${average} | best ${best}`;
}

export function mergeCaseWithLearning(
  activeCase: AlgorithmCase,
  record: LearningCaseRecord,
): AlgorithmCase {
  const customPrimary = record.customAlgorithms.find(
    (item) => item.id === record.primaryAlgorithmId,
  );
  if (!customPrimary) {
    return activeCase;
  }
  return {
    ...activeCase,
    solutions: [
      {
        alg: customPrimary.alg,
        label: customPrimary.label,
        source: "Custom algorithm",
        notes: customPrimary.notes ?? "Stored locally for this browser.",
      },
      ...activeCase.solutions,
    ],
  };
}

export function learningStats(cases: AlgorithmCase[], data: LearningData) {
  return cases.reduce(
    (acc, item) => {
      acc[recordForCase(data, item.id).state] += 1;
      return acc;
    },
    { unknown: 0, learning: 0, learned: 0 } satisfies Record<LearningProgressState, number>,
  );
}
