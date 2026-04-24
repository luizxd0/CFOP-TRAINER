import { allCases, type AlgorithmCase, type Stage } from "../data/cfopData";

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

const AUF = ["", "U", "U'", "U2"];
const NON_EMPTY_AUF = ["U", "U'", "U2"];

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function joinAlgs(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function buildContextForStage(stage: Stage): string {
  const randomAuf = randomChoice(AUF);
  const nonEmptyAuf = randomChoice(NON_EMPTY_AUF);

  switch (stage) {
    case "cross":
      return "";
    case "f2l":
      // Keep setup short while ensuring the case does not usually end solved.
      return joinAlgs([nonEmptyAuf]);
    case "oll":
      return joinAlgs([nonEmptyAuf]);
    case "pll":
      return joinAlgs([nonEmptyAuf ?? randomAuf]);
    default:
      return "";
  }
}
