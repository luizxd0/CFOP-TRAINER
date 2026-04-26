import { useEffect, useRef, useState } from "react";
import { generateExactCrossCase } from "../lib/crossTrainer";
import { CROSS_MAX_UNIQUE_ATTEMPTS, CROSS_RECENT_VARIETY_WINDOW } from "../lib/appConstants";

type CrossGenerated = {
  setup: string;
  solution: string;
  loading: boolean;
  error: string | null;
};

export function useCrossCaseGenerator(
  stage: string,
  crossDifficulty: number,
  selectedCaseId: string,
  crossRefresh: number,
) {
  const recentCrossSetupsByDifficultyRef = useRef<Record<number, string[]>>({});
  const [crossGenerated, setCrossGenerated] = useState<CrossGenerated>({
    setup: "",
    solution: "",
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (stage !== "cross") {
      setCrossGenerated((current) => ({ ...current, loading: false, error: null }));
      return;
    }

    let cancelled = false;
    setCrossGenerated((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    void (async () => {
      const recent = recentCrossSetupsByDifficultyRef.current[crossDifficulty] ?? [];
      let fallback: Awaited<ReturnType<typeof generateExactCrossCase>> | null = null;
      let picked: Awaited<ReturnType<typeof generateExactCrossCase>> | null = null;

      for (let attempt = 0; attempt < CROSS_MAX_UNIQUE_ATTEMPTS; attempt += 1) {
        const next = await generateExactCrossCase(crossDifficulty);
        fallback = fallback ?? next;
        if (!recent.includes(next.setup)) {
          picked = next;
          break;
        }
      }

      const result = picked ?? fallback;
      if (!result || cancelled) {
        return;
      }

      const dedupedRecent = recent.filter((setup) => setup !== result.setup);
      const updatedRecent = [...dedupedRecent, result.setup].slice(-CROSS_RECENT_VARIETY_WINDOW);
      recentCrossSetupsByDifficultyRef.current[crossDifficulty] = updatedRecent;

      setCrossGenerated({
        setup: result.setup,
        solution: result.solution,
        loading: false,
        error: null,
      });
    })()
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setCrossGenerated((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Unknown generator error",
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [stage, crossDifficulty, selectedCaseId, crossRefresh]);

  return crossGenerated;
}
