import { cube3x3x3 } from "cubing/puzzles";

const MOVE_NAMES = [
  "U",
  "U2",
  "U'",
  "R",
  "R2",
  "R'",
  "F",
  "F2",
  "F'",
  "D",
  "D2",
  "D'",
  "L",
  "L2",
  "L'",
  "B",
  "B2",
  "B'",
] as const;

const TARGET_EDGE_IDS = [4, 5, 6, 7] as const;
const ORIENTATION_MASK = 0b1111;
const STATE_SPACE_SIZE = 12 * 12 * 12 * 12 * 16;

type MoveTable = {
  name: string;
  invPerm: number[];
  oriDelta: number[];
};

type CrossTables = {
  moves: MoveTable[];
  dist: Int16Array;
  solvedKey: number;
  maxDistance: number;
};

type GeneratedCrossCase = {
  setup: string;
  solution: string;
  distance: number;
};

let tablesPromise: Promise<CrossTables> | null = null;

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function encodeState(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  oBits: number,
): number {
  const posKey = ((p0 * 12 + p1) * 12 + p2) * 12 + p3;
  return (posKey << 4) | (oBits & ORIENTATION_MASK);
}

function decodeState(key: number): {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  oBits: number;
} {
  const oBits = key & ORIENTATION_MASK;
  let posKey = key >> 4;
  const p3 = posKey % 12;
  posKey = (posKey - p3) / 12;
  const p2 = posKey % 12;
  posKey = (posKey - p2) / 12;
  const p1 = posKey % 12;
  const p0 = (posKey - p1) / 12;
  return { p0, p1, p2, p3, oBits };
}

function applyMoveToKey(key: number, move: MoveTable): number {
  const { p0, p1, p2, p3, oBits } = decodeState(key);
  const o0 = oBits & 1;
  const o1 = (oBits >> 1) & 1;
  const o2 = (oBits >> 2) & 1;
  const o3 = (oBits >> 3) & 1;

  const np0 = move.invPerm[p0];
  const np1 = move.invPerm[p1];
  const np2 = move.invPerm[p2];
  const np3 = move.invPerm[p3];

  const no0 = o0 ^ (move.oriDelta[np0] & 1);
  const no1 = o1 ^ (move.oriDelta[np1] & 1);
  const no2 = o2 ^ (move.oriDelta[np2] & 1);
  const no3 = o3 ^ (move.oriDelta[np3] & 1);

  const noBits = no0 | (no1 << 1) | (no2 << 2) | (no3 << 3);
  return encodeState(np0, np1, np2, np3, noBits);
}

function face(moveName: string): string {
  return moveName[0];
}

function chooseMove(
  candidateMoveIndexes: number[],
  moves: MoveTable[],
  previousMove: number | null,
): number {
  if (candidateMoveIndexes.length === 0) {
    return -1;
  }
  if (previousMove === null) {
    return candidateMoveIndexes[randomInt(candidateMoveIndexes.length)];
  }

  const previousFace = face(moves[previousMove].name);
  const filtered = candidateMoveIndexes.filter(
    (index) => face(moves[index].name) !== previousFace,
  );
  if (filtered.length > 0) {
    return filtered[randomInt(filtered.length)];
  }
  return candidateMoveIndexes[randomInt(candidateMoveIndexes.length)];
}

