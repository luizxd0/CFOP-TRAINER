import { Alg, Move } from "cubing/alg";
import * as THREE from "three";

export type CubeOrientation = "yellow-top" | "white-top";

const FACE_VECTOR_BY_FACE: Record<string, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
};

type FaceLetter = "U" | "D" | "R" | "L" | "F" | "B";
type FaceMap = Record<FaceLetter, FaceLetter>;

const IDENTITY_FACE_MAP: FaceMap = {
  U: "U",
  D: "D",
  R: "R",
  L: "L",
  F: "F",
  B: "B",
};

const ROT_STEP_LOCAL_TO_PREV: Record<"x" | "y" | "z", FaceMap> = {
  x: { U: "F", F: "D", D: "B", B: "U", R: "R", L: "L" },
  y: { F: "R", R: "B", B: "L", L: "F", U: "U", D: "D" },
  z: { U: "L", L: "D", D: "R", R: "U", F: "F", B: "B" },
};

function applyRotationStep(faceMap: FaceMap, axis: "x" | "y" | "z"): FaceMap {
  const step = ROT_STEP_LOCAL_TO_PREV[axis];
  return {
    U: faceMap[step.U],
    D: faceMap[step.D],
    R: faceMap[step.R],
    L: faceMap[step.L],
    F: faceMap[step.F],
    B: faceMap[step.B],
  };
}

function faceFromDirection(vector: THREE.Vector3): string {
  const ax = Math.abs(vector.x);
  const ay = Math.abs(vector.y);
  const az = Math.abs(vector.z);
  if (ax >= ay && ax >= az) {
    return vector.x >= 0 ? "R" : "L";
  }
  if (ay >= ax && ay >= az) {
    return vector.y >= 0 ? "U" : "D";
  }
  return vector.z >= 0 ? "F" : "B";
}

export function splitAlgTokens(alg: string): string[] {
  return alg
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function simplifyAlgText(alg: string): string {
  const normalized = splitAlgTokens(alg).join(" ");
  if (!normalized) {
    return "";
  }
  try {
    return new Alg(normalized)
      .experimentalSimplify({ cancel: true })
      .toString()
      .trim();
  } catch {
    return normalized;
  }
}

export function stripCubeRotations(alg: string): string {
  const tokens = splitAlgTokens(alg);
  if (tokens.length === 0) {
    return "";
  }
  let faceMap: FaceMap = { ...IDENTITY_FACE_MAP };
  const out: string[] = [];
  for (const token of tokens) {
    try {
      const move = Move.fromString(token);
      const family = move.family;
      const head = family[0];
      const lowerHead = head.toLowerCase();
      if (family.length === 1 && (lowerHead === "x" || lowerHead === "y" || lowerHead === "z")) {
        const turns = ((move.amount % 4) + 4) % 4;
        for (let i = 0; i < turns; i += 1) {
          faceMap = applyRotationStep(faceMap, lowerHead as "x" | "y" | "z");
        }
        continue;
      }

      const upperHead = head.toUpperCase() as FaceLetter;
      if (FACE_VECTOR_BY_FACE[upperHead]) {
        const mappedUpper = faceMap[upperHead];
        const mappedHead = head === head.toLowerCase() ? mappedUpper.toLowerCase() : mappedUpper;
        out.push(move.modified({ family: `${mappedHead}${family.slice(1)}` }).toString());
      } else {
        out.push(move.toString());
      }
    } catch {
      out.push(token);
    }
  }
  return simplifyAlgText(out.join(" "));
}

export function orientationPrefix(orientation: CubeOrientation): string {
  // TwistyPlayer does not expose direct U/D color remapping, so we rotate the
  // puzzle frame for visualization and playback when yellow should be on top.
  return orientation === "yellow-top" ? "z2" : "";
}

export function remapMoveForOrientation(move: string, orientation: CubeOrientation): string {
  if (orientation === "white-top" || move.length === 0) {
    return move;
  }
  const headMap: Record<string, string> = {
    U: "D",
    D: "U",
    R: "L",
    L: "R",
    F: "F",
    B: "B",
    u: "d",
    d: "u",
    r: "l",
    l: "r",
    f: "f",
    b: "b",
    M: "M",
    E: "E",
    S: "S",
    x: "x",
    y: "y",
    z: "z",
    m: "m",
    e: "e",
    s: "s",
    X: "X",
    Y: "Y",
    Z: "Z",
  };
  const invertDirectionHeads = new Set(["x", "y", "X", "Y", "M", "E", "m", "e"]);

  const trimmed = move.trim();
  try {
    const parsed = Move.fromString(trimmed);
    const family = parsed.family;
    const head = family[0];
    const mappedHead = headMap[head] ?? head;
    const mappedFamily = `${mappedHead}${family.slice(1)}`;
    const amount = invertDirectionHeads.has(head) ? -parsed.amount : parsed.amount;
    return parsed.modified({ family: mappedFamily, amount }).toString();
  } catch {
    const head = trimmed[0];
    const suffix = trimmed.slice(1);
    return `${headMap[head] ?? head}${suffix}`;
  }
}

export function remapAlgForOrientation(alg: string, orientation: CubeOrientation): string {
  return splitAlgTokens(alg)
    .map((token) => remapMoveForOrientation(token, orientation))
    .join(" ");
}

export function remapMoveForPerspective(
  move: string,
  orientation: THREE.Quaternion | null,
): string {
  if (!orientation || move.length === 0) {
    return move;
  }
  const face = move[0];
  const suffix = move.slice(1);
  const baseFace = face.toUpperCase();
  const baseVector = FACE_VECTOR_BY_FACE[baseFace];
  if (!baseVector) {
    return move;
  }
  const turned = baseVector.clone().applyQuaternion(orientation);
  let mappedFace = faceFromDirection(turned);
  if (face === face.toLowerCase()) {
    mappedFace = mappedFace.toLowerCase();
  }
  return `${mappedFace}${suffix}`;
}

export function invertMoveToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed.includes("2")) {
    return trimmed;
  }
  if (trimmed.endsWith("'")) {
    return trimmed.slice(0, -1);
  }
  return `${trimmed}'`;
}
