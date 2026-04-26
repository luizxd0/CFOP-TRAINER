import { allCases, type AlgorithmCase, type Stage } from "../data/cfopData";
import { Alg } from "cubing/alg";

export const stages: Stage[] = ["cross", "f2l", "oll", "pll"];

export function casesForStage(stage: Stage): AlgorithmCase[] {
  return allCases.filter((item) => item.stage === stage);
}

export function pickRandomCase(stage: Stage, difficulty?: number): AlgorithmCase {
  const cases = casesForStage(stage).filter((item) =>
    difficulty ? item.difficulty === difficulty : true,
  );
  return cases[Math.floor(Math.random() * cases.length)] ?? casesForStage(stage)[0];
}

export function moveCount(alg: string): number {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

export function joinAlgs(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function deriveCaseSetup(stageCase: AlgorithmCase): string {
  if (stageCase.stage === "cross") {
    return stageCase.setup;
  }
  const primarySolution = stageCase.solutions[0]?.alg?.trim() ?? "";
  if (primarySolution.length > 0) {
    try {
      return new Alg(primarySolution).invert().toString();
    } catch {
      // Fallback to authored setup when the algorithm parser rejects input.
    }
  }
  return stageCase.baseSetup;
}
