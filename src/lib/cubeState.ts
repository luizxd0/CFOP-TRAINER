export type PatternLike = { patternData: Record<string, any> };
export type OrbitSlot = { orbit: string; index: number };
export type CrossSide = "U" | "D";

export const U_CROSS_EDGE_SLOTS = [0, 1, 2, 3] as const;
export const CROSS_EDGE_SLOTS = [4, 5, 6, 7] as const;
export const U_F2L_CORNER_SLOTS = [0, 1, 2, 3] as const;
export const F2L_EDGE_SLOTS = [8, 9, 10, 11] as const;
export const F2L_CORNER_SLOTS = [4, 5, 6, 7] as const;

export function isSlotSolved(
  pattern: PatternLike,
  solved: PatternLike,
  orbit: string,
  index: number,
): boolean {
  const pOrbit = pattern.patternData[orbit];
  const sOrbit = solved.patternData[orbit];
  if (!pOrbit || !sOrbit) {
    return false;
  }
  const pieceMatch =
    !Array.isArray(sOrbit.pieces) ||
    (Array.isArray(pOrbit.pieces) && pOrbit.pieces[index] === sOrbit.pieces[index]);
  const orientationMatch =
    !Array.isArray(sOrbit.orientation) ||
    (Array.isArray(pOrbit.orientation) && pOrbit.orientation[index] === sOrbit.orientation[index]);
  return pieceMatch && orientationMatch;
}

export function collectNewlySolvedSlots(
  setup: PatternLike,
  target: PatternLike,
  solved: PatternLike,
): OrbitSlot[] {
  const slots: OrbitSlot[] = [];
  for (const orbit of Object.keys(target.patternData)) {
    const o = target.patternData[orbit];
    const length = Array.isArray(o?.pieces)
      ? o.pieces.length
      : Array.isArray(o?.orientation)
        ? o.orientation.length
        : 0;
    for (let index = 0; index < length; index += 1) {
      const solvedInSetup = isSlotSolved(setup, solved, orbit, index);
      const solvedInTarget = isSlotSolved(target, solved, orbit, index);
      if (!solvedInSetup && solvedInTarget) {
        slots.push({ orbit, index });
      }
    }
  }
  return slots;
}

export function areSlotsSolved(pattern: PatternLike, solved: PatternLike, slots: OrbitSlot[]): boolean {
  return slots.every((slot) => isSlotSolved(pattern, solved, slot.orbit, slot.index));
}

export function isCrossSolved(pattern: PatternLike, solved: PatternLike): boolean {
  return CROSS_EDGE_SLOTS.every((index) => isSlotSolved(pattern, solved, "EDGES", index));
}

export function isCrossSolvedOnSide(
  pattern: PatternLike,
  solved: PatternLike,
  side: CrossSide,
): boolean {
  const slots = side === "U" ? U_CROSS_EDGE_SLOTS : CROSS_EDGE_SLOTS;
  return slots.every((index) => isSlotSolved(pattern, solved, "EDGES", index));
}

export function isF2LSolved(pattern: PatternLike, solved: PatternLike): boolean {
  return (
    isCrossSolved(pattern, solved) &&
    F2L_EDGE_SLOTS.every((index) => isSlotSolved(pattern, solved, "EDGES", index)) &&
    F2L_CORNER_SLOTS.every((index) => isSlotSolved(pattern, solved, "CORNERS", index))
  );
}

export function isF2LSolvedOnSide(
  pattern: PatternLike,
  solved: PatternLike,
  side: CrossSide,
): boolean {
  const cornerSlots = side === "U" ? U_F2L_CORNER_SLOTS : F2L_CORNER_SLOTS;
  return (
    isCrossSolvedOnSide(pattern, solved, side) &&
    F2L_EDGE_SLOTS.every((index) => isSlotSolved(pattern, solved, "EDGES", index)) &&
    cornerSlots.every((index) => isSlotSolved(pattern, solved, "CORNERS", index))
  );
}

export function countSolvedF2LPairs(pattern: PatternLike, solved: PatternLike): number {
  let count = 0;
  for (let i = 0; i < F2L_EDGE_SLOTS.length; i += 1) {
    if (
      isSlotSolved(pattern, solved, "EDGES", F2L_EDGE_SLOTS[i]) &&
      isSlotSolved(pattern, solved, "CORNERS", F2L_CORNER_SLOTS[i])
    ) {
      count += 1;
    }
  }
  return count;
}

export function hasCrossAndExactlyThreeSolvedF2LPairs(
  pattern: PatternLike,
  solved: PatternLike,
): boolean {
  return isCrossSolved(pattern, solved) && countSolvedF2LPairs(pattern, solved) === 3;
}

export function isOllSolved(pattern: PatternLike, solved: PatternLike): boolean {
  const edges = pattern.patternData?.EDGES?.orientation;
  const corners = pattern.patternData?.CORNERS?.orientation;
  if (!Array.isArray(edges) || !Array.isArray(corners)) {
    return false;
  }
  return (
    isF2LSolved(pattern, solved) &&
    edges.every((value) => value === 0) &&
    corners.every((value) => value === 0)
  );
}

export function isOllSolvedOnSide(
  pattern: PatternLike,
  solved: PatternLike,
  side: CrossSide,
): boolean {
  const edges = pattern.patternData?.EDGES?.orientation;
  const corners = pattern.patternData?.CORNERS?.orientation;
  if (!Array.isArray(edges) || !Array.isArray(corners)) {
    return false;
  }
  return (
    isF2LSolvedOnSide(pattern, solved, side) &&
    edges.every((value) => value === 0) &&
    corners.every((value) => value === 0)
  );
}

export function collectUnsolvedSlots(
  pattern: PatternLike,
  solved: PatternLike,
  orbit: string,
  slots: readonly number[],
): OrbitSlot[] {
  return slots
    .filter((index) => !isSlotSolved(pattern, solved, orbit, index))
    .map((index) => ({ orbit, index }));
}