async function initCrossTables(): Promise<CrossTables> {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const moves: MoveTable[] = MOVE_NAMES.map((name) => {
    const edgeTransform = kpuzzle.moveToTransformation(name).transformationData.EDGES;
    const invPerm = new Array<number>(12).fill(0);
    for (let newPos = 0; newPos < 12; newPos++) {
      const oldPos = edgeTransform.permutation[newPos];
      invPerm[oldPos] = newPos;
    }
    return {
      name,
      invPerm,
      oriDelta: edgeTransform.orientationDelta.map((value) => value & 1),
    };
  });

  const solvedKey = encodeState(
    TARGET_EDGE_IDS[0],
    TARGET_EDGE_IDS[1],
    TARGET_EDGE_IDS[2],
    TARGET_EDGE_IDS[3],
    0,
  );

  const dist = new Int16Array(STATE_SPACE_SIZE);
  dist.fill(-1);
  dist[solvedKey] = 0;

  const queue: number[] = [solvedKey];
  let readIndex = 0;
  let maxDistance = 0;

  while (readIndex < queue.length) {
    const key = queue[readIndex++];
    const depth = dist[key];
    if (depth > maxDistance) {
      maxDistance = depth;
    }

    for (const move of moves) {
      const next = applyMoveToKey(key, move);
      if (dist[next] !== -1) {
        continue;
      }
      dist[next] = (depth + 1) as number;
      queue.push(next);
    }
  }

  return {
    moves,
    dist,
    solvedKey,
    maxDistance,
  };
}

async function getCrossTables(): Promise<CrossTables> {
  if (!tablesPromise) {
    tablesPromise = initCrossTables();
  }
  return tablesPromise;
}

function buildExactDistanceSetup(
  tables: CrossTables,
  targetDistance: number,
): { setupMoves: string[]; finalKey: number } {
  let currentKey = tables.solvedKey;
  let previousMove: number | null = null;
  const setupMoves: string[] = [];

  // Build an exact-depth state by increasing distance one layer at a time.
  for (let depth = 1; depth <= targetDistance; depth++) {
    const candidates: number[] = [];
    for (let moveIndex = 0; moveIndex < tables.moves.length; moveIndex++) {
      const next = applyMoveToKey(currentKey, tables.moves[moveIndex]);
      if (tables.dist[next] === depth) {
        candidates.push(moveIndex);
      }
    }
    const chosen = chooseMove(candidates, tables.moves, previousMove);
    if (chosen < 0) {
      break;
    }
    currentKey = applyMoveToKey(currentKey, tables.moves[chosen]);
    setupMoves.push(tables.moves[chosen].name);
    previousMove = chosen;
  }

  return { setupMoves, finalKey: currentKey };
}

function solveCrossFromKey(tables: CrossTables, key: number): string[] {
  const solution: string[] = [];
  let currentKey = key;
  let remaining = tables.dist[currentKey];

  while (remaining > 0) {
    const candidates: number[] = [];
    for (let moveIndex = 0; moveIndex < tables.moves.length; moveIndex++) {
      const next = applyMoveToKey(currentKey, tables.moves[moveIndex]);
      if (tables.dist[next] === remaining - 1) {
        candidates.push(moveIndex);
      }
    }
    if (candidates.length === 0) {
      break;
    }
    const chosen = candidates[randomInt(candidates.length)];
    currentKey = applyMoveToKey(currentKey, tables.moves[chosen]);
    solution.push(tables.moves[chosen].name);
    remaining = tables.dist[currentKey];
  }

  return solution;
}

export async function generateExactCrossCase(
  targetDistance: number,
): Promise<GeneratedCrossCase> {
  const tables = await getCrossTables();
  if (targetDistance < 0 || targetDistance > tables.maxDistance) {
    throw new Error(
      `Cross distance ${targetDistance} is out of range (0-${tables.maxDistance}).`,
    );
  }

  let setupMoves: string[] = [];
  let finalKey = tables.solvedKey;

  // Retry a few times to guarantee we still land exactly on the target shell.
  for (let attempt = 0; attempt < 6; attempt++) {
    const generated = buildExactDistanceSetup(tables, targetDistance);
    setupMoves = generated.setupMoves;
    finalKey = generated.finalKey;
    if (tables.dist[finalKey] === targetDistance) {
      break;
    }
  }

  if (tables.dist[finalKey] !== targetDistance) {
    throw new Error("Failed to generate an exact-distance cross case.");
  }

  const solutionMoves = solveCrossFromKey(tables, finalKey);
  return {
    setup: setupMoves.join(" "),
    solution: solutionMoves.join(" "),
    distance: targetDistance,
  };
}
