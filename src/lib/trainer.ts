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
  const ollContext = randomChoice(casesForStage("oll")).setup;
  const pllContext = randomChoice(casesForStage("pll")).setup;

  switch (stage) {
    case "cross":
      return joinAlgs([ollContext, pllContext, randomAuf]);
    case "f2l":
      return joinAlgs([ollContext, pllContext, randomAuf]);
    case "oll":
      return joinAlgs([pllContext, randomAuf]);
    case "pll":
      return joinAlgs([randomAuf]);
    default:
      return "";
  }
}
