import { isCrossSolvedOnSide, isF2LSolvedOnSide, isOllSolvedOnSide, type CrossSide, type PatternLike } from "./cubeState";

export type FreeSplitProgress = {
  side: CrossSide;
  cross: boolean;
  f2l: boolean;
  oll: boolean;
};

function sideProgressScore(progress: Omit<FreeSplitProgress, "side">): number {
  if (progress.oll) return 3;
  if (progress.f2l) return 2;
  if (progress.cross) return 1;
  return 0;
}

function evaluateSide(
  pattern: PatternLike,
  solved: PatternLike,
  side: CrossSide,
): FreeSplitProgress {
  const cross = isCrossSolvedOnSide(pattern, solved, side);
  const f2l = cross && isF2LSolvedOnSide(pattern, solved, side);
  const oll = f2l && isOllSolvedOnSide(pattern, solved, side);
  return { side, cross, f2l, oll };
}

export function detectFreeSplitProgress(
  pattern: PatternLike,
  solved: PatternLike,
  preferredSide?: CrossSide | null,
  tieBreaker: CrossSide = "U",
): FreeSplitProgress {
  if (preferredSide) {
    return evaluateSide(pattern, solved, preferredSide);
  }
  const up = evaluateSide(pattern, solved, "U");
  const down = evaluateSide(pattern, solved, "D");
  const upScore = sideProgressScore(up);
  const downScore = sideProgressScore(down);

  if (upScore > downScore) return up;
  if (downScore > upScore) return down;
  return tieBreaker === "U" ? up : down;
}
