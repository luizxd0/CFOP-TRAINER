import { KPattern } from "cubing/kpuzzle";
import { cube3x3x3 } from "cubing/puzzles";
import { CubieCube } from "../../vendor/smartcube-web-bluetooth/src/smartcube/cubie-cube";

export type GyroQuaternion = { x: number; y: number; z: number; w: number };
export type CubeKpuzzle = Awaited<ReturnType<typeof cube3x3x3.kpuzzle>>;

const CUBIE_CORNER_TO_KPATTERN_CORNER = [0, 3, 2, 1, 4, 5, 6, 7] as const;
const CUBIE_EDGE_TO_KPATTERN_EDGE = [1, 0, 3, 2, 5, 4, 7, 6, 8, 9, 11, 10] as const;

export function patternFromFacelets(facelets: string, kpuzzle: CubeKpuzzle): KPattern | null {
  const parsed = new CubieCube().fromFacelet(facelets);
  if (parsed === -1) {
    return null;
  }
  const cubie = parsed as CubieCube;
  const edgePieces = Array<number>(12);
  const edgeOrientations = Array<number>(12);
  const cornerPieces = Array<number>(8);
  const cornerOrientations = Array<number>(8);

  cubie.ea.forEach((entry, cubiePosition) => {
    const kpuzzlePosition = CUBIE_EDGE_TO_KPATTERN_EDGE[cubiePosition];
    edgePieces[kpuzzlePosition] = CUBIE_EDGE_TO_KPATTERN_EDGE[entry >> 1];
    edgeOrientations[kpuzzlePosition] = entry & 1;
  });
  cubie.ca.forEach((entry, cubiePosition) => {
    const kpuzzlePosition = CUBIE_CORNER_TO_KPATTERN_CORNER[cubiePosition];
    cornerPieces[kpuzzlePosition] = CUBIE_CORNER_TO_KPATTERN_CORNER[entry & 7];
    cornerOrientations[kpuzzlePosition] = entry >> 3;
  });

  return new KPattern(kpuzzle, {
    EDGES: {
      pieces: edgePieces,
      orientation: edgeOrientations,
    },
    CORNERS: {
      pieces: cornerPieces,
      orientation: cornerOrientations,
    },
    CENTERS: {
      pieces: [0, 1, 2, 3, 4, 5],
      orientation: [0, 0, 0, 0, 0, 0],
      orientationMod: [1, 1, 1, 1, 1, 1],
    },
  });
}

export function normalizeQuaternion(q: GyroQuaternion): GyroQuaternion | null {
  if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)) {
    return null;
  }
  const norm = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (!Number.isFinite(norm) || norm <= 1e-10) {
    return null;
  }
  const inv = 1 / Math.sqrt(norm);
  return {
    x: q.x * inv,
    y: q.y * inv,
    z: q.z * inv,
    w: q.w * inv,
  };
}
