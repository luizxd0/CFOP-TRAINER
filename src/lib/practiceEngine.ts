import type { AlgorithmCase } from "../data/cfopData";
import { deriveCaseSetup, joinAlgs } from "./trainer";
import {
  hasCrossAndExactlyThreeSolvedF2LPairs,
  type PatternLike,
} from "./cubeState";
import { simplifyAlgText, stripCubeRotations } from "./notation";

type CubeKpuzzleLike = {
  defaultPattern(): {
    applyAlg(alg: string): unknown;
  };
};

export function resolveStageCaseSetup(
  stageCase: AlgorithmCase,
  kpuzzle: CubeKpuzzleLike | null,
): string {
  const canonical = stripCubeRotations(deriveCaseSetup(stageCase));
  if (stageCase.stage !== "f2l" || !kpuzzle) {
    return canonical;
  }

  const solved = kpuzzle.defaultPattern();
  const uniqueBases = Array.from(
    new Set([canonical, stripCubeRotations(stageCase.baseSetup)].filter((item) => item.trim().length > 0)),
  );
  const aufVariants = ["", "U", "U'", "U2"] as const;

  for (const base of uniqueBases) {
    for (const auf of aufVariants) {
      const candidate = simplifyAlgText(joinAlgs([auf, base]));
      const pattern = kpuzzle.defaultPattern().applyAlg(candidate);
      if (
        hasCrossAndExactlyThreeSolvedF2LPairs(
          pattern as PatternLike,
          solved as unknown as PatternLike,
        )
      ) {
        return candidate;
      }
    }
  }

  return canonical;
}
