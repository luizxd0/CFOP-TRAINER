import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
  BarChart3,
  Bluetooth,
  BookOpen,
  Eye,
  EyeOff,
  House,
  ListRestart,
  Moon,
  PlayCircle,
  Radio,
  Shuffle,
  Sun,
  TimerReset,
} from "lucide-react";
import { Alg, Move } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { cube3x3x3 } from "cubing/puzzles";
import { TwistyPlayer, setTwistyDebug } from "cubing/twisty";
import {
  connectSmartCube as connectAnySmartCube,
  type SmartCubeConnection,
} from "../vendor/smartcube-web-bluetooth/src/smartcube/index";
import type { MacAddressProvider } from "../vendor/smartcube-web-bluetooth/src/smartcube/types";
import { CubieCube, SOLVED_FACELET } from "../vendor/smartcube-web-bluetooth/src/smartcube/cubie-cube";
import {
  buildContextForStage,
  casesForStage,
  joinAlgs,
  moveCount,
  pickRandomCase,
  stages,
} from "./lib/trainer";
import { generateExactCrossCase } from "./lib/crossTrainer";
import {
  allCases,
  stageMeta,
  type AlgorithmCase,
  type LearningSubset,
  type Stage,
} from "./data/cfopData";
import "./styles.css";

type CubeOrientation = "yellow-top" | "white-top";
type CubeSkin = "classic" | "f2l";
type ThemeMode = "light" | "dark";
type AppMode = "trainer" | "free";
type AppView = "home" | "training" | "dashboard" | "learn";
type LearnStage = "f2l" | "oll" | "pll";
type LearningProgressState = "unknown" | "learning" | "learned";
type LearningProgressFilter = "all" | LearningProgressState;
type LearningSubsetFilter = "all" | LearningSubset;
type CustomAlgorithm = {
  id: string;
  alg: string;
  label: string;
  notes?: string;
};
type PracticeTimingStats = {
  attempts: number;
  bestMs?: number;
  averageMs?: number;
  lastMs?: number;
  lastPracticedAt?: number;
};
type LearningCaseRecord = {
  state: LearningProgressState;
  customAlgorithms: CustomAlgorithm[];
  primaryAlgorithmId?: string;
  selectedForPractice?: boolean;
  practiceStats?: PracticeTimingStats;
};
type LearningData = Record<string, LearningCaseRecord>;
type GyroQuaternion = { x: number; y: number; z: number; w: number };
type CubeKpuzzle = Awaited<ReturnType<typeof cube3x3x3.kpuzzle>>;
type FreeSolveRecord = {
  totalMs: number;
  crossMs: number;
  f2lMs: number;
  ollMs: number;
  pllMs: number;
  finishedAt: number;
};
type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinelLike>;
  };
};

const FULL_STICKERING_MASK = "EDGES:------------,CORNERS:--------,CENTERS:------";
const F2L_STICKERING_MASK_BY_ORIENTATION: Record<CubeOrientation, string> = {
  "white-top": "EDGES:IIII--------,CORNERS:IIII----,CENTERS:I-----",
  "yellow-top": "EDGES:----IIII----,CORNERS:----IIII,CENTERS:-----I",
};

if (typeof window !== "undefined") {
  setTwistyDebug({ shareAllNewRenderers: "always" });
}

function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("cfopTheme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return "dark";
}

function normalizeLearningRecord(value: unknown): LearningCaseRecord {
  const raw = value && typeof value === "object" ? value as Partial<LearningCaseRecord> : {};
  const state: LearningProgressState =
    raw.state === "learning" || raw.state === "learned" ? raw.state : "unknown";
  const rawStats = raw.practiceStats;
  const practiceStats =
    rawStats && typeof rawStats === "object" && typeof rawStats.attempts === "number"
      ? {
          attempts: Math.max(0, rawStats.attempts),
          bestMs: typeof rawStats.bestMs === "number" ? rawStats.bestMs : undefined,
          averageMs: typeof rawStats.averageMs === "number" ? rawStats.averageMs : undefined,
          lastMs: typeof rawStats.lastMs === "number" ? rawStats.lastMs : undefined,
          lastPracticedAt:
            typeof rawStats.lastPracticedAt === "number" ? rawStats.lastPracticedAt : undefined,
        }
      : undefined;
  const customAlgorithms = Array.isArray(raw.customAlgorithms)
    ? raw.customAlgorithms
        .filter((item): item is CustomAlgorithm =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as CustomAlgorithm).id === "string" &&
              typeof (item as CustomAlgorithm).alg === "string",
          ),
        )
        .map((item) => ({
          id: item.id,
          alg: item.alg.trim(),
          label: item.label?.trim() || "Custom",
          notes: item.notes?.trim() || undefined,
        }))
        .filter((item) => item.alg.length > 0)
    : [];
  const primaryAlgorithmId =
    typeof raw.primaryAlgorithmId === "string" ? raw.primaryAlgorithmId : undefined;
  return {
    state,
    customAlgorithms,
    primaryAlgorithmId,
    selectedForPractice: raw.selectedForPractice === true,
    practiceStats,
  };
}

function initialLearningData(): LearningData {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEARNING_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([caseId, record]) => [caseId, normalizeLearningRecord(record)]),
    );
  } catch {
    return {};
  }
}

function nextLearningState(state: LearningProgressState): LearningProgressState {
  if (state === "unknown") return "learning";
  if (state === "learning") return "learned";
  return "unknown";
}

function recordForCase(data: LearningData, caseId: string): LearningCaseRecord {
  return data[caseId] ?? { state: "unknown", customAlgorithms: [] };
}

function timingScore(record: LearningCaseRecord): number {
  const stats = record.practiceStats;
  if (!stats || stats.attempts === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return stats.averageMs ?? stats.lastMs ?? 0;
}

function timingStatsLabel(record: LearningCaseRecord): string {
  const stats = record.practiceStats;
  if (!stats || stats.attempts === 0) {
    return "No timings yet";
  }
  const average = stats.averageMs !== undefined ? formatMs(stats.averageMs) : "--";
  const best = stats.bestMs !== undefined ? formatMs(stats.bestMs) : "--";
  return `${stats.attempts} tries | avg ${average} | best ${best}`;
}

function mergeCaseWithLearning(activeCase: AlgorithmCase, record: LearningCaseRecord): AlgorithmCase {
  const customPrimary = record.customAlgorithms.find(
    (item) => item.id === record.primaryAlgorithmId,
  );
  if (!customPrimary) {
    return activeCase;
  }
  return {
    ...activeCase,
    solutions: [
      {
        alg: customPrimary.alg,
        label: customPrimary.label,
        source: "Custom algorithm",
        notes: customPrimary.notes ?? "Stored locally for this browser.",
      },
      ...activeCase.solutions,
    ],
  };
}

function learningStats(cases: AlgorithmCase[], data: LearningData) {
  return cases.reduce(
    (acc, item) => {
      acc[recordForCase(data, item.id).state] += 1;
      return acc;
    },
    { unknown: 0, learning: 0, learned: 0 } satisfies Record<LearningProgressState, number>,
  );
}

function orientationPrefix(orientation: CubeOrientation): string {
  // TwistyPlayer does not expose direct U/D color remapping, so we rotate the
  // puzzle frame for visualization and playback when yellow should be on top.
  // Use z2 so Yellow becomes U while keeping Green on F in the viewer.
  return orientation === "yellow-top" ? "z2" : "";
}

function remapMoveForOrientation(move: string, orientation: CubeOrientation): string {
  // The case database is already normal CFOP notation: yellow on top, white on
  // bottom. Only remap when the user explicitly wants to execute with white up.
  if (orientation === "yellow-top" || move.length === 0) {
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

const FACE_VECTOR_BY_FACE: Record<string, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
};

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

function remapMoveForPerspective(move: string, orientation: THREE.Quaternion | null): string {
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

type GuideStepState = "pending" | "partial" | "done";
type GuideStepInternal = {
  label: string;
  atoms: string[];
  doneAtoms: number;
};

type OrbitSlot = { orbit: string; index: number };
const CROSS_EDGE_SLOTS = [4, 5, 6, 7] as const;
const F2L_EDGE_SLOTS = [8, 9, 10, 11] as const;
const F2L_CORNER_SLOTS = [4, 5, 6, 7] as const;
const CROSS_RECENT_VARIETY_WINDOW = 24;
const CROSS_MAX_UNIQUE_ATTEMPTS = 14;
const FREE_INSPECTION_MS = 15_000;
const LEARNING_STORAGE_KEY = "cfopLearningProgress:v1";

function splitAlgTokens(alg: string): string[] {
  return alg
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function generateRandomScramble(length = 20): string {
  const faces = ["U", "D", "R", "L", "F", "B"] as const;
  const suffixes = ["", "'", "2"] as const;
  const axisByFace: Record<(typeof faces)[number], number> = {
    U: 0,
    D: 0,
    R: 1,
    L: 1,
    F: 2,
    B: 2,
  };
  const tokens: string[] = [];
  let prevFace: (typeof faces)[number] | null = null;
  let prevAxis: number | null = null;

  for (let i = 0; i < length; i += 1) {
    const candidates = faces.filter(
      (face) => face !== prevFace && axisByFace[face] !== prevAxis,
    );
    const face = candidates[Math.floor(Math.random() * candidates.length)] ?? faces[0];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)] ?? "";
    tokens.push(`${face}${suffix}`);
    prevFace = face;
    prevAxis = axisByFace[face];
  }

  return tokens.join(" ");
}

function remapAlgForOrientation(alg: string, orientation: CubeOrientation): string {
  return splitAlgTokens(alg)
    .map((token) => remapMoveForOrientation(token, orientation))
    .join(" ");
}

function tokenToAtoms(token: string): string[] {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const face = trimmed[0];
  const suffix = trimmed.slice(1);
  if (suffix.startsWith("2")) {
    const quarter = suffix.includes("'") ? `${face}'` : face;
    return [quarter, quarter];
  }
  return [trimmed];
}

function buildGuideStepsFromAlg(alg: string): GuideStepInternal[] {
  return splitAlgTokens(alg).map((token) => ({
    label: token,
    atoms: tokenToAtoms(token),
    doneAtoms: 0,
  }));
}

function cloneGuideStep(step: GuideStepInternal): GuideStepInternal {
  return {
    label: step.label,
    atoms: [...step.atoms],
    doneAtoms: step.doneAtoms,
  };
}

function simplifyQuarterAtoms(atoms: string[]): string[] {
  const stack: Array<{ face: string; turns: number }> = [];
  for (const atom of atoms) {
    const trimmed = atom.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const face = trimmed[0].toUpperCase();
    if (!FACE_VECTOR_BY_FACE[face]) {
      continue;
    }
    const isPrime = trimmed.endsWith("'");
    const turns = isPrime ? 3 : 1; // quarter turns modulo 4
    const top = stack[stack.length - 1];
    if (top && top.face === face) {
      top.turns = (top.turns + turns) % 4;
      if (top.turns === 0) {
        stack.pop();
      }
    } else {
      stack.push({ face, turns });
    }
  }
  const simplified: string[] = [];
  for (const item of stack) {
    if (item.turns === 1) {
      simplified.push(item.face);
    } else if (item.turns === 2) {
      simplified.push(item.face, item.face);
    } else if (item.turns === 3) {
      simplified.push(`${item.face}'`);
    }
  }
  return simplified;
}

function buildGuideStepsFromAtoms(atoms: string[]): GuideStepInternal[] {
  const next: GuideStepInternal[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const token = atoms[i];
    if (i + 1 < atoms.length && atoms[i + 1] === token) {
      const face = token[0].toUpperCase();
      next.push({
        label: `${face}2`,
        atoms: [token, token],
        doneAtoms: 0,
      });
      i += 1;
      continue;
    }
    next.push({
      label: token,
      atoms: [token],
      doneAtoms: 0,
    });
  }
  return next;
}

function normalizePendingGuideSteps(steps: GuideStepInternal[]): GuideStepInternal[] {
  const firstPending = steps.findIndex((step) => step.doneAtoms < step.atoms.length);
  if (firstPending < 0) {
    return steps.map(cloneGuideStep);
  }
  const completed = steps.slice(0, firstPending).map(cloneGuideStep);
  const pendingAtoms = steps
    .slice(firstPending)
    .flatMap((step) => step.atoms.slice(step.doneAtoms));
  const simplified = simplifyQuarterAtoms(pendingAtoms);
  const rebuiltPending = buildGuideStepsFromAtoms(simplified);
  return [...completed, ...rebuiltPending];
}

function guideStepView(step: GuideStepInternal): { label: string; state: GuideStepState; progress: number } {
  const total = Math.max(step.atoms.length, 1);
  const progress = Math.max(0, Math.min(1, step.doneAtoms / total));
  const state: GuideStepState =
    progress >= 1 ? "done" : progress > 0 ? "partial" : "pending";
  return {
    label: step.label,
    state,
    progress,
  };
}

function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const hundredths = Math.floor((clamped % 1000) / 10);
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
  }
  return `${seconds}.${hundredths.toString().padStart(2, "0")}`;
}

function CfopSplitBar({
  cross,
  f2l,
  oll,
  pll,
}: {
  cross: number | null;
  f2l: number | null;
  oll: number | null;
  pll: number | null;
}) {
  const segments = [
    { key: "cross", label: "Cross", value: cross },
    { key: "f2l", label: "F2L", value: f2l },
    { key: "oll", label: "OLL", value: oll },
    { key: "pll", label: "PLL", value: pll },
  ];
  const knownTotal = segments.reduce((sum, segment) => sum + (segment.value ?? 0), 0);
  const fallbackWidth = `${100 / segments.length}%`;

  return (
    <div className="cfop-split-bar" aria-label="CFOP split bar">
      {segments.map((segment) => {
        const width =
          knownTotal > 0 && segment.value !== null
            ? `${Math.max(8, (segment.value / knownTotal) * 100)}%`
            : fallbackWidth;
        return (
          <div
            className={`cfop-split-segment ${segment.key}`}
            key={segment.key}
            style={{ flexBasis: width }}
          >
            <span>{segment.label}</span>
            <strong>{segment.value === null ? "--" : formatMs(segment.value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function simplifyAlgText(alg: string): string {
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

function stripCubeRotations(alg: string): string {
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

function isSlotSolved(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
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

function collectNewlySolvedSlots(
  setup: { patternData: Record<string, any> },
  target: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
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

function areSlotsSolved(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
  slots: OrbitSlot[],
): boolean {
  return slots.every((slot) => isSlotSolved(pattern, solved, slot.orbit, slot.index));
}

function isCrossSolved(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
): boolean {
  return CROSS_EDGE_SLOTS.every((index) => isSlotSolved(pattern, solved, "EDGES", index));
}

function isF2LSolved(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
): boolean {
  return (
    isCrossSolved(pattern, solved) &&
    F2L_EDGE_SLOTS.every((index) => isSlotSolved(pattern, solved, "EDGES", index)) &&
    F2L_CORNER_SLOTS.every((index) => isSlotSolved(pattern, solved, "CORNERS", index))
  );
}

function countSolvedF2LPairs(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
): number {
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

function isOllSolved(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
): boolean {
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

function collectUnsolvedSlots(
  pattern: { patternData: Record<string, any> },
  solved: { patternData: Record<string, any> },
  orbit: string,
  slots: readonly number[],
): OrbitSlot[] {
  return slots
    .filter((index) => !isSlotSolved(pattern, solved, orbit, index))
    .map((index) => ({ orbit, index }));
}

const CUBIE_CORNER_TO_KPATTERN_CORNER = [0, 3, 2, 1, 4, 5, 6, 7] as const;
const CUBIE_EDGE_TO_KPATTERN_EDGE = [1, 0, 3, 2, 5, 4, 7, 6, 8, 9, 11, 10] as const;

function patternFromFacelets(facelets: string, kpuzzle: CubeKpuzzle): KPattern | null {
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

function normalizeQuaternion(q: GyroQuaternion): GyroQuaternion | null {
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

function isMissingCubeMacError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("unable to determine cube mac address");
}

function webBluetoothBlockReason(): string | null {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Web Bluetooth blocked: this page must run on HTTPS (or localhost).";
  }
  if (typeof navigator === "undefined" || !navigator.bluetooth) {
    return "Web Bluetooth unavailable in this browser. Use Chrome on Android or Chrome/Edge on PC.";
  }
  if (typeof (navigator.bluetooth as any).requestDevice !== "function") {
    return "Web Bluetooth API incomplete in this browser (requestDevice missing). Open the app in Chrome.";
  }
  return null;
}

const SMARTCUBE_MANUAL_MAC_KEY = "smartcubeManualMacByDevice:";
const SMARTCUBE_DEBUG = true;

function smartCubeDebug(...args: unknown[]): void {
  if (!SMARTCUBE_DEBUG || typeof console === "undefined") {
    return;
  }
  console.log("[smartcube]", ...args);
}

function normalizeMacAddress(input: string): string | null {
  const compact = input.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (compact.length !== 12) {
    return null;
  }
  const parts = compact.match(/.{1,2}/g);
  return parts ? parts.join(":") : null;
}

function readManualMacForDevice(device: BluetoothDevice): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = `${SMARTCUBE_MANUAL_MAC_KEY}${device.id}`;
  const value = window.localStorage.getItem(key);
  return value && value.length > 0 ? value : null;
}

function storeManualMacForDevice(device: BluetoothDevice, mac: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = `${SMARTCUBE_MANUAL_MAC_KEY}${device.id}`;
  window.localStorage.setItem(key, mac);
}

function maskFacelets(facelets: string): string {
  return facelets.length <= 18 ? facelets : `${facelets.slice(0, 18)}...`;
}

function CubeViewer({
  setup,
  alg,
  title,
  contextMoves,
  headlineAlg = null,
  timerInHeadline = false,
  headlineTimerActive = false,
  cubeOrientation,
  cubeSkin = "classic",
  mirrorHintsEnabled = true,
  hideControls = false,
  liveMoves = [],
  guideSteps = [],
  showLiveMoves = false,
  demoPlayerAvailable = false,
  demoPlayerEnabled = false,
  onDemoPlayerEnabledChange,
  onDemoPlaybackFinished,
  timerLabel = null,
  isTimerRunning = false,
  isLive = false,
  gyroQuaternion = null,
  gyroSession = 0,
  orientationNotice = null,
}: {
  setup: string;
  alg: string;
  title: string;
  contextMoves: number;
  headlineAlg?: string | null;
  timerInHeadline?: boolean;
  headlineTimerActive?: boolean;
  cubeOrientation: CubeOrientation;
  cubeSkin?: CubeSkin;
  mirrorHintsEnabled?: boolean;
  hideControls?: boolean;
  liveMoves?: string[];
  guideSteps?: Array<{ label: string; state: GuideStepState; progress: number }>;
  showLiveMoves?: boolean;
  demoPlayerAvailable?: boolean;
  demoPlayerEnabled?: boolean;
  onDemoPlayerEnabledChange?: (enabled: boolean) => void;
  onDemoPlaybackFinished?: () => void;
  timerLabel?: string | null;
  isTimerRunning?: boolean;
  isLive?: boolean;
  gyroQuaternion?: GyroQuaternion | null;
  gyroSession?: number;
  orientationNotice?: string | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const puzzleObjectRef = useRef<THREE.Object3D | null>(null);
  const vantageRef = useRef<{ render?: () => void } | null>(null);
  const gyroBasisRef = useRef<THREE.Quaternion | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveSetupTokensRef = useRef<string[]>([]);
  const liveSyncReadyRef = useRef(false);
  const liveOrientationRef = useRef<CubeOrientation | null>(null);
  const demoResetDoneRef = useRef(false);
  const homeOrientationRef = useRef(
    new THREE.Quaternion().setFromEuler(new THREE.Euler((15 * Math.PI) / 180, (-5 * Math.PI) / 180, 0)),
  );
  const yellowTopRotationRef = useRef(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
  );
  const liveTargetQuaternionRef = useRef(
    new THREE.Quaternion().setFromEuler(new THREE.Euler((15 * Math.PI) / 180, (-20 * Math.PI) / 180, 0)),
  );

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }
    const effectiveMirrorHints = cubeSkin !== "f2l" && mirrorHintsEnabled;

    hostRef.current.replaceChildren();
    const player = new TwistyPlayer({
      puzzle: "3x3x3",
      experimentalSetupAlg: "",
      alg: "",
      background: "none",
      controlPanel: hideControls ? "none" : "bottom-row",
      backView: "none",
      visualization: "3D",
      experimentalStickering: "full",
      hintFacelets: effectiveMirrorHints ? "floating" : "none",
      experimentalFaceletScale: 0.92,
      experimentalInitialHintFaceletsAnimation: "none",
      experimentalHintFaceletsElevation: effectiveMirrorHints ? "auto" : 0,
      cameraLatitude: 28,
      cameraLongitude: 32,
      cameraDistance: 5.85,
    });
    hostRef.current.appendChild(player);
    playerRef.current = player;

    return () => {
      player.remove();
      if (playerRef.current === player) {
        playerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      puzzleObjectRef.current = null;
      vantageRef.current = null;
      gyroBasisRef.current = null;
      liveSetupTokensRef.current = [];
      liveSyncReadyRef.current = false;
      liveOrientationRef.current = null;
      liveTargetQuaternionRef.current = new THREE.Quaternion().setFromEuler(
        new THREE.Euler((15 * Math.PI) / 180, (-20 * Math.PI) / 180, 0),
      );
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    const effectiveMirrorHints = cubeSkin !== "f2l" && mirrorHintsEnabled;

    // `setup`/`alg` arrive in display notation for the selected orientation.
    // We rotate the whole cube frame for yellow-top and then apply those moves.
    const playbackSetupWithOrientation = joinAlgs([orientationPrefix(cubeOrientation), setup]);
    const playbackAlg = alg;

    player.controlPanel = hideControls ? "none" : "bottom-row";
    player.backView = "none";
    player.hintFacelets = effectiveMirrorHints ? "floating" : "none";
    player.experimentalHintFaceletsElevation = effectiveMirrorHints ? "auto" : 0;
    player.experimentalStickering = "full";
    player.experimentalStickeringMaskOrbits =
      cubeSkin === "f2l"
        ? F2L_STICKERING_MASK_BY_ORIENTATION[cubeOrientation]
        : FULL_STICKERING_MASK;
    player.experimentalFaceletScale = isLive ? 0.91 : 0.93;
    player.tempoScale = isLive ? 1.28 : 1;

    if (!isLive) {
      liveSetupTokensRef.current = [];
      liveSyncReadyRef.current = false;
      liveOrientationRef.current = null;
      player.experimentalSetupAlg = playbackSetupWithOrientation;
      player.alg = playbackAlg;
      if (demoPlayerEnabled && !demoResetDoneRef.current) {
        demoResetDoneRef.current = true;
        player.pause();
        requestAnimationFrame(() => {
          player.jumpToStart({ flash: false });
        });
      } else if (!demoPlayerEnabled) {
        demoResetDoneRef.current = false;
      }
      return;
    }

    demoResetDoneRef.current = false;
    const nextTokens = splitAlgTokens(setup);
    const previousTokens = liveSetupTokensRef.current;
    const orientationChanged = liveOrientationRef.current !== cubeOrientation;
    const isPrefix =
      nextTokens.length >= previousTokens.length &&
      previousTokens.every((token, index) => token === nextTokens[index]);

    if (!liveSyncReadyRef.current || orientationChanged || !isPrefix) {
      player.experimentalSetupAlg = playbackSetupWithOrientation;
      player.alg = "";
      player.jumpToEnd({ flash: false });
      liveSetupTokensRef.current = nextTokens;
      liveSyncReadyRef.current = true;
      liveOrientationRef.current = cubeOrientation;
      return;
    }

    if (nextTokens.length > previousTokens.length) {
      const appended = nextTokens.slice(previousTokens.length);
      for (const token of appended) {
        player.experimentalAddMove(token, { cancel: false });
      }
      liveSetupTokensRef.current = nextTokens;
      liveOrientationRef.current = cubeOrientation;
      return;
    }

    if (nextTokens.length === previousTokens.length) {
      liveOrientationRef.current = cubeOrientation;
      return;
    }

    player.experimentalSetupAlg = playbackSetupWithOrientation;
    player.alg = "";
    player.jumpToEnd({ flash: false });
    liveSetupTokensRef.current = nextTokens;
    liveSyncReadyRef.current = true;
    liveOrientationRef.current = cubeOrientation;
  }, [setup, alg, cubeOrientation, cubeSkin, mirrorHintsEnabled, hideControls, isLive, demoPlayerEnabled]);

  useEffect(() => {
    gyroBasisRef.current = null;
    liveTargetQuaternionRef.current = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((15 * Math.PI) / 180, (-20 * Math.PI) / 180, 0),
    );
    if (puzzleObjectRef.current) {
      puzzleObjectRef.current.quaternion.copy(liveTargetQuaternionRef.current);
    }
    if (!isLive && !demoPlayerEnabled) {
      puzzleObjectRef.current = null;
      vantageRef.current = null;
    }
  }, [gyroSession, isLive, cubeOrientation, demoPlayerEnabled]);

  useEffect(() => {
    if ((!isLive && !demoPlayerEnabled) || !gyroQuaternion) {
      return;
    }

    const mapped = new THREE.Quaternion(
      gyroQuaternion.x,
      gyroQuaternion.z,
      -gyroQuaternion.y,
      gyroQuaternion.w,
    );
    if (
      !Number.isFinite(mapped.x) ||
      !Number.isFinite(mapped.y) ||
      !Number.isFinite(mapped.z) ||
      !Number.isFinite(mapped.w)
    ) {
      return;
    }
    mapped.normalize();

    if (!gyroBasisRef.current) {
      gyroBasisRef.current = mapped.clone().conjugate();
    }

    const relativeOrientation = mapped.clone().premultiply(gyroBasisRef.current);
    if (cubeOrientation === "yellow-top") {
      // Keep gyro frame aligned with z2 orientation used for yellow-top visualization.
      relativeOrientation
        .premultiply(yellowTopRotationRef.current)
        .multiply(yellowTopRotationRef.current);
    }
    liveTargetQuaternionRef.current.copy(relativeOrientation.premultiply(homeOrientationRef.current));
  }, [gyroQuaternion, isLive, cubeOrientation, demoPlayerEnabled]);

  useEffect(() => {
    if ((!isLive && !demoPlayerEnabled) || !playerRef.current) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      puzzleObjectRef.current = null;
      vantageRef.current = null;
      return;
    }

    let cancelled = false;

    const ensure3dHandles = async () => {
      if (puzzleObjectRef.current) {
        return;
      }
      try {
        const vantageList = await playerRef.current?.experimentalCurrentVantages();
        if (vantageList && !cancelled) {
          vantageRef.current = ([...vantageList][0] ?? null) as { render?: () => void } | null;
        }
        const object3d = await playerRef.current?.experimentalCurrentThreeJSPuzzleObject();
        if (!cancelled && object3d) {
          puzzleObjectRef.current = object3d as THREE.Object3D;
          puzzleObjectRef.current.quaternion.copy(liveTargetQuaternionRef.current);
        }
      } catch {
        // Ignore if the underlying visualization does not expose a 3D object.
      }
    };

    const tick = () => {
      if (cancelled) {
        return;
      }
      const puzzle = puzzleObjectRef.current;
      if (puzzle) {
        puzzle.quaternion.slerp(liveTargetQuaternionRef.current, 0.18);
      } else {
        void ensure3dHandles();
      }
      vantageRef.current?.render?.();
      rafRef.current = requestAnimationFrame(tick);
    };

    void ensure3dHandles();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      puzzleObjectRef.current = null;
      vantageRef.current = null;
    };
  }, [isLive, gyroSession, demoPlayerEnabled]);

  const visibleLiveMoves = useMemo(() => liveMoves.slice(-32), [liveMoves]);
  const showGuideInHeadline = isLive && guideSteps.length > 0;

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !demoPlayerEnabled || !onDemoPlaybackFinished) {
      return;
    }

    let hasPlayed = false;
    const model = player.experimentalModel as any;
    const playingInfoProp = model?.playingInfo;
    const detailedTimelineInfoProp = model?.detailedTimelineInfo;
    if (!playingInfoProp?.addFreshListener || !playingInfoProp?.removeFreshListener) {
      return;
    }

    const listener = (playingInfo: { playing?: boolean }) => {
      if (playingInfo.playing) {
        hasPlayed = true;
        return;
      }
      if (!hasPlayed) {
        return;
      }
      void detailedTimelineInfoProp?.get?.().then((timeline: { atEnd?: boolean } | undefined) => {
        if (timeline?.atEnd) {
          onDemoPlaybackFinished();
        }
      });
    };

    playingInfoProp.addFreshListener(listener);
    return () => {
      playingInfoProp.removeFreshListener(listener);
    };
  }, [demoPlayerEnabled, onDemoPlaybackFinished]);

  return (
    <section className="viewer-panel" aria-label={title}>
      <div className="viewer-toolbar">
        <div>
          <p className="eyebrow">3D setup</p>
          <h2>{title}</h2>
        </div>
        <div className="chip-row">
          {demoPlayerAvailable && (
            <button
              className={`mini-toggle ${demoPlayerEnabled ? "active" : ""}`}
              onClick={() => onDemoPlayerEnabledChange?.(!demoPlayerEnabled)}
            >
              <PlayCircle size={15} />
              Demo player
            </button>
          )}
          {timerLabel && !timerInHeadline && (
            <span className={`timer-chip ${isTimerRunning ? "running" : ""}`}>{timerLabel}</span>
          )}
          <span className="chip">{isLive ? `${contextMoves} live turns` : `${moveCount(setup)} prep moves`}</span>
          {!isLive && contextMoves > 0 && <span className="chip">{contextMoves} context moves</span>}
        </div>
      </div>
      {(headlineAlg || (timerInHeadline && headlineTimerActive && timerLabel)) && (
        <div className={`viewer-headline ${showGuideInHeadline ? "with-guide" : ""}`}>
          {orientationNotice && (
            <div
              style={{
                marginBottom: "0.45rem",
                textAlign: "center",
                color: "#ffd966",
                fontWeight: 700,
              }}
            >
              {orientationNotice}
            </div>
          )}
          {timerInHeadline && headlineTimerActive && timerLabel ? (
            <strong className={`viewer-timer-headline ${isTimerRunning ? "running" : ""}`}>{timerLabel}</strong>
          ) : (
            <>
              <span className="viewer-headline-label">Set up Algorithm</span>
              {showGuideInHeadline ? (
                <div className="live-guide-steps live-guide-steps-headline" aria-label="Setup algorithm progress">
                  {guideSteps.map((step, index) => (
                    <i
                      key={`${step.label}-${index}`}
                      className={`guide-step ${step.state}`}
                      style={{ ["--progress" as string]: `${Math.round(step.progress * 100)}%` }}
                    >
                      {step.label}
                    </i>
                  ))}
                </div>
              ) : (
                <code>{headlineAlg}</code>
              )}
            </>
          )}
        </div>
      )}
      <div className="twisty-host" ref={hostRef} />
      {showLiveMoves && (
          <div className="live-move-strip">
            {visibleLiveMoves.length === 0 ? (
              <span>Moves will appear here as you turn the cube.</span>
            ) : (
              visibleLiveMoves.map((move, index) => (
                <b key={`${move}-${index}`}>{move}</b>
              ))
            )}
          </div>
      )}
    </section>
  );
}

type CasePreviewRequest = {
  key: string;
  setup: string;
  compact: boolean;
};

const casePreviewCache = new Map<string, string>();
const casePreviewPending = new Map<string, Promise<string>>();
const casePreviewSubscribers = new Map<string, Set<() => void>>();
const casePreviewQueue: Array<() => Promise<void>> = [];
let casePreviewQueueRunning = false;
let casePreviewBackend: { host: HTMLDivElement; player: TwistyPlayer } | null = null;

function getCasePreview(key: string): string | undefined {
  return casePreviewCache.get(key);
}

function subscribeCasePreview(key: string, listener: () => void): () => void {
  const listeners = casePreviewSubscribers.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  casePreviewSubscribers.set(key, listeners);
  return () => {
    const current = casePreviewSubscribers.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      casePreviewSubscribers.delete(key);
    }
  };
}

function notifyCasePreview(key: string) {
  const listeners = casePreviewSubscribers.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function awaitTwistyIntersectedCallback(player: TwistyPlayer): Promise<void> {
  let callback: ((this: TwistyPlayer) => Promise<void>) | undefined;
  for (let proto: object | null = Object.getPrototypeOf(player); proto && !callback; proto = Object.getPrototypeOf(proto)) {
    const symbol = Object.getOwnPropertySymbols(proto).find(
      (item) => item.description === "intersectedCallback",
    );
    const candidate = symbol ? (proto as Record<symbol, unknown>)[symbol] : undefined;
    if (typeof candidate === "function") {
      callback = candidate as (this: TwistyPlayer) => Promise<void>;
    }
  }
  if (callback) {
    await callback.call(player);
  }
}

function ensureCasePreviewBackend(): { host: HTMLDivElement; player: TwistyPlayer } {
  if (casePreviewBackend) {
    return casePreviewBackend;
  }
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "260px";
  host.style.height = "260px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  host.style.overflow = "hidden";
  document.body.appendChild(host);

  const player = new TwistyPlayer({
    puzzle: "3x3x3",
    experimentalSetupAlg: "",
    alg: "",
    background: "none",
    controlPanel: "none",
    backView: "none",
    viewerLink: "none",
    visualization: "3D",
    experimentalStickering: "full",
    experimentalStickeringMaskOrbits: FULL_STICKERING_MASK,
    hintFacelets: "none",
    experimentalDragInput: "none",
    experimentalFaceletScale: 0.92,
    experimentalInitialHintFaceletsAnimation: "none",
    cameraLatitude: 28,
    cameraLongitude: 32,
    cameraDistance: 5.85,
  });
  player.style.width = "260px";
  player.style.height = "260px";
  host.appendChild(player);
  casePreviewBackend = { host, player };
  return casePreviewBackend;
}

async function renderCasePreview(request: CasePreviewRequest): Promise<string> {
  const { player } = ensureCasePreviewBackend();
  await awaitTwistyIntersectedCallback(player);
  player.experimentalSetupAlg = request.setup;
  player.alg = "";
  player.experimentalFaceletScale = request.compact ? 0.88 : 0.92;
  player.cameraDistance = request.compact ? 6.6 : 5.85;
  player.jumpToStart({ flash: false });
  await nextTask();
  await nextFrame();
  await nextFrame();
  return player.experimentalScreenshot({ width: 512, height: 512 });
}

function enqueueCasePreview(job: () => Promise<void>) {
  casePreviewQueue.push(job);
  void drainCasePreviewQueue();
}

async function drainCasePreviewQueue() {
  if (casePreviewQueueRunning) return;
  casePreviewQueueRunning = true;
  try {
    while (casePreviewQueue.length > 0) {
      const job = casePreviewQueue.shift();
      if (job) {
        await job();
      }
    }
  } finally {
    casePreviewQueueRunning = false;
  }
}

function requestCasePreview(request: CasePreviewRequest): Promise<string> {
  const cached = casePreviewCache.get(request.key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = casePreviewPending.get(request.key);
  if (pending) {
    return pending;
  }
  const promise = new Promise<string>((resolve) => {
    enqueueCasePreview(async () => {
      try {
        const src = await renderCasePreview(request);
        if (src) {
          casePreviewCache.set(request.key, src);
        }
        resolve(src);
      } catch {
        resolve("");
      } finally {
        casePreviewPending.delete(request.key);
        notifyCasePreview(request.key);
      }
    });
  });
  casePreviewPending.set(request.key, promise);
  return promise;
}

function CasePreview({
  activeCase,
  cubeOrientation,
  compact = false,
}: {
  activeCase: AlgorithmCase;
  cubeOrientation: CubeOrientation;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setup = joinAlgs([
    orientationPrefix(cubeOrientation),
    activeCase.diagramSetup ?? activeCase.baseSetup,
  ]);
  const previewKey = `${setup}|${compact ? "compact" : "detail"}`;
  const [previewSrc, setPreviewSrc] = useState(() => getCasePreview(previewKey));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setPreviewSrc(getCasePreview(previewKey));
  }, [previewKey]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "220px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || previewSrc) {
      return;
    }
    let cancelled = false;
    const unsubscribe = subscribeCasePreview(previewKey, () => {
      if (!cancelled) {
        setPreviewSrc(getCasePreview(previewKey));
      }
    });
    void requestCasePreview({ key: previewKey, setup, compact }).then((src) => {
      if (!cancelled) {
        setPreviewSrc(src);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [compact, previewKey, previewSrc, setup, visible]);

  return (
    <div className={compact ? "case-preview compact" : "case-preview"} ref={hostRef}>
      {previewSrc ? (
        <img src={previewSrc} alt={`${activeCase.name} preview`} />
      ) : (
        <span>Loading preview...</span>
      )}
    </div>
  );
}

function SmartCubePanel({
  onMove,
  onGyro,
  onFacelets,
  onConnectionChange,
  onResetLiveState,
  liveStateReady,
  cubeOrientation,
  freeLastSolves,
}: {
  onMove?: (move: { raw: string; display: string }) => void;
  onGyro?: (quaternion: GyroQuaternion | null) => void;
  onFacelets?: (facelets: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onResetLiveState?: () => void;
  liveStateReady: boolean;
  cubeOrientation: CubeOrientation;
  freeLastSolves: FreeSolveRecord[];
}) {
  const [support, setSupport] = useState("Checking browser support...");
  const [status, setStatus] = useState("Not connected");
  const [deviceName, setDeviceName] = useState("No cube");
  const [deviceMac, setDeviceMac] = useState("Unknown");
  const [preferredDeviceName, setPreferredDeviceName] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return localStorage.getItem("smartcubePreferredDeviceName") ?? "";
  });
  const [battery, setBattery] = useState<number | null>(null);
  const [orientation, setOrientation] = useState("Waiting for gyro data");
  const [isConnected, setIsConnected] = useState(false);
  const [showBluetoothDetails, setShowBluetoothDetails] = useState(false);
  const smartRef = useRef<SmartCubeConnection | null>(null);
  const smartSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const initialFaceletsSeenRef = useRef(false);
  const initialFaceletsSyncTimerRef = useRef<number | null>(null);
  const initialFaceletsSyncAttemptsRef = useRef(0);
  const gyroBasisForMovesRef = useRef<THREE.Quaternion | null>(null);
  const gyroRelativeForMovesRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const yellowTopRotationRef = useRef(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
  );
  const clearInitialFaceletsSync = useCallback(() => {
    if (initialFaceletsSyncTimerRef.current !== null) {
      window.clearTimeout(initialFaceletsSyncTimerRef.current);
      initialFaceletsSyncTimerRef.current = null;
    }
  }, []);
  const scheduleInitialFaceletsSync = useCallback(
    (conn: SmartCubeConnection, delayMs: number) => {
      clearInitialFaceletsSync();
      smartCubeDebug("schedule facelets sync", {
        protocol: conn.protocol.name,
        delayMs,
        attempt: initialFaceletsSyncAttemptsRef.current + 1,
        liveStateReady,
      });
      initialFaceletsSyncTimerRef.current = window.setTimeout(() => {
        if (
          smartRef.current !== conn ||
          liveStateReady ||
          !conn.capabilities.facelets
        ) {
          return;
        }

        const attempt = initialFaceletsSyncAttemptsRef.current + 1;
        initialFaceletsSyncAttemptsRef.current = attempt;
        smartCubeDebug("requesting facelets", {
          protocol: conn.protocol.name,
          attempt,
          seenFirstFacelets: initialFaceletsSeenRef.current,
        });
        if (attempt === 1) {
          setStatus(`Connected via ${conn.protocol.name}. Syncing cube state...`);
        } else if (attempt === 5) {
          setStatus(`Connected via ${conn.protocol.name}. Still waiting for cube state...`);
        }

        void conn.sendCommand({ type: "REQUEST_FACELETS" }).catch(() => {
          // Keep retrying in the background if the cube is still settling.
        });

        if (smartRef.current !== conn || liveStateReady) {
          return;
        }
        scheduleInitialFaceletsSync(conn, Math.min(3500, 900 + attempt * 450));
      }, delayMs);
    },
    [clearInitialFaceletsSync, liveStateReady],
  );
  const emitMove = useCallback(
    (move: { raw: string; display: string }) => {
      if (typeof onMove === "function") {
        onMove(move);
      }
    },
    [onMove],
  );
  const emitGyro = useCallback(
    (quaternion: GyroQuaternion | null) => {
      if (typeof onGyro === "function") {
        onGyro(quaternion);
      }
    },
    [onGyro],
  );
  const emitFacelets = useCallback(
    (facelets: string) => {
      if (typeof onFacelets === "function") {
        onFacelets(facelets);
      }
    },
    [onFacelets],
  );
  const emitConnectionChange = useCallback(
    (connected: boolean) => {
      if (typeof onConnectionChange === "function") {
        onConnectionChange(connected);
      }
    },
    [onConnectionChange],
  );
  const emitResetLiveState = useCallback(() => {
    if (typeof onResetLiveState === "function") {
      onResetLiveState();
    }
  }, [onResetLiveState]);

  useEffect(() => {
    const blockedReason = webBluetoothBlockReason();
    if (blockedReason) {
      setSupport(blockedReason);
    } else {
      const watchAdsSupported =
        typeof window !== "undefined" &&
        typeof (window as any).BluetoothDevice !== "undefined" &&
        typeof (window as any).BluetoothDevice.prototype?.watchAdvertisements === "function";
      setSupport(
        watchAdsSupported
          ? "Web Bluetooth available in this browser"
          : "Web Bluetooth available (limited ad API; GAN MAC fallback may require manual input once).",
      );
    }

    return () => {
      if (smartSubscriptionRef.current) {
        smartSubscriptionRef.current.unsubscribe();
        smartSubscriptionRef.current = null;
      }
      void smartRef.current?.disconnect();
      smartRef.current = null;
      clearInitialFaceletsSync();
      gyroBasisForMovesRef.current = null;
      gyroRelativeForMovesRef.current.identity();
      emitConnectionChange(false);
      emitGyro(null);
    };
  }, [clearInitialFaceletsSync, emitConnectionChange, emitGyro]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    localStorage.setItem("smartcubePreferredDeviceName", preferredDeviceName);
  }, [preferredDeviceName]);

  useEffect(() => {
    gyroBasisForMovesRef.current = null;
    gyroRelativeForMovesRef.current.identity();
  }, [cubeOrientation]);

  const customMacAddressProvider = useCallback<MacAddressProvider>(async (device, isFallbackCall) => {
    const cachedManualMac = readManualMacForDevice(device);
    smartCubeDebug("mac provider called", {
      deviceName: device.name ?? "Unknown",
      deviceId: device.id,
      isFallbackCall: isFallbackCall === true,
      cachedManualMac,
    });
    if (!isFallbackCall) {
      // Always let automatic discovery run first. A stale manual MAC can produce
      // a "connected but no move data" session on GAN cubes.
      return null;
    }
    smartCubeDebug("manual MAC prompt suppressed", {
      deviceName: device.name ?? "Unknown",
      deviceId: device.id,
    });
    return null;
  }, []);

  function attachSmartConnection(conn: SmartCubeConnection) {
    smartCubeDebug("attach connection", {
      protocol: conn.protocol.name,
      deviceName: conn.deviceName,
      deviceMAC: conn.deviceMAC,
      capabilities: conn.capabilities,
    });
    smartRef.current = conn;
    const nextName = conn.deviceName || "Smart cube";
    setDeviceName(nextName);
    setPreferredDeviceName(nextName);
    setDeviceMac(conn.deviceMAC || "Unknown");
    setStatus(`Connected via ${conn.protocol.name}`);
    setIsConnected(true);
    setShowBluetoothDetails(false);
    initialFaceletsSeenRef.current = false;
    initialFaceletsSyncAttemptsRef.current = 0;
    clearInitialFaceletsSync();
    gyroBasisForMovesRef.current = null;
    gyroRelativeForMovesRef.current.identity();
    emitConnectionChange(true);
    setOrientation(
      conn.capabilities.gyroscope ? "Waiting for gyro data" : "Gyro not supported by this protocol",
    );
    setBattery(null);

    if (smartSubscriptionRef.current) {
      smartSubscriptionRef.current.unsubscribe();
    }

    smartSubscriptionRef.current = conn.events$.subscribe((event) => {
      switch (event.type) {
        case "MOVE":
          {
            const move = event.move.trim();
            if (!move) {
              break;
            }
            smartCubeDebug("move event", { move, timestamp: event.timestamp });
            const orientedMove = remapMoveForOrientation(move, cubeOrientation);
            emitMove({
              raw: move,
              display: remapMoveForPerspective(orientedMove, gyroRelativeForMovesRef.current),
            });
          }
          break;
        case "FACELETS":
          smartCubeDebug("facelets event", {
            timestamp: event.timestamp,
            preview: maskFacelets(event.facelets),
            liveStateReady,
          });
          if (!initialFaceletsSeenRef.current) {
            initialFaceletsSeenRef.current = true;
            initialFaceletsSyncAttemptsRef.current = 0;
            if (!liveStateReady) {
              setStatus(`Connected via ${conn.protocol.name}. Syncing cube state...`);
            }
          }
          emitFacelets(event.facelets);
          break;
        case "GYRO":
          {
            const normalized = normalizeQuaternion({
              x: event.quaternion.x,
              y: event.quaternion.y,
              z: event.quaternion.z,
              w: event.quaternion.w,
            });
            if (!normalized) {
              break;
            }
            setOrientation(
              `x ${normalized.x.toFixed(2)} | y ${normalized.y.toFixed(2)} | z ${normalized.z.toFixed(2)} | w ${normalized.w.toFixed(2)}`,
            );
            const mapped = new THREE.Quaternion(
              normalized.x,
              normalized.z,
              -normalized.y,
              normalized.w,
            );
            if (
              Number.isFinite(mapped.x) &&
              Number.isFinite(mapped.y) &&
              Number.isFinite(mapped.z) &&
              Number.isFinite(mapped.w)
            ) {
              mapped.normalize();
              if (!gyroBasisForMovesRef.current) {
                gyroBasisForMovesRef.current = mapped.clone().conjugate();
              }
              const relative = mapped.clone().premultiply(gyroBasisForMovesRef.current);
              if (cubeOrientation === "yellow-top") {
                relative
                  .premultiply(yellowTopRotationRef.current)
                  .multiply(yellowTopRotationRef.current);
              }
              gyroRelativeForMovesRef.current.copy(relative);
            }
            emitGyro(normalized);
          }
          break;
        case "BATTERY":
          setBattery(event.batteryLevel);
          break;
        case "DISCONNECT":
          smartCubeDebug("disconnect event");
          clearInitialFaceletsSync();
          initialFaceletsSeenRef.current = false;
          initialFaceletsSyncAttemptsRef.current = 0;
          setStatus("Disconnected");
          setIsConnected(false);
          setShowBluetoothDetails(false);
          gyroBasisForMovesRef.current = null;
          gyroRelativeForMovesRef.current.identity();
          emitConnectionChange(false);
          emitGyro(null);
          break;
        default:
          break;
      }
    });

    if (conn.capabilities.battery) {
      void conn.sendCommand({ type: "REQUEST_BATTERY" });
    }
    if (conn.capabilities.hardware) {
      void conn.sendCommand({ type: "REQUEST_HARDWARE" });
    }
    if (conn.capabilities.facelets) {
      scheduleInitialFaceletsSync(conn, 120);
    }
  }

  useEffect(() => {
    const conn = smartRef.current;
    if (!isConnected || !conn || !conn.capabilities.facelets) {
      return;
    }
    if (liveStateReady) {
      clearInitialFaceletsSync();
      setStatus(`Connected via ${conn.protocol.name}`);
      return;
    }
    scheduleInitialFaceletsSync(conn, initialFaceletsSeenRef.current ? 250 : 120);
  }, [clearInitialFaceletsSync, isConnected, liveStateReady, scheduleInitialFaceletsSync]);

  async function connectUsingSmartCubeApi() {
    const connectOptions = {
      enableAddressSearch: true,
      deviceSelection: "filtered" as const,
      macAddressProvider: customMacAddressProvider,
      onStatus: (message: string) => {
        setStatus(message);
      },
    };

    let conn: SmartCubeConnection;
    try {
      conn = await connectAnySmartCube({
        ...connectOptions,
        deviceName: preferredDeviceName || undefined,
      });
    } catch (error) {
      const isNotFound =
        error instanceof DOMException && error.name === "NotFoundError";
      if (!preferredDeviceName || !isNotFound) {
        throw error;
      }
      // If device name changed or the remembered one is unavailable,
      // retry with generic filtered picker.
      conn = await connectAnySmartCube(connectOptions);
    }

    attachSmartConnection(conn);
  }

  async function connectCube() {
    const blockedReason = webBluetoothBlockReason();
    if (blockedReason) {
      setStatus(blockedReason);
      return;
    }
    try {
      smartCubeDebug("connectCube start", {
        preferredDeviceName,
      });
      setStatus("Opening Bluetooth picker...");
      setDeviceMac("Unknown");
      setBattery(null);
      setOrientation("Waiting for gyro data");
      gyroBasisForMovesRef.current = null;
      gyroRelativeForMovesRef.current.identity();
      emitGyro(null);
      await connectUsingSmartCubeApi();
    } catch (error) {
      smartCubeDebug("connectCube error", error);
      if (isMissingCubeMacError(error)) {
        setStatus(
          "Cube MAC auto-detect failed. Keep only your cube powered nearby and ensure Android Chrome runs on HTTPS.",
        );
        return;
      }

      if (error instanceof TypeError && String(error.message).includes("requestDevice")) {
        setStatus("Web Bluetooth requestDevice is not available in this browser/context. Use Chrome + HTTPS (or localhost).");
        return;
      }

      setStatus(error instanceof Error ? error.message : "Connection failed");
    }
  }

  async function resetCubeState() {
    if (smartRef.current) {
      if (!smartRef.current.capabilities.reset) {
        emitResetLiveState();
      emitGyro(null);
      setOrientation("Waiting for gyro data");
      clearInitialFaceletsSync();
      gyroBasisForMovesRef.current = null;
      gyroRelativeForMovesRef.current.identity();
      setStatus("Cube reset locally (device reset not supported by this protocol)");
        return;
      }
      try {
        await smartRef.current.sendCommand({ type: "REQUEST_RESET" });
        setStatus("Cube state reset to solved");
        emitResetLiveState();
        emitGyro(null);
        setOrientation("Waiting for gyro data");
        clearInitialFaceletsSync();
        gyroBasisForMovesRef.current = null;
        gyroRelativeForMovesRef.current.identity();
        return;
      } catch (error) {
        setStatus(error instanceof Error ? `Reset failed: ${error.message}` : "Reset failed");
        return;
      }
    }

    emitResetLiveState();
    emitGyro(null);
    setOrientation("Waiting for gyro data");
    clearInitialFaceletsSync();
    gyroBasisForMovesRef.current = null;
    gyroRelativeForMovesRef.current.identity();
    setStatus("Cube state reset locally (no device connected)");
  }

  function disconnectCube() {
    if (smartSubscriptionRef.current) {
      smartSubscriptionRef.current.unsubscribe();
      smartSubscriptionRef.current = null;
    }
    void smartRef.current?.disconnect();
    smartRef.current = null;
    clearInitialFaceletsSync();
    initialFaceletsSeenRef.current = false;
    initialFaceletsSyncAttemptsRef.current = 0;
    setStatus("Disconnected");
    setIsConnected(false);
    setShowBluetoothDetails(false);
    gyroBasisForMovesRef.current = null;
    gyroRelativeForMovesRef.current.identity();
    emitConnectionChange(false);
    emitGyro(null);
    setDeviceName("No cube");
    setDeviceMac("Unknown");
    setBattery(null);
    emitResetLiveState();
    setOrientation("Waiting for gyro data");
  }

  const bluetoothBlockedReason = webBluetoothBlockReason();
  const connectDisabled = bluetoothBlockedReason !== null;
  const rankedBestSolves = useMemo(
    () => [...freeLastSolves].sort((a, b) => a.totalMs - b.totalMs).slice(0, 5),
    [freeLastSolves],
  );
  const rankedAverageMs = useMemo(() => {
    if (rankedBestSolves.length === 0) {
      return null;
    }
    const total = rankedBestSolves.reduce((sum, solve) => sum + solve.totalMs, 0);
    return total / rankedBestSolves.length;
  }, [rankedBestSolves]);

  return (
    <section className="smart-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Experimental</p>
          <h2>Smart Cube</h2>
        </div>
        <Radio size={20} />
      </div>
      <div className="connection-grid">
        <button
          className="primary-button"
          onClick={connectCube}
          disabled={connectDisabled}
          title={bluetoothBlockedReason ?? "Connect smart cube"}
        >
          <Bluetooth size={18} />
          Connect cube
        </button>
        <button className="ghost-button" onClick={disconnectCube}>
          <ListRestart size={18} />
          Disconnect
        </button>
        <button className="ghost-button span-2" onClick={resetCubeState}>
          <TimerReset size={18} />
          Reset cube state
        </button>
        <button
          className="ghost-button span-2"
          onClick={() => setShowBluetoothDetails((value) => !value)}
        >
          {showBluetoothDetails ? <EyeOff size={18} /> : <Eye size={18} />}
          {showBluetoothDetails ? "Hide Bluetooth details" : "Show Bluetooth details"}
        </button>
      </div>
      {showBluetoothDetails && (
        <>
          <p className="support-note">
            Bluetooth picker is filtered to supported smart-cube devices.
          </p>
          <div className="status-list">
            <p>
              <span>Support</span>
              {support}
            </p>
            <p>
              <span>Status</span>
              {status}
            </p>
            <p>
              <span>Device</span>
              {deviceName}
            </p>
            <p>
              <span>Device MAC</span>
              {deviceMac}
            </p>
            <p>
              <span>Battery</span>
              {battery === null ? "Unknown" : `${battery}%`}
            </p>
            <p>
              <span>Gyro</span>
              {orientation}
            </p>
          </div>
        </>
      )}
      <div className="alg-block solution smart-best-panel">
        <div className="alg-title">
          <span>Best of Last 5</span>
        </div>
        {rankedBestSolves.length === 0 ? (
          <p>No solves yet.</p>
        ) : (
          <>
            {rankedBestSolves.map((solve, index) => (
              <p key={`${solve.finishedAt}-${index}`}>
                {index + 1}. {formatMs(solve.totalMs)}
              </p>
            ))}
            <p>Average: {rankedAverageMs === null ? "--" : formatMs(rankedAverageMs)}</p>
          </>
        )}
      </div>
    </section>
  );
}

function AlgorithmCard({
  activeCase,
  cubeOrientation,
}: {
  activeCase: AlgorithmCase;
  cubeOrientation: CubeOrientation;
}) {
  const isCross = activeCase.stage === "cross";
  const setupLabel =
    activeCase.stage === "cross"
      ? "Cross setup scramble (from solved)"
      : activeCase.stage === "f2l"
        ? "Training scramble (cross-ready)"
        : activeCase.stage === "oll"
          ? "Training scramble (F2L-ready)"
          : "Training scramble (OLL-ready)";
  const [showSetup, setShowSetup] = useState(true);
  const [showCaseSetup, setShowCaseSetup] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const mainAlg = activeCase.solutions[0];
  const displaySetup = activeCase.setup;
  const displayCaseSetup = activeCase.baseSetup;
  const displaySolution = mainAlg.alg;

  useEffect(() => {
    setShowSolution(false);
    setShowSetup(true);
    setShowCaseSetup(false);
  }, [activeCase.id, activeCase.setup]);

  return (
    <section className="algorithm-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{activeCase.group}</p>
          <h2>{activeCase.name}</h2>
        </div>
        <span className="difficulty">Level {activeCase.difficulty}</span>
      </div>

      <p className="recognition">{activeCase.recognition}</p>

      <div className="alg-block">
        <div className="alg-title">
          <span>{setupLabel}</span>
          <button onClick={() => setShowSetup((value) => !value)}>
            {showSetup ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <code>{showSetup ? displaySetup : "Hidden"}</code>
        <p>
          {isCross
            ? "Generated by exact search for the selected optimal cross move count."
            : "Context is mixed on purpose so each rep stays in CFOP flow instead of resetting to fully solved every time."}
        </p>
      </div>

      {!isCross && (
        <div className="alg-block">
          <div className="alg-title">
            <span>Case-only setup</span>
            <button onClick={() => setShowCaseSetup((value) => !value)}>
              {showCaseSetup ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <code>{showCaseSetup ? displayCaseSetup : "Hidden"}</code>
        </div>
      )}

      <div className="alg-block solution">
        <div className="alg-title">
          <span>{isCross ? "One optimal cross solution" : "Best solution"}</span>
          <button onClick={() => setShowSolution((value) => !value)}>
            {showSolution ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <code>{showSolution ? displaySolution : "Try it first"}</code>
        <p>
          {mainAlg.label} | {mainAlg.source} | {mainAlg.notes}
        </p>
      </div>
    </section>
  );
}

function FreePracticePanel({
  scramble,
  inspectionEnabled,
  inspectionRunning,
  inspectionRemainingMs,
  timerLabel,
  totalElapsedMs,
  stepMarks,
}: {
  scramble: string;
  inspectionEnabled: boolean;
  inspectionRunning: boolean;
  inspectionRemainingMs: number | null;
  timerLabel: string;
  totalElapsedMs: number;
  stepMarks: { crossMs: number | null; f2lMs: number | null; ollMs: number | null };
}) {
  const inspectionText = inspectionEnabled
    ? inspectionRunning
      ? `${Math.max(0, Math.ceil((inspectionRemainingMs ?? 0) / 1000))}s`
      : inspectionRemainingMs === 0
        ? "Done"
        : "Ready"
    : "Unlimited";
  const crossSplit = stepMarks.crossMs;
  const f2lSplit =
    stepMarks.crossMs !== null && stepMarks.f2lMs !== null
      ? Math.max(0, stepMarks.f2lMs - stepMarks.crossMs)
      : null;
  const ollSplit =
    stepMarks.f2lMs !== null && stepMarks.ollMs !== null
      ? Math.max(0, stepMarks.ollMs - stepMarks.f2lMs)
      : null;
  const pllSplit =
    stepMarks.ollMs !== null
      ? Math.max(0, totalElapsedMs - stepMarks.ollMs)
      : null;
  return (
    <section className="algorithm-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Free Practice</p>
          <h2>Random Scramble</h2>
        </div>
        <span className="difficulty">{timerLabel}</span>
      </div>
      <div className="alg-block">
        <div className="alg-title">
          <span>Scramble</span>
        </div>
        <code>{scramble}</code>
      </div>
      <div className="alg-block">
        <div className="alg-title">
          <span>Current Split Marks</span>
        </div>
        <p>Inspection: {inspectionText}</p>
        <p>Cross: {crossSplit === null ? "--" : formatMs(crossSplit)}</p>
        <p>F2L: {f2lSplit === null ? "--" : formatMs(f2lSplit)}</p>
        <p>OLL: {ollSplit === null ? "--" : formatMs(ollSplit)}</p>
        <p>PLL: {pllSplit === null ? "--" : formatMs(pllSplit)}</p>
        <p>Total: {formatMs(totalElapsedMs)}</p>
      </div>
    </section>
  );
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [view, setView] = useState<AppView>("training");
  const [mode, setMode] = useState<AppMode>("trainer");
  const [stage, setStage] = useState<Stage>("cross");
  const [learnStage, setLearnStage] = useState<LearnStage>("oll");
  const [learnSubset, setLearnSubset] = useState<LearningSubsetFilter>("all");
  const [learnProgressFilter, setLearnProgressFilter] =
    useState<LearningProgressFilter>("all");
  const [learnSearch, setLearnSearch] = useState("");
  const [selectedLearnCaseId, setSelectedLearnCaseId] = useState("oll-01");
  const [learningData, setLearningData] = useState<LearningData>(initialLearningData);
  const [customAlgDraft, setCustomAlgDraft] = useState("");
  const [customAlgLabelDraft, setCustomAlgLabelDraft] = useState("Custom");
  const [editingCustomAlgId, setEditingCustomAlgId] = useState<string | null>(null);
  const [trainingSubsetFilter, setTrainingSubsetFilter] =
    useState<LearningSubsetFilter>("all");
  const [cubeOrientation, setCubeOrientation] =
    useState<CubeOrientation>("yellow-top");
  const [cubeSkin, setCubeSkin] = useState<CubeSkin>("classic");
  const [mirrorHintsEnabled, setMirrorHintsEnabled] = useState(true);
  const [smartCubeConnected, setSmartCubeConnected] = useState(false);
  const [smartCubeMoves, setSmartCubeMoves] = useState<string[]>([]);
  const smartCubeMovesRef = useRef<string[]>([]);
  const [smartCubeDisplayMoves, setSmartCubeDisplayMoves] = useState<string[]>([]);
  const [liveSessionMoveCount, setLiveSessionMoveCount] = useState(0);
  const [liveSessionStartMoves, setLiveSessionStartMoves] = useState<string[]>([]);
  const [trainingSessionId, setTrainingSessionId] = useState(0);
  const [virtualSessionStartAlg, setVirtualSessionStartAlg] = useState("");
  const [sessionAwareSetupAlg, setSessionAwareSetupAlg] = useState<string | null>(null);
  const [liveRemainingSetupAlgCanonical, setLiveRemainingSetupAlgCanonical] = useState<string | null>(null);
  const [smartCubeStateBootstrapped, setSmartCubeStateBootstrapped] = useState(false);
  const [smartCubeGyro, setSmartCubeGyro] = useState<GyroQuaternion | null>(null);
  const [smartCubeGyroSession, setSmartCubeGyroSession] = useState(0);
  const [setupGuideSteps, setSetupGuideSteps] = useState<GuideStepInternal[]>([]);
  const [setupGuideComplete, setSetupGuideComplete] = useState(false);
  const [attemptStartPattern, setAttemptStartPattern] = useState<KPattern | null>(null);
  const [demoPlayerEnabled, setDemoPlayerEnabled] = useState(false);
  const [movesAfterSetup, setMovesAfterSetup] = useState(0);
  const [attemptFinished, setAttemptFinished] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStartAt, setTimerStartAt] = useState<number | null>(null);
  const [timerElapsedMs, setTimerElapsedMs] = useState(0);
  const [freeInspectionEnabled, setFreeInspectionEnabled] = useState(true);
  const [freeInspectionRunning, setFreeInspectionRunning] = useState(false);
  const [freeInspectionRemainingMs, setFreeInspectionRemainingMs] = useState<number | null>(null);
  const [freeScramble, setFreeScramble] = useState(generateRandomScramble);
  const [freeStepMarks, setFreeStepMarks] = useState<{
    crossMs: number | null;
    f2lMs: number | null;
    ollMs: number | null;
  }>({
    crossMs: null,
    f2lMs: null,
    ollMs: null,
  });
  const [freeLastSolves, setFreeLastSolves] = useState<FreeSolveRecord[]>([]);
  const freeSolveLoggedRef = useRef(false);
  const freeLastSplitMoveCountRef = useRef(0);
  const [cubeKpuzzle, setCubeKpuzzle] = useState<CubeKpuzzle | null>(null);
  const setupGuideCompleteRef = useRef(false);
  const timerRunningRef = useRef(false);
  const timerStartAtRef = useRef<number | null>(null);
  const attemptFinishedRef = useRef(false);
  const autoAdvanceTimeoutRef = useRef<number | null>(null);
  const prevSetupGuideCompleteRef = useRef(false);
  const prevAttemptFinishedRef = useRef(false);
  const pendingFaceletsBootstrapRef = useRef(false);
  const pendingFaceletsValueRef = useRef<string | null>(null);
  const bootstrappingFaceletsRef = useRef(false);
  const solvedFaceletsBootstrapStreakRef = useRef(0);
  const queuedPracticeCaseIdRef = useRef<string | null>(null);
  const [difficulty, setDifficulty] = useState<number | "all">(1);
  const [selectedCaseId, setSelectedCaseId] = useState("cross-1");
  const [showPanelSolution, setShowPanelSolution] = useState(false);
  const [contextAlg, setContextAlg] = useState("");
  const [crossRefresh, setCrossRefresh] = useState(0);
  const recentCrossSetupsByDifficultyRef = useRef<Record<number, string[]>>({});
  const [crossGenerated, setCrossGenerated] = useState<{
    setup: string;
    solution: string;
    loading: boolean;
    error: string | null;
  }>({
    setup: "",
    solution: "",
    loading: false,
    error: null,
  });
  const shouldKeepScreenAwake = smartCubeConnected || timerRunning;

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", themeMode);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cfopTheme", themeMode);
    }
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in window.navigator)) {
      return;
    }

    void window.navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch(() => {
      // The app still runs normally if service worker registration is unavailable.
    });
  }, []);

  useEffect(() => {
    if (cubeSkin === "f2l" && mirrorHintsEnabled) {
      setMirrorHintsEnabled(false);
    }
  }, [cubeSkin, mirrorHintsEnabled]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(learningData));
    }
  }, [learningData]);

  useEffect(() => {
    smartCubeMovesRef.current = smartCubeMoves;
  }, [smartCubeMoves]);

  useEffect(() => {
    timerRunningRef.current = timerRunning;
  }, [timerRunning]);

  useEffect(() => {
    timerStartAtRef.current = timerStartAt;
  }, [timerStartAt]);

  useEffect(() => {
    attemptFinishedRef.current = attemptFinished;
  }, [attemptFinished]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const navigatorWithWakeLock = navigator as NavigatorWithWakeLock;
    if (!navigatorWithWakeLock.wakeLock?.request) {
      return;
    }

    let wakeLock: WakeLockSentinelLike | null = null;
    let disposed = false;

    const releaseWakeLock = async () => {
      const current = wakeLock;
      wakeLock = null;
      if (!current || current.released) {
        return;
      }
      try {
        await current.release();
      } catch {
        // Browsers may auto-release the lock when the tab hides or power state changes.
      }
    };

    const requestWakeLock = async () => {
      if (
        disposed ||
        !shouldKeepScreenAwake ||
        document.visibilityState !== "visible" ||
        wakeLock
      ) {
        return;
      }
      try {
        wakeLock = await navigatorWithWakeLock.wakeLock.request("screen");
        wakeLock.addEventListener?.("release", () => {
          wakeLock = null;
        });
      } catch {
        // Ignore unsupported/denied cases and retry after the next user interaction.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      } else {
        void releaseWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (shouldKeepScreenAwake) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [shouldKeepScreenAwake]);

  const isFreeMode = mode === "free";
  const stageCases = useMemo(
    () =>
      casesForStage(stage)
        .filter((item) =>
          trainingSubsetFilter === "all"
            ? true
            : item.subsets?.includes(trainingSubsetFilter),
        )
        .map((item) => mergeCaseWithLearning(item, recordForCase(learningData, item.id))),
    [learningData, stage, trainingSubsetFilter],
  );
  const availableDifficulties = useMemo(
    () => [...new Set(stageCases.map((item) => item.difficulty))].sort((a, b) => a - b),
    [stageCases],
  );
  const filteredCases = useMemo(
    () =>
      stageCases.filter((item) =>
        difficulty === "all" ? true : item.difficulty === difficulty,
      ),
    [difficulty, stageCases],
  );
  const activeCase =
    filteredCases.find((item) => item.id === selectedCaseId) ??
    filteredCases[0] ??
    stageCases[0];
  const learnCases = useMemo(
    () =>
      allCases
        .filter((item) => item.stage === learnStage)
        .filter((item) =>
          learnSubset === "all" ? true : item.subsets?.includes(learnSubset),
        )
        .filter((item) => {
          const state = recordForCase(learningData, item.id).state;
          return learnProgressFilter === "all" || state === learnProgressFilter;
        })
        .filter((item) => {
          const query = learnSearch.trim().toLowerCase();
          if (!query) return true;
          return [
            item.name,
            item.group,
            item.recognition,
            ...(item.recognitionTags ?? []),
            ...item.solutions.map((solutionItem) => solutionItem.alg),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);
        })
        .map((item) => mergeCaseWithLearning(item, recordForCase(learningData, item.id))),
    [learnProgressFilter, learnSearch, learnStage, learnSubset, learningData],
  );
  const selectedLearnCase = useMemo(
    () =>
      learnCases.find((item) => item.id === selectedLearnCaseId) ??
      learnCases[0] ??
      mergeCaseWithLearning(
        allCases.find((item) => item.stage === learnStage) ?? allCases[0]!,
        recordForCase(learningData, selectedLearnCaseId),
      ),
    [learnCases, learnStage, learningData, selectedLearnCaseId],
  );
  const selectedLearnRecord = recordForCase(learningData, selectedLearnCase.id);
  const allLearnableCases = useMemo(
    () => allCases.filter((item) => item.stage === "f2l" || item.stage === "oll" || item.stage === "pll"),
    [],
  );
  const selectedPracticeCases = useMemo(
    () =>
      allLearnableCases
        .filter((item) => recordForCase(learningData, item.id).selectedForPractice)
        .map((item) => mergeCaseWithLearning(item, recordForCase(learningData, item.id))),
    [allLearnableCases, learningData],
  );
  const weakestPracticeCase = useMemo(() => {
    if (selectedPracticeCases.length === 0) {
      return null;
    }
    const ranked = [...selectedPracticeCases].sort(
      (a, b) => timingScore(recordForCase(learningData, b.id)) - timingScore(recordForCase(learningData, a.id)),
    );
    const weakestBand = ranked.slice(0, Math.min(3, ranked.length));
    return weakestBand[Math.floor(Math.random() * weakestBand.length)] ?? ranked[0];
  }, [learningData, selectedPracticeCases]);
  const progressTotals = useMemo(
    () => learningStats(allLearnableCases, learningData),
    [allLearnableCases, learningData],
  );
  const subsetOptions = useMemo(() => {
    if (stage === "oll") {
      return [
        { id: "all" as const, label: "All OLL" },
        { id: "2look-oll" as const, label: "2-look" },
      ];
    }
    if (stage === "pll") {
      return [
        { id: "all" as const, label: "All PLL" },
        { id: "2look-pll" as const, label: "2-look" },
      ];
    }
    return [{ id: "all" as const, label: "All" }];
  }, [stage]);
  const isCross = stage === "cross";
  const crossDifficulty = difficulty === "all" ? 1 : difficulty;

  const activeCaseWithTrainingSetup = useMemo(() => {
    if (isCross) {
      const setup = crossGenerated.setup;
      const solution = crossGenerated.solution;
      return {
        ...activeCase,
        name: `${crossDifficulty} move cross`,
        recognition: crossGenerated.loading
          ? `Generating exact ${crossDifficulty}-move cross case...`
          : crossGenerated.error
            ? `Generator error: ${crossGenerated.error}`
            : `Generated state with exact optimal cross distance ${crossDifficulty}.`,
        baseSetup: setup,
        setup,
        solutions: [
          {
            alg: solution,
            label: "Optimal",
            source: "Cross distance search",
            notes: "One optimal HTM cross solution",
          },
        ],
      };
    }

    const normalizedCaseSetup = stripCubeRotations(activeCase.baseSetup);
    const setup = joinAlgs([contextAlg, normalizedCaseSetup]);
    return { ...activeCase, setup };
  }, [activeCase, contextAlg, crossDifficulty, crossGenerated, isCross]);

  useEffect(() => {
    setShowPanelSolution(false);
  }, [activeCaseWithTrainingSetup.id, activeCaseWithTrainingSetup.setup]);

  const solution = activeCaseWithTrainingSetup.solutions[0].alg;
  const solutionForPattern = useMemo(
    () => stripCubeRotations(solution),
    [solution],
  );
  const targetSetupAlgCanonical = isFreeMode ? freeScramble : activeCaseWithTrainingSetup.setup;
  const expectedPostAttemptAlg = useMemo(
    () => simplifyAlgText(joinAlgs([targetSetupAlgCanonical, solutionForPattern])),
    [solutionForPattern, targetSetupAlgCanonical],
  );
  const setupAlgForOrientation = useMemo(
    () => remapAlgForOrientation(activeCaseWithTrainingSetup.setup, cubeOrientation),
    [activeCaseWithTrainingSetup.setup, cubeOrientation],
  );
  const solutionAlgForOrientation = useMemo(
    () => remapAlgForOrientation(solution, cubeOrientation),
    [solution, cubeOrientation],
  );
  const smartCubeAlgCanonical = useMemo(
    () => smartCubeMoves.join(" "),
    [smartCubeMoves],
  );
  const smartCubeAlgForOrientation = useMemo(
    () => smartCubeMoves.map((move) => remapMoveForOrientation(move, cubeOrientation)).join(" "),
    [cubeOrientation, smartCubeMoves],
  );
  const liveSessionStartAlgCanonical = useMemo(
    () => liveSessionStartMoves.join(" "),
    [liveSessionStartMoves],
  );
  const targetSetupAlgForOrientation = isFreeMode ? freeScramble : setupAlgForOrientation;
  const setupGuideAlg = useMemo(
    () => {
      const canonical =
        smartCubeConnected &&
        !isFreeMode &&
        movesAfterSetup === 0 &&
        !setupGuideComplete &&
        liveRemainingSetupAlgCanonical !== null
          ? liveRemainingSetupAlgCanonical
          : (sessionAwareSetupAlg ?? targetSetupAlgCanonical);
      const raw = remapAlgForOrientation(canonical, cubeOrientation);
      return simplifyAlgText(smartCubeConnected ? stripCubeRotations(raw) : raw);
    },
    [
      cubeOrientation,
      isFreeMode,
      liveRemainingSetupAlgCanonical,
      movesAfterSetup,
      sessionAwareSetupAlg,
      setupGuideComplete,
      smartCubeConnected,
      targetSetupAlgCanonical,
    ],
  );
  const demoPlayerAvailable = smartCubeConnected && !isFreeMode && setupGuideComplete;
  const isDemoViewer = demoPlayerAvailable && demoPlayerEnabled;
  const isLiveViewer = smartCubeConnected && !isDemoViewer;
  const viewerTitle = isDemoViewer
    ? "Solution Demo"
    : isLiveViewer
    ? "Live Smart Cube"
    : isFreeMode
      ? "Free Practice"
      : activeCaseWithTrainingSetup.name;
  // In live mode we must use setup (not alg) so the cube shows current state immediately.
  const viewerSetup = isDemoViewer
    ? smartCubeConnected
      ? smartCubeAlgForOrientation
      : targetSetupAlgForOrientation
    : isLiveViewer
    ? smartCubeAlgForOrientation
    : targetSetupAlgForOrientation;
  const viewerAlg = isDemoViewer || (!isLiveViewer && !isFreeMode) ? solutionAlgForOrientation : "";
  const viewerContextMoves = isLiveViewer ? liveSessionMoveCount : isFreeMode ? 0 : moveCount(contextAlg);
  const setupGuideStepViews = useMemo(
    () => {
      const full = setupGuideSteps.map(guideStepView);
      if (full.length <= 19) {
        return full;
      }
      const firstPending = full.findIndex((step) => step.state !== "done");
      if (firstPending > 0) {
        return setupGuideSteps.slice(firstPending, firstPending + 19).map(guideStepView);
      }
      return full.slice(0, 19);
    },
    [setupGuideSteps],
  );
  const timerLabel = useMemo(() => {
    if (isFreeMode && freeInspectionEnabled && freeInspectionRunning) {
      return `I ${Math.max(0, Math.ceil((freeInspectionRemainingMs ?? 0) / 1000))}s`;
    }
    return formatMs(timerElapsedMs);
  }, [freeInspectionEnabled, freeInspectionRemainingMs, freeInspectionRunning, isFreeMode, timerElapsedMs]);
  const freeInspectionText = freeInspectionEnabled
    ? freeInspectionRunning
      ? `${Math.max(0, Math.ceil((freeInspectionRemainingMs ?? 0) / 1000))}s`
      : freeInspectionRemainingMs === 0
        ? "Done"
        : "Ready"
    : "Unlimited";
  const freeCurrentSplits = useMemo(() => {
    const cross = freeStepMarks.crossMs;
    const f2l =
      freeStepMarks.crossMs !== null && freeStepMarks.f2lMs !== null
        ? Math.max(0, freeStepMarks.f2lMs - freeStepMarks.crossMs)
        : null;
    const oll =
      freeStepMarks.f2lMs !== null && freeStepMarks.ollMs !== null
        ? Math.max(0, freeStepMarks.ollMs - freeStepMarks.f2lMs)
        : null;
    const pll =
      freeStepMarks.ollMs !== null
        ? Math.max(0, timerElapsedMs - freeStepMarks.ollMs)
        : null;
    return { cross, f2l, oll, pll, total: timerElapsedMs };
  }, [freeStepMarks.crossMs, freeStepMarks.f2lMs, freeStepMarks.ollMs, timerElapsedMs]);
  const totalCaseCount = useMemo(
    () => stages.reduce((sum, item) => sum + casesForStage(item).length, 0),
    [],
  );
  const sessionBestMs = useMemo(() => {
    if (freeLastSolves.length === 0) {
      return null;
    }
    return Math.min(...freeLastSolves.map((solve) => solve.totalMs));
  }, [freeLastSolves]);
  const recentSolves = useMemo(
    () => [...freeLastSolves].sort((a, b) => b.finishedAt - a.finishedAt),
    [freeLastSolves],
  );
  const best5Solves = useMemo(
    () => [...freeLastSolves].sort((a, b) => a.totalMs - b.totalMs).slice(0, 5),
    [freeLastSolves],
  );
  const best5AverageMs = useMemo(() => {
    if (best5Solves.length === 0) {
      return null;
    }
    const total = best5Solves.reduce((sum, solve) => sum + solve.totalMs, 0);
    return total / best5Solves.length;
  }, [best5Solves]);
  const averageSplitMs = useMemo(() => {
    if (freeLastSolves.length === 0) {
      return null;
    }
    const totals = freeLastSolves.reduce(
      (acc, solve) => {
        acc.cross += solve.crossMs;
        acc.f2l += solve.f2lMs;
        acc.oll += solve.ollMs;
        acc.pll += solve.pllMs;
        acc.total += solve.totalMs;
        return acc;
      },
      { cross: 0, f2l: 0, oll: 0, pll: 0, total: 0 },
    );
    return {
      cross: totals.cross / freeLastSolves.length,
      f2l: totals.f2l / freeLastSolves.length,
      oll: totals.oll / freeLastSolves.length,
      pll: totals.pll / freeLastSolves.length,
      total: totals.total / freeLastSolves.length,
    };
  }, [freeLastSolves]);
  const currentLivePattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(smartCubeAlgCanonical) : null),
    [cubeKpuzzle, smartCubeAlgCanonical],
  );
  const solvedPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern() : null),
    [cubeKpuzzle],
  );
  const targetSetupAlgForPattern = useMemo(
    () => stripCubeRotations(targetSetupAlgCanonical),
    [targetSetupAlgCanonical],
  );
  const setupTargetPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(targetSetupAlgForPattern) : null),
    [cubeKpuzzle, targetSetupAlgForPattern],
  );
  const solvedTargetPattern = useMemo(
    () => {
      if (isFreeMode) {
        return solvedPattern;
      }
      return setupTargetPattern
        ? setupTargetPattern.applyAlg(solutionForPattern)
        : null;
    },
    [isFreeMode, setupTargetPattern, solutionForPattern, solvedPattern],
  );
  const requiredSolvedSlots = useMemo(() => {
    if (!setupTargetPattern || !solvedTargetPattern || !solvedPattern) {
      return [] as OrbitSlot[];
    }
    return collectNewlySolvedSlots(
      setupTargetPattern as unknown as { patternData: Record<string, any> },
      solvedTargetPattern as unknown as { patternData: Record<string, any> },
      solvedPattern as unknown as { patternData: Record<string, any> },
    );
  }, [setupTargetPattern, solvedTargetPattern, solvedPattern]);
  const f2lRequiredSolvedSlots = useMemo(
    () =>
      requiredSolvedSlots.filter(
        (slot) =>
          (slot.orbit === "EDGES" && F2L_EDGE_SLOTS.includes(slot.index as (typeof F2L_EDGE_SLOTS)[number])) ||
          (slot.orbit === "CORNERS" && F2L_CORNER_SLOTS.includes(slot.index as (typeof F2L_CORNER_SLOTS)[number])),
      ),
    [requiredSolvedSlots],
  );
  const f2lCaseUnsolvedSlots = useMemo(() => {
    const baselinePattern = attemptStartPattern ?? setupTargetPattern;
    if (!baselinePattern || !solvedPattern) {
      return [] as OrbitSlot[];
    }
    return [
      ...collectUnsolvedSlots(
        baselinePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
        "EDGES",
        F2L_EDGE_SLOTS,
      ),
      ...collectUnsolvedSlots(
        baselinePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
        "CORNERS",
        F2L_CORNER_SLOTS,
      ),
    ];
  }, [attemptStartPattern, setupTargetPattern, solvedPattern]);

  const handleSmartCubeMove = useCallback((move: { raw: string; display: string }) => {
    setSmartCubeMoves((current) => [...current, move.raw].slice(-500));
    setLiveSessionMoveCount((current) => current + 1);
    setSmartCubeDisplayMoves((current) =>
      current.length >= 19 ? [move.display] : [...current, move.display],
    );
    if (setupGuideCompleteRef.current) {
      if (isFreeMode && freeInspectionRunning) {
        setFreeInspectionRunning(false);
        setFreeInspectionRemainingMs(0);
      }
      if (!timerRunningRef.current && !attemptFinishedRef.current) {
        const startedAt = performance.now();
        timerStartAtRef.current = startedAt;
        timerRunningRef.current = true;
        setTimerStartAt(startedAt);
        setTimerElapsedMs(0);
        setTimerRunning(true);
      }
      setMovesAfterSetup((current) => current + 1);
      return;
    }
    setLiveRemainingSetupAlgCanonical((current) => {
      const base = current ?? sessionAwareSetupAlg ?? targetSetupAlgCanonical;
      const inverseMove = new Alg(move.raw).invert().toString();
      return simplifyAlgText(joinAlgs([inverseMove, base]));
    });
    return;
  }, [freeInspectionRunning, isFreeMode, sessionAwareSetupAlg, targetSetupAlgCanonical]);

  const handleSmartCubeGyro = useCallback((quaternion: GyroQuaternion | null) => {
    setSmartCubeGyro(quaternion);
  }, []);

  const hardResetLiveCubeState = useCallback(() => {
    setSmartCubeMoves([]);
    smartCubeMovesRef.current = [];
    setLiveSessionStartMoves([]);
    setVirtualSessionStartAlg("");
    setSmartCubeStateBootstrapped(false);
    setLiveSessionMoveCount(0);
    setSmartCubeDisplayMoves([]);
    setSessionAwareSetupAlg(null);
    setLiveRemainingSetupAlgCanonical(null);
    setTrainingSessionId((current) => current + 1);
    setSetupGuideComplete(false);
    setupGuideCompleteRef.current = false;
    prevSetupGuideCompleteRef.current = false;
    setAttemptStartPattern(null);
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    attemptFinishedRef.current = false;
    setTimerRunning(false);
    timerRunningRef.current = false;
    setTimerStartAt(null);
    timerStartAtRef.current = null;
    setTimerElapsedMs(0);
    setFreeInspectionRunning(false);
    setFreeInspectionRemainingMs(null);
    setFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
    freeSolveLoggedRef.current = false;
    freeLastSplitMoveCountRef.current = 0;
  }, []);

  const resetTrainingSessionFromCurrentState = useCallback(() => {
    const currentMoves = [...smartCubeMovesRef.current];
    setLiveSessionStartMoves(currentMoves);
    setSmartCubeStateBootstrapped(currentMoves.length > 0);
    setLiveSessionMoveCount(0);
    setSmartCubeDisplayMoves([]);
    setSessionAwareSetupAlg(null);
    setLiveRemainingSetupAlgCanonical(null);
    setTrainingSessionId((current) => current + 1);
    setSetupGuideComplete(false);
    setupGuideCompleteRef.current = false;
    prevSetupGuideCompleteRef.current = false;
    setAttemptStartPattern(null);
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    attemptFinishedRef.current = false;
    setTimerRunning(false);
    timerRunningRef.current = false;
    setTimerStartAt(null);
    timerStartAtRef.current = null;
    setTimerElapsedMs(0);
    setFreeInspectionRunning(false);
    setFreeInspectionRemainingMs(null);
    setFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
    freeSolveLoggedRef.current = false;
    freeLastSplitMoveCountRef.current = 0;
  }, []);

  const attemptFaceletsBootstrap = useCallback(() => {
    if (
      !smartCubeConnected ||
      !pendingFaceletsBootstrapRef.current ||
      bootstrappingFaceletsRef.current ||
      !cubeKpuzzle
    ) {
      return;
    }
    const facelets = pendingFaceletsValueRef.current;
    if (!facelets) {
      return;
    }
    const faceletsLookSolved = facelets === SOLVED_FACELET;
    smartCubeDebug("bootstrap start", {
      preview: maskFacelets(facelets),
      faceletsLookSolved,
      solvedBootstrapStreak: solvedFaceletsBootstrapStreakRef.current,
    });
    const pattern = patternFromFacelets(facelets, cubeKpuzzle);
    if (!pattern) {
      smartCubeDebug("bootstrap parse failed");
      return;
    }
    bootstrappingFaceletsRef.current = true;
    void experimentalSolve3x3x3IgnoringCenters(pattern)
      .then((solveToSolved) => {
        const fromSolved = new Alg(stripCubeRotations(solveToSolved.toString())).invert().toString();
        const nextMoves = splitAlgTokens(fromSolved).slice(-500);
        const looksSolvedAfterBootstrap = nextMoves.length === 0;
        if (faceletsLookSolved && looksSolvedAfterBootstrap) {
          solvedFaceletsBootstrapStreakRef.current += 1;
          smartCubeDebug("bootstrap solved facelets candidate", {
            streak: solvedFaceletsBootstrapStreakRef.current,
            solveToSolved: solveToSolved.toString(),
          });
          if (solvedFaceletsBootstrapStreakRef.current < 3) {
            setSmartCubeStateBootstrapped(false);
            return;
          }
        } else {
          solvedFaceletsBootstrapStreakRef.current = 0;
        }
        smartCubeDebug("bootstrap success", {
          solveToSolved: solveToSolved.toString(),
          fromSolved,
          moveCount: nextMoves.length,
          faceletsLookSolved,
        });
        setSmartCubeMoves(nextMoves);
        smartCubeMovesRef.current = nextMoves;
        setLiveSessionStartMoves([...nextMoves]);
        setSmartCubeStateBootstrapped(true);
        setLiveSessionMoveCount(0);
        setSmartCubeDisplayMoves([]);
        setSessionAwareSetupAlg(null);
        setLiveRemainingSetupAlgCanonical(null);
        setTrainingSessionId((current) => current + 1);
        setSetupGuideComplete(false);
        setupGuideCompleteRef.current = false;
        prevSetupGuideCompleteRef.current = false;
        setAttemptStartPattern(null);
        setMovesAfterSetup(0);
        setAttemptFinished(false);
        attemptFinishedRef.current = false;
        setTimerRunning(false);
        timerRunningRef.current = false;
        setTimerStartAt(null);
        timerStartAtRef.current = null;
        setTimerElapsedMs(0);
        freeLastSplitMoveCountRef.current = 0;
      })
      .catch((error) => {
        smartCubeDebug("bootstrap failed", error);
        solvedFaceletsBootstrapStreakRef.current = 0;
        setSmartCubeStateBootstrapped(false);
      })
      .finally(() => {
        pendingFaceletsBootstrapRef.current = false;
        bootstrappingFaceletsRef.current = false;
      });
  }, [cubeKpuzzle, smartCubeConnected]);

  const handleSmartCubeFacelets = useCallback((facelets: string) => {
    smartCubeDebug("handle facelets", {
      preview: maskFacelets(facelets),
    });
    pendingFaceletsValueRef.current = facelets;
    attemptFaceletsBootstrap();
  }, [attemptFaceletsBootstrap]);

  useEffect(() => {
    attemptFaceletsBootstrap();
  }, [attemptFaceletsBootstrap, cubeKpuzzle]);

  const handleSmartCubeConnectionChange = useCallback((connected: boolean) => {
    setSmartCubeConnected(connected);
    if (connected) {
      setSmartCubeStateBootstrapped(false);
      solvedFaceletsBootstrapStreakRef.current = 0;
      pendingFaceletsBootstrapRef.current = true;
      pendingFaceletsValueRef.current = null;
      setSmartCubeGyroSession((current) => current + 1);
      // Keep current visual state until we bootstrap from FACELETS, then swap to real cube state.
      resetTrainingSessionFromCurrentState();
      return;
    }
    pendingFaceletsBootstrapRef.current = false;
    pendingFaceletsValueRef.current = null;
    setSmartCubeStateBootstrapped(false);
    solvedFaceletsBootstrapStreakRef.current = 0;
    setSmartCubeGyro(null);
    hardResetLiveCubeState();
  }, [hardResetLiveCubeState, resetTrainingSessionFromCurrentState]);

  const handleSmartCubeResetLiveState = useCallback(() => {
    pendingFaceletsBootstrapRef.current = false;
    pendingFaceletsValueRef.current = null;
    setSmartCubeStateBootstrapped(false);
    solvedFaceletsBootstrapStreakRef.current = 0;
    hardResetLiveCubeState();
    setSmartCubeGyro(null);
    setSmartCubeGyroSession((current) => current + 1);
  }, [hardResetLiveCubeState]);

  const handleStageChange = useCallback(
    (nextStage: Stage) => {
      const modeSwitch = mode !== "trainer";
      if (!modeSwitch && nextStage === stage) {
        return;
      }
      resetTrainingSessionFromCurrentState();
      setMode("trainer");
      setStage(nextStage);
    },
    [mode, resetTrainingSessionFromCurrentState, stage],
  );

  const handleFreeMode = useCallback(() => {
    if (mode === "free") {
      return;
    }
    resetTrainingSessionFromCurrentState();
    setMode("free");
    setFreeScramble(generateRandomScramble());
  }, [mode, resetTrainingSessionFromCurrentState]);

  const handleNewFreeScramble = useCallback(() => {
    resetTrainingSessionFromCurrentState();
    setFreeScramble(generateRandomScramble());
  }, [resetTrainingSessionFromCurrentState]);

  const handleDifficultyChange = useCallback(
    (nextDifficulty: number | "all") => {
      if (nextDifficulty === difficulty) {
        return;
      }
      resetTrainingSessionFromCurrentState();
      setDifficulty(nextDifficulty);
    },
    [difficulty, resetTrainingSessionFromCurrentState],
  );

  const handleCaseChange = useCallback(
    (nextCaseId: string) => {
      if (nextCaseId === selectedCaseId) {
        return;
      }
      resetTrainingSessionFromCurrentState();
      setSelectedCaseId(nextCaseId);
    },
    [resetTrainingSessionFromCurrentState, selectedCaseId],
  );

  const updateLearningRecord = useCallback(
    (caseId: string, updater: (record: LearningCaseRecord) => LearningCaseRecord) => {
      setLearningData((current) => {
        const nextRecord = updater(recordForCase(current, caseId));
        return {
          ...current,
          [caseId]: {
            ...nextRecord,
            selectedForPractice: nextRecord.selectedForPractice === true,
            practiceStats: nextRecord.practiceStats,
            customAlgorithms: nextRecord.customAlgorithms.map((item) => ({
              ...item,
              alg: item.alg.trim(),
              label: item.label.trim() || "Custom",
            })),
          },
        };
      });
    },
    [],
  );

  const cycleLearningState = useCallback(
    (caseId: string) => {
      updateLearningRecord(caseId, (record) => ({
        ...record,
        state: nextLearningState(record.state),
      }));
    },
    [updateLearningRecord],
  );

  const setLearningState = useCallback(
    (caseId: string, state: LearningProgressState) => {
      updateLearningRecord(caseId, (record) => ({ ...record, state }));
    },
    [updateLearningRecord],
  );

  const saveCustomAlgorithm = useCallback(() => {
    const alg = customAlgDraft.trim();
    if (!alg || !selectedLearnCase) {
      return;
    }
    const label = customAlgLabelDraft.trim() || "Custom";
    updateLearningRecord(selectedLearnCase.id, (record) => {
      const duplicate = record.customAlgorithms.some(
        (item) => item.alg === alg && item.id !== editingCustomAlgId,
      );
      if (duplicate) {
        return record;
      }
      if (editingCustomAlgId) {
        return {
          ...record,
          customAlgorithms: record.customAlgorithms.map((item) =>
            item.id === editingCustomAlgId ? { ...item, alg, label } : item,
          ),
        };
      }
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      return {
        ...record,
        customAlgorithms: [...record.customAlgorithms, { id, alg, label }],
        primaryAlgorithmId: record.primaryAlgorithmId ?? id,
      };
    });
    setCustomAlgDraft("");
    setCustomAlgLabelDraft("Custom");
    setEditingCustomAlgId(null);
  }, [
    customAlgDraft,
    customAlgLabelDraft,
    editingCustomAlgId,
    selectedLearnCase,
    updateLearningRecord,
  ]);

  const editCustomAlgorithm = useCallback((algorithm: CustomAlgorithm) => {
    setEditingCustomAlgId(algorithm.id);
    setCustomAlgDraft(algorithm.alg);
    setCustomAlgLabelDraft(algorithm.label);
  }, []);

  const removeCustomAlgorithm = useCallback(
    (caseId: string, algorithmId: string) => {
      updateLearningRecord(caseId, (record) => {
        const customAlgorithms = record.customAlgorithms.filter((item) => item.id !== algorithmId);
        return {
          ...record,
          customAlgorithms,
          primaryAlgorithmId:
            record.primaryAlgorithmId === algorithmId ? undefined : record.primaryAlgorithmId,
        };
      });
      if (editingCustomAlgId === algorithmId) {
        setEditingCustomAlgId(null);
        setCustomAlgDraft("");
        setCustomAlgLabelDraft("Custom");
      }
    },
    [editingCustomAlgId, updateLearningRecord],
  );

  const setPrimaryAlgorithm = useCallback(
    (caseId: string, algorithmId?: string) => {
      updateLearningRecord(caseId, (record) => ({
        ...record,
        primaryAlgorithmId: algorithmId,
      }));
    },
    [updateLearningRecord],
  );

  const togglePracticeSelection = useCallback(
    (caseId: string) => {
      updateLearningRecord(caseId, (record) => ({
        ...record,
        selectedForPractice: !record.selectedForPractice,
      }));
    },
    [updateLearningRecord],
  );

  const selectVisiblePracticeCases = useCallback(() => {
    const visibleIds = new Set(learnCases.map((item) => item.id));
    setLearningData((current) => {
      const next = { ...current };
      for (const caseId of visibleIds) {
        next[caseId] = {
          ...recordForCase(current, caseId),
          selectedForPractice: true,
        };
      }
      return next;
    });
  }, [learnCases]);

  const selectOnlyLearningPracticeCases = useCallback(() => {
    const learningIds = new Set(
      learnCases
        .filter((item) => recordForCase(learningData, item.id).state === "learning")
        .map((item) => item.id),
    );
    setLearningData((current) => {
      const next = { ...current };
      for (const item of allLearnableCases) {
        const record = recordForCase(current, item.id);
        next[item.id] = {
          ...record,
          selectedForPractice: learningIds.has(item.id),
        };
      }
      return next;
    });
  }, [allLearnableCases, learnCases, learningData]);

  const clearPracticeSelection = useCallback(() => {
    setLearningData((current) => {
      const next = { ...current };
      for (const item of allLearnableCases) {
        const record = recordForCase(current, item.id);
        if (record.selectedForPractice) {
          next[item.id] = {
            ...record,
            selectedForPractice: false,
          };
        }
      }
      return next;
    });
  }, [allLearnableCases]);

  const logPracticeTiming = useCallback(
    (caseId: string, totalMs: number) => {
      updateLearningRecord(caseId, (record) => {
        const previous = record.practiceStats;
        const attempts = (previous?.attempts ?? 0) + 1;
        const previousAverage = previous?.averageMs ?? previous?.lastMs ?? totalMs;
        return {
          ...record,
          practiceStats: {
            attempts,
            bestMs: previous?.bestMs === undefined ? totalMs : Math.min(previous.bestMs, totalMs),
            averageMs:
              previous && previous.attempts > 0
                ? ((previousAverage * previous.attempts) + totalMs) / attempts
                : totalMs,
            lastMs: totalMs,
            lastPracticedAt: Date.now(),
          },
        };
      });
    },
    [updateLearningRecord],
  );

  const applyPracticeCase = useCallback(
    (practiceCase: AlgorithmCase) => {
      resetTrainingSessionFromCurrentState();
      queuedPracticeCaseIdRef.current = practiceCase.stage === stage ? null : practiceCase.id;
      setView("training");
      setMode("trainer");
      setStage(practiceCase.stage);
      setTrainingSubsetFilter("all");
      setDifficulty("all");
      setSelectedCaseId(practiceCase.id);
    },
    [resetTrainingSessionFromCurrentState, stage],
  );

  const practiceWeakestSelectedCase = useCallback(() => {
    if (selectedPracticeCases.length === 0) {
      return;
    }
    const ranked = [...selectedPracticeCases].sort(
      (a, b) => timingScore(recordForCase(learningData, b.id)) - timingScore(recordForCase(learningData, a.id)),
    );
    const weakestBand = ranked.slice(0, Math.min(3, ranked.length));
    const next = weakestBand[Math.floor(Math.random() * weakestBand.length)] ?? ranked[0];
    applyPracticeCase(next);
  }, [applyPracticeCase, learningData, selectedPracticeCases]);

  useEffect(() => {
    setTrainingSubsetFilter("all");
    const nextDifficulty = stage === "cross" ? 1 : "all";
    setDifficulty(nextDifficulty);
    const queuedPracticeCaseId = queuedPracticeCaseIdRef.current;
    const queuedCase = queuedPracticeCaseId
      ? casesForStage(stage).find((item) => item.id === queuedPracticeCaseId)
      : undefined;
    queuedPracticeCaseIdRef.current = null;
    const nextCase = queuedCase ?? casesForStage(stage).find((item) =>
      nextDifficulty === "all" ? true : item.difficulty === nextDifficulty,
    );
    setSelectedCaseId(nextCase?.id ?? casesForStage(stage)[0].id);
  }, [stage]);

  useEffect(() => {
    if (!learnCases.some((item) => item.id === selectedLearnCaseId) && learnCases[0]) {
      setSelectedLearnCaseId(learnCases[0].id);
    }
  }, [learnCases, selectedLearnCaseId]);

  useEffect(() => {
    setCustomAlgDraft("");
    setCustomAlgLabelDraft("Custom");
    setEditingCustomAlgId(null);
  }, [selectedLearnCase.id]);

  useEffect(() => {
    if (!filteredCases.some((item) => item.id === selectedCaseId)) {
      setSelectedCaseId(filteredCases[0]?.id ?? stageCases[0]?.id);
    }
  }, [filteredCases, selectedCaseId, stageCases]);

  useEffect(() => {
    if (stage === "cross") {
      setContextAlg("");
      return;
    }
    setContextAlg(buildContextForStage(stage));
  }, [stage, selectedCaseId]);

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

  useEffect(() => {
    let cancelled = false;
    void cube3x3x3.kpuzzle().then((kpuzzle) => {
      if (!cancelled) {
        setCubeKpuzzle(kpuzzle);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isFreeMode) {
      setSessionAwareSetupAlg(null);
      return;
    }

    if (!smartCubeConnected) {
      const normalizeToSolved =
        virtualSessionStartAlg.trim().length > 0
          ? new Alg(virtualSessionStartAlg).invert().toString()
          : "";
      setSessionAwareSetupAlg(
        simplifyAlgText(joinAlgs([normalizeToSolved, targetSetupAlgCanonical])),
      );
      return;
    }
    let cancelled = false;

    const applyFallback = () => {
      const normalizeToSolved =
        liveSessionStartAlgCanonical.trim().length > 0
          ? new Alg(liveSessionStartAlgCanonical).invert().toString()
          : "";
      const canonical = simplifyAlgText(
        joinAlgs([normalizeToSolved, targetSetupAlgCanonical]),
      );
      setSessionAwareSetupAlg(
        canonical,
      );
    };

    if (!cubeKpuzzle) {
      applyFallback();
      return;
    }

    const sessionStartPattern = cubeKpuzzle.defaultPattern().applyAlg(liveSessionStartAlgCanonical);
    // Always normalize from the actual current cube state, then apply the
    // target setup. Stage shortcuts can drift from the intended exact case.
    void experimentalSolve3x3x3IgnoringCenters(sessionStartPattern)
      .then((solveToSolved) => {
        if (cancelled) {
          return;
        }
        const canonical = simplifyAlgText(
          joinAlgs([stripCubeRotations(solveToSolved.toString()), targetSetupAlgCanonical]),
        );
        setSessionAwareSetupAlg(
          canonical,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        applyFallback();
      });

    return () => {
      cancelled = true;
    };
  }, [
    cubeKpuzzle,
    isFreeMode,
    liveSessionStartAlgCanonical,
    targetSetupAlgCanonical,
    cubeOrientation,
    smartCubeConnected,
    trainingSessionId,
    virtualSessionStartAlg,
  ]);

  useEffect(() => {
    if (!smartCubeConnected) {
      setLiveSessionStartMoves([]);
      return;
    }
    setVirtualSessionStartAlg("");
  }, [smartCubeConnected]);

  useEffect(() => {
    if (!smartCubeConnected || isFreeMode) {
      setLiveRemainingSetupAlgCanonical(null);
      return;
    }
    if (movesAfterSetup > 0 || setupGuideComplete) {
      return;
    }
    setLiveRemainingSetupAlgCanonical(sessionAwareSetupAlg ?? targetSetupAlgCanonical);
  }, [
    isFreeMode,
    movesAfterSetup,
    sessionAwareSetupAlg,
    setupGuideComplete,
    smartCubeConnected,
    targetSetupAlgCanonical,
    trainingSessionId,
  ]);

  useEffect(() => {
    const nextSteps = buildGuideStepsFromAlg(setupGuideAlg);
    setSetupGuideSteps(nextSteps);
    const complete = nextSteps.length === 0;
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
    prevSetupGuideCompleteRef.current = complete;
    setAttemptStartPattern(null);
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    attemptFinishedRef.current = false;
    setTimerRunning(false);
    timerRunningRef.current = false;
    setTimerStartAt(null);
    timerStartAtRef.current = null;
    setTimerElapsedMs(0);
    setDemoPlayerEnabled(false);
    freeLastSplitMoveCountRef.current = 0;
  }, [setupGuideAlg, smartCubeGyroSession, trainingSessionId]);

  useEffect(() => {
    const complete =
      setupGuideSteps.length > 0 &&
      setupGuideSteps.every((step) => step.doneAtoms >= step.atoms.length);
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
  }, [setupGuideSteps]);

  useEffect(() => {
    const wasComplete = prevSetupGuideCompleteRef.current;
    if (!wasComplete && setupGuideComplete) {
      // Start counting live turns for the attempt only after setup is done.
      setLiveSessionMoveCount(0);
      setMovesAfterSetup(0);
      setAttemptFinished(false);
      setFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
      freeSolveLoggedRef.current = false;
      if (isFreeMode) {
        if (freeInspectionEnabled) {
          setFreeInspectionRemainingMs(FREE_INSPECTION_MS);
          setFreeInspectionRunning(true);
        } else {
          setFreeInspectionRemainingMs(null);
          setFreeInspectionRunning(false);
        }
      }
    }
    if (!setupGuideComplete) {
      setFreeInspectionRunning(false);
      setFreeInspectionRemainingMs(null);
    }
    prevSetupGuideCompleteRef.current = setupGuideComplete;
  }, [freeInspectionEnabled, isFreeMode, setupGuideComplete]);

  useEffect(() => {
    if (
      !setupGuideComplete &&
      currentLivePattern &&
      setupTargetPattern &&
      currentLivePattern.isIdentical(setupTargetPattern)
    ) {
      setSetupGuideComplete(true);
      setupGuideCompleteRef.current = true;
    }
  }, [setupGuideComplete, currentLivePattern, setupTargetPattern]);

  useEffect(() => {
    if (!setupGuideComplete || movesAfterSetup > 0 || !currentLivePattern || attemptStartPattern) {
      return;
    }
    setAttemptStartPattern(currentLivePattern);
  }, [attemptStartPattern, currentLivePattern, movesAfterSetup, setupGuideComplete]);

  useEffect(() => {
    if (!demoPlayerAvailable) {
      setDemoPlayerEnabled(false);
    }
  }, [demoPlayerAvailable]);

  useEffect(() => {
    if (
      !smartCubeConnected ||
      !setupGuideComplete ||
      timerRunning ||
      attemptFinished ||
      movesAfterSetup === 0
    ) {
      return;
    }
    const startedAt = performance.now();
    setTimerStartAt(startedAt);
    setTimerRunning(true);
  }, [smartCubeConnected, setupGuideComplete, timerRunning, attemptFinished, movesAfterSetup]);

  useEffect(() => {
    if (!isFreeMode || !freeInspectionRunning || freeInspectionRemainingMs === null) {
      return;
    }
    const interval = window.setInterval(() => {
      setFreeInspectionRemainingMs((current) => {
        if (current === null) {
          return null;
        }
        const next = current - 20;
        if (next <= 0) {
          setFreeInspectionRunning(false);
          return 0;
        }
        return next;
      });
    }, 20);
    return () => {
      window.clearInterval(interval);
    };
  }, [freeInspectionRemainingMs, freeInspectionRunning, isFreeMode]);

  useEffect(() => {
    if (!isFreeMode || !setupGuideComplete || movesAfterSetup > 0 || timerRunning || attemptFinished) {
      return;
    }
    if (!freeInspectionEnabled) {
      setFreeInspectionRunning(false);
      setFreeInspectionRemainingMs(null);
      return;
    }
    if (!freeInspectionRunning) {
      setFreeInspectionRemainingMs(FREE_INSPECTION_MS);
      setFreeInspectionRunning(true);
    }
  }, [
    attemptFinished,
    freeInspectionEnabled,
    freeInspectionRunning,
    isFreeMode,
    movesAfterSetup,
    setupGuideComplete,
    timerRunning,
  ]);

  useEffect(() => {
    prevAttemptFinishedRef.current = attemptFinished;
  }, [attemptFinished]);

  useEffect(() => {
    if (!timerRunning || timerStartAt === null) {
      return;
    }
    const interval = window.setInterval(() => {
      setTimerElapsedMs(performance.now() - timerStartAt);
    }, 20);
    return () => {
      window.clearInterval(interval);
    };
  }, [timerRunning, timerStartAt]);

  useEffect(() => {
    if (!isFreeMode || !timerRunning || !currentLivePattern || !solvedPattern || timerStartAt === null) {
      return;
    }
    if (freeLastSplitMoveCountRef.current === movesAfterSetup) {
      return;
    }
    const elapsed = performance.now() - timerStartAt;
    setFreeStepMarks((current) => {
      const next = { ...current };
      let changed = false;
      if (
        next.crossMs === null &&
        isCrossSolved(
          currentLivePattern as unknown as { patternData: Record<string, any> },
          solvedPattern as unknown as { patternData: Record<string, any> },
        )
      ) {
        next.crossMs = elapsed;
        changed = true;
      } else if (
        next.f2lMs === null &&
        next.crossMs !== null &&
        isF2LSolved(
          currentLivePattern as unknown as { patternData: Record<string, any> },
          solvedPattern as unknown as { patternData: Record<string, any> },
        )
      ) {
        next.f2lMs = elapsed;
        changed = true;
      } else if (
        next.ollMs === null &&
        next.f2lMs !== null &&
        isOllSolved(
          currentLivePattern as unknown as { patternData: Record<string, any> },
          solvedPattern as unknown as { patternData: Record<string, any> },
        )
      ) {
        next.ollMs = elapsed;
        changed = true;
      }
      if (changed) {
        freeLastSplitMoveCountRef.current = movesAfterSetup;
      }
      return changed ? next : current;
    });
  }, [currentLivePattern, isFreeMode, movesAfterSetup, solvedPattern, timerRunning, timerStartAt]);

  useEffect(() => {
    if (!timerRunning || !currentLivePattern) {
      return;
    }
    if (!smartCubeConnected) {
      return;
    }
    const exactMatch = solvedTargetPattern
      ? currentLivePattern.isIdentical(solvedTargetPattern)
      : false;
    const freeModeGoalMatch =
      isFreeMode &&
      solvedPattern &&
      currentLivePattern.isIdentical(solvedPattern);
    const crossGoalMatch =
      !isFreeMode &&
      stage === "cross" &&
      solvedPattern &&
      isCrossSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
      );
    const crossTargetGoalMatch =
      !isFreeMode &&
      stage === "cross" &&
      solvedTargetPattern &&
      isCrossSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedTargetPattern as unknown as { patternData: Record<string, any> },
      );
    const f2lGoalMatch =
      !isFreeMode &&
      stage === "f2l" &&
      solvedPattern &&
      (
        ((attemptStartPattern || setupTargetPattern) &&
          countSolvedF2LPairs(
            currentLivePattern as unknown as { patternData: Record<string, any> },
            solvedPattern as unknown as { patternData: Record<string, any> },
          ) >
            countSolvedF2LPairs(
              (attemptStartPattern ?? setupTargetPattern) as unknown as { patternData: Record<string, any> },
              solvedPattern as unknown as { patternData: Record<string, any> },
            )) ||
        (f2lRequiredSolvedSlots.length > 0 &&
          areSlotsSolved(
            currentLivePattern as unknown as { patternData: Record<string, any> },
            solvedPattern as unknown as { patternData: Record<string, any> },
            f2lRequiredSolvedSlots,
          )) ||
        (f2lCaseUnsolvedSlots.length > 0 &&
          f2lCaseUnsolvedSlots.some(
            (slot) =>
              slot.orbit === "EDGES" &&
              isSlotSolved(
                currentLivePattern as unknown as { patternData: Record<string, any> },
                solvedPattern as unknown as { patternData: Record<string, any> },
                slot.orbit,
                slot.index,
              ),
          ) &&
          f2lCaseUnsolvedSlots.some(
            (slot) =>
              slot.orbit === "CORNERS" &&
              isSlotSolved(
                currentLivePattern as unknown as { patternData: Record<string, any> },
                solvedPattern as unknown as { patternData: Record<string, any> },
                slot.orbit,
                slot.index,
              ),
          ))
      );
    const ollGoalMatch =
      !isFreeMode &&
      stage === "oll" &&
      solvedPattern &&
      isOllSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
      );
    const pllGoalMatch =
      !isFreeMode &&
      stage === "pll" &&
      solvedPattern &&
      currentLivePattern.isIdentical(solvedPattern);
    const stageGoalMatch =
      !isFreeMode &&
      stage !== "cross" &&
      stage !== "f2l" &&
      requiredSolvedSlots.length > 0 &&
      solvedPattern &&
      areSlotsSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
        requiredSolvedSlots,
      );
    if (
      freeModeGoalMatch ||
      (!isFreeMode &&
        (exactMatch ||
          crossGoalMatch ||
          crossTargetGoalMatch ||
          f2lGoalMatch ||
          ollGoalMatch ||
          pllGoalMatch ||
          stageGoalMatch))
    ) {
      const totalMs = timerStartAt !== null ? performance.now() - timerStartAt : timerElapsedMs;
      if (!isFreeMode && activeCaseWithTrainingSetup.stage !== "cross") {
        logPracticeTiming(activeCaseWithTrainingSetup.id, totalMs);
      }
      if (isFreeMode && !freeSolveLoggedRef.current) {
        const crossAt = freeStepMarks.crossMs ?? totalMs;
        const f2lAt = freeStepMarks.f2lMs ?? totalMs;
        const ollAt = freeStepMarks.ollMs ?? totalMs;
        setFreeLastSolves((current) => [
          {
            totalMs,
            crossMs: crossAt,
            f2lMs: Math.max(0, f2lAt - crossAt),
            ollMs: Math.max(0, ollAt - f2lAt),
            pllMs: Math.max(0, totalMs - ollAt),
            finishedAt: Date.now(),
          },
          ...current,
        ].slice(0, 5));
        freeSolveLoggedRef.current = true;
      }
      setTimerRunning(false);
      timerRunningRef.current = false;
      setAttemptFinished(true);
      attemptFinishedRef.current = true;
      setTimerElapsedMs(totalMs);
    }
  }, [
    freeStepMarks.crossMs,
    freeStepMarks.f2lMs,
    freeStepMarks.ollMs,
    isFreeMode,
    smartCubeConnected,
    timerRunning,
    currentLivePattern,
    solvedTargetPattern,
    stage,
    timerElapsedMs,
    timerStartAt,
    requiredSolvedSlots,
    f2lRequiredSolvedSlots,
    f2lCaseUnsolvedSlots,
    attemptStartPattern,
    setupTargetPattern,
    solvedPattern,
    activeCaseWithTrainingSetup.id,
    activeCaseWithTrainingSetup.stage,
    logPracticeTiming,
  ]);

  useEffect(() => {
    if (view !== "training" || smartCubeConnected) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();

      if (timerRunning) {
        const totalMs = timerStartAt !== null ? performance.now() - timerStartAt : timerElapsedMs;
        if (!isFreeMode && activeCaseWithTrainingSetup.stage !== "cross") {
          logPracticeTiming(activeCaseWithTrainingSetup.id, totalMs);
        }
        setTimerRunning(false);
        timerRunningRef.current = false;
        setTimerElapsedMs(totalMs);
        setAttemptFinished(true);
        attemptFinishedRef.current = true;
        return;
      }

      setAttemptFinished(false);
      attemptFinishedRef.current = false;
      setTimerElapsedMs(0);
      const startedAt = performance.now();
      setTimerStartAt(startedAt);
      timerStartAtRef.current = startedAt;
      setTimerRunning(true);
      timerRunningRef.current = true;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeCaseWithTrainingSetup.id,
    activeCaseWithTrainingSetup.stage,
    isFreeMode,
    logPracticeTiming,
    smartCubeConnected,
    timerElapsedMs,
    timerRunning,
    timerStartAt,
    view,
  ]);

  function randomTrainingCase() {
    resetTrainingSessionFromCurrentState();
    if (stage === "cross") {
      setCrossRefresh((value) => value + 1);
      return;
    }
    const candidates = filteredCases.length > 0 ? filteredCases : stageCases;
    const next =
      candidates[Math.floor(Math.random() * candidates.length)] ??
      pickRandomCase(stage, difficulty === "all" ? undefined : difficulty);
    setSelectedCaseId(next.id);
  }

  const repeatCurrentTrainingCase = useCallback(() => {
    setVirtualSessionStartAlg(expectedPostAttemptAlg);
    resetTrainingSessionFromCurrentState();
    if (stage === "cross") {
      setCrossRefresh((value) => value + 1);
      return;
    }
    setContextAlg(buildContextForStage(stage));
  }, [expectedPostAttemptAlg, resetTrainingSessionFromCurrentState, stage]);

  useEffect(() => {
    if (autoAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
  }, [attemptFinished, isFreeMode, view]);

  if (view === "training") {
    return (
      <main className="app-shell-training">
        <header className="training-topbar">
          <a className="brand-lockup" href="/" aria-label="CFOP Trainer home">
            <span className="brand-mark">c</span>
            <span>
              <strong>cfop trainer</strong>
              <em>Level up your cubing</em>
            </span>
          </a>
          <nav className="app-nav app-nav-horizontal" aria-label="App pages">
            <button onClick={() => setView("home")}>
              <House size={16} />
              Home
            </button>
            <button className="active" onClick={() => setView("training")}>
              <BookOpen size={16} />
              Training
            </button>
            <button onClick={() => setView("learn")}>
              <BookOpen size={16} />
              Learn
            </button>
            <button onClick={() => setView("dashboard")}>
              <BarChart3 size={16} />
              Dashboard
            </button>
          </nav>
          <button
            className="theme-toggle"
            onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
            title={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        <section className="trainer-layout trainer-layout-standalone">
          <aside className="control-panel">
            <nav className="stage-tabs training-stage-tabs" aria-label="CFOP stages">
              <button
                className={isFreeMode ? "active" : ""}
                onClick={handleFreeMode}
              >
                Free
              </button>
              {stages.map((item) => (
                <button
                  key={item}
                  className={!isFreeMode && stage === item ? "active" : ""}
                  onClick={() => handleStageChange(item)}
                >
                  {stageMeta[item].title}
                </button>
              ))}
            </nav>

            <div className="section-heading">
              <div>
                <p className="eyebrow">{isFreeMode ? "Solve Trainer" : stageMeta[stage].caseLabel}</p>
                <h2>{isFreeMode ? "Free Practice" : stageMeta[stage].title}</h2>
              </div>
              <BookOpen size={20} />
            </div>
            <p className="muted">
              {isFreeMode
                ? "Drill full solves with inspection, split timing, and rolling history."
                : stageMeta[stage].subtitle}
            </p>

            <label className="field-label" htmlFor="cube-orientation">
              Cube orientation
            </label>
            <div className="segmented" id="cube-orientation">
              <button
                className={cubeOrientation === "yellow-top" ? "active" : ""}
                onClick={() => setCubeOrientation("yellow-top")}
              >
                Yellow top
              </button>
              <button
                className={cubeOrientation === "white-top" ? "active" : ""}
                onClick={() => setCubeOrientation("white-top")}
              >
                White top
              </button>
            </div>
            <label className="field-label" htmlFor="cube-skin">
              Cube skin
            </label>
            <div className="segmented" id="cube-skin">
              <button
                className={cubeSkin === "f2l" ? "active" : ""}
                onClick={() => setCubeSkin("f2l")}
              >
                F2L
              </button>
              <button
                className={cubeSkin === "classic" ? "active" : ""}
                onClick={() => setCubeSkin("classic")}
              >
                Classic
              </button>
            </div>
            <label className="field-label" htmlFor="mirror-hints">
              Mirror hints
            </label>
            <div className="segmented" id="mirror-hints">
              <button
                className={cubeSkin !== "f2l" && mirrorHintsEnabled ? "active" : ""}
                disabled={cubeSkin === "f2l"}
                onClick={() => setMirrorHintsEnabled(true)}
              >
                On
              </button>
              <button
                className={cubeSkin === "f2l" || !mirrorHintsEnabled ? "active" : ""}
                disabled={cubeSkin === "f2l"}
                onClick={() => setMirrorHintsEnabled(false)}
              >
                Off
              </button>
            </div>

            {isFreeMode ? (
              <>
                <label className="field-label" htmlFor="inspection-enabled">
                  Inspection
                </label>
                <div className="segmented" id="inspection-enabled">
                  <button
                    className={freeInspectionEnabled ? "active" : ""}
                    onClick={() => setFreeInspectionEnabled(true)}
                  >
                    15s
                  </button>
                  <button
                    className={!freeInspectionEnabled ? "active" : ""}
                    onClick={() => setFreeInspectionEnabled(false)}
                  >
                    Unlimited
                  </button>
                </div>
                <div className="action-row">
                  <button
                    className="primary-button"
                    onClick={handleNewFreeScramble}
                  >
                    <Shuffle size={18} />
                    New scramble
                  </button>
                </div>
                {smartCubeConnected && (
                  <div className="alg-block">
                    <div className="alg-title">
                      <span>Current Splits</span>
                    </div>
                    <CfopSplitBar
                      cross={freeCurrentSplits.cross}
                      f2l={freeCurrentSplits.f2l}
                      oll={freeCurrentSplits.oll}
                      pll={freeCurrentSplits.pll}
                    />
                    <p>Inspection: {freeInspectionText}</p>
                    <p>Total: {formatMs(freeCurrentSplits.total)}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="difficulty">
                  Difficulty
                </label>
                <div className="segmented" id="difficulty">
                  {stage !== "cross" && (
                    <button
                      className={difficulty === "all" ? "active" : ""}
                      onClick={() => handleDifficultyChange("all")}
                    >
                      All
                    </button>
                  )}
                  {availableDifficulties.map((level) => (
                    <button
                      key={level}
                      className={difficulty === level ? "active" : ""}
                      onClick={() => handleDifficultyChange(level)}
                    >
                      {stage === "cross" ? `${level}` : `L${level}`}
                    </button>
                  ))}
                </div>

                {(stage === "oll" || stage === "pll") && (
                  <>
                    <label className="field-label" htmlFor="training-subset">
                      Subset
                    </label>
                    <div className="segmented" id="training-subset">
                      {subsetOptions.map((option) => (
                        <button
                          key={option.id}
                          className={trainingSubsetFilter === option.id ? "active" : ""}
                          onClick={() => {
                            resetTrainingSessionFromCurrentState();
                            setTrainingSubsetFilter(option.id);
                            setDifficulty("all");
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {stage !== "cross" && (
                  <>
                    <label className="field-label" htmlFor="case-select">
                      Case
                    </label>
                    <select
                      id="case-select"
                      value={activeCase.id}
                      onChange={(event) => handleCaseChange(event.target.value)}
                    >
                      {filteredCases.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <div className="action-row">
                  <button
                    className="primary-button"
                    onClick={randomTrainingCase}
                    disabled={stage === "cross" && crossGenerated.loading}
                  >
                    <Shuffle size={18} />
                    {stage === "cross"
                      ? crossGenerated.loading
                        ? "Generating"
                        : "New cross case"
                      : "Random case"}
                  </button>
                </div>
                <div className="alg-block solution solution-at-bottom">
                  <div className="alg-title">
                    <span>Best Solution</span>
                    <button onClick={() => setShowPanelSolution((value) => !value)}>
                      {showPanelSolution ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <code>{showPanelSolution ? solutionAlgForOrientation : "Try it first"}</code>
                  {showPanelSolution && (
                    <p>{activeCaseWithTrainingSetup.solutions[0]?.source ?? "CFOP reference"}</p>
                  )}
                </div>
              </>
            )}
          </aside>

          <div className="main-column main-column-free">
            <CubeViewer
              title={viewerTitle}
              setup={viewerSetup}
              alg={viewerAlg}
              contextMoves={viewerContextMoves}
              headlineAlg={setupGuideAlg}
              timerInHeadline={isFreeMode}
              headlineTimerActive={isFreeMode && (timerRunning || freeInspectionRunning)}
              cubeOrientation={cubeOrientation}
              cubeSkin={cubeSkin}
              mirrorHintsEnabled={mirrorHintsEnabled}
              hideControls={smartCubeConnected ? !isDemoViewer : isFreeMode}
              liveMoves={smartCubeDisplayMoves}
              guideSteps={setupGuideStepViews}
              showLiveMoves={smartCubeConnected}
              demoPlayerAvailable={demoPlayerAvailable}
              demoPlayerEnabled={demoPlayerEnabled}
              onDemoPlayerEnabledChange={setDemoPlayerEnabled}
              onDemoPlaybackFinished={() => setDemoPlayerEnabled(false)}
              timerLabel={timerLabel}
              isTimerRunning={timerRunning}
              isLive={isLiveViewer}
              gyroQuaternion={smartCubeConnected ? smartCubeGyro : null}
              gyroSession={smartCubeGyroSession}
              orientationNotice={
                !isFreeMode
                  ? `Trainer setup notation follows selected orientation (${cubeOrientation === "yellow-top" ? "Yellow top" : "White top"}).`
                  : null
              }
            />
          </div>

          <SmartCubePanel
            onMove={handleSmartCubeMove}
            onGyro={handleSmartCubeGyro}
            onFacelets={handleSmartCubeFacelets}
            onConnectionChange={handleSmartCubeConnectionChange}
            onResetLiveState={handleSmartCubeResetLiveState}
            liveStateReady={smartCubeStateBootstrapped}
            cubeOrientation={cubeOrientation}
            freeLastSolves={freeLastSolves}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="training-topbar">
        <a className="brand-lockup" href="/" aria-label="CFOP Trainer home">
          <span className="brand-mark">c</span>
          <span>
            <strong>cfop trainer</strong>
            <em>Level up your cubing</em>
          </span>
        </a>
        <nav className="app-nav app-nav-horizontal" aria-label="App pages">
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => setView("home")}
          >
            <House size={16} />
            Home
          </button>
          <button onClick={() => setView("training")}>
            <BookOpen size={16} />
            Training
          </button>
          <button
            className={view === "learn" ? "active" : ""}
            onClick={() => setView("learn")}
          >
            <BookOpen size={16} />
            Learn
          </button>
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => setView("dashboard")}
          >
            <BarChart3 size={16} />
            Dashboard
          </button>
        </nav>
        <button
          className="theme-toggle"
          onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
          title={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <section className="app-workspace">
        {view === "home" && (
          <section className="home-page">
            <header className="topbar">
              <div>
                <p className="eyebrow">Smart Cube App</p>
                <h1>Connect & train your CFOP solves.</h1>
                <p className="hero-copy">
                  Guided setup drills, live cube tracking, session timing, and algorithm practice in one focused workspace.
                </p>
              </div>
            </header>
            <section className="home-hero-panel">
              <div>
                <p className="eyebrow">Playground Ready</p>
                <h2>Train CFOP with Smart Cube tracking in one focused workspace.</h2>
                <p>
                  Use dedicated setup drills or free-play solves with inspection, split timing, and live cube sync.
                </p>
                <div className="action-row">
                  <button className="primary-button" onClick={() => setView("training")}>
                    Open training
                  </button>
                  <button className="ghost-button" onClick={() => setView("dashboard")}>
                    View dashboard
                  </button>
                </div>
              </div>
              <div className="home-hero-stats">
                <p>
                  <span>Case Library</span>
                  <strong>{totalCaseCount}</strong>
                </p>
                <p>
                  <span>Smart Cube</span>
                  <strong>{smartCubeConnected ? "Connected" : "Offline"}</strong>
                </p>
                <p>
                  <span>Best Solve</span>
                  <strong>{sessionBestMs === null ? "--" : formatMs(sessionBestMs)}</strong>
                </p>
              </div>
            </section>
            <section className="home-grid">
              <article className="metric-card">
                <span>Start Training</span>
                <strong>Live Practice</strong>
                <p>Open dedicated training layout with smart-cube setup guide and timer.</p>
                <div className="action-row">
                  <button className="primary-button" onClick={() => setView("training")}>
                    Open training
                  </button>
                </div>
              </article>
              <article className="metric-card">
                <span>Detailed Stats</span>
                <strong>Dashboard</strong>
                <p>Review best-of-5 ranking, average splits, and your most recent solves.</p>
                <div className="action-row">
                  <button className="ghost-button" onClick={() => setView("dashboard")}>
                    Open dashboard
                  </button>
                </div>
              </article>
              <article className="metric-card">
                <span>Case Library</span>
                <strong>{totalCaseCount}</strong>
                <p>Cross, F2L, OLL and PLL drills ready for deliberate practice.</p>
              </article>
              <article className="metric-card">
                <span>Smart Cube</span>
                <strong>{smartCubeConnected ? "Connected" : "Offline"}</strong>
                <p>{sessionBestMs === null ? "Pair to track solves." : `Best solve ${formatMs(sessionBestMs)}`}</p>
              </article>
            </section>
          </section>
        )}

        {view === "learn" && (
          <section className="learn-page">
            <header className="topbar">
              <div>
                <p className="eyebrow">Learning</p>
                <h1>Build your algorithm library.</h1>
                <p className="hero-copy">
                  Track unknown, learning, and learned cases locally, then customize the algorithms you want to drill.
                </p>
              </div>
              <div className="learn-summary">
                <p>
                  <span>Unknown</span>
                  <strong>{progressTotals.unknown}</strong>
                </p>
                <p>
                  <span>Learning</span>
                  <strong>{progressTotals.learning}</strong>
                </p>
                <p>
                  <span>Learned</span>
                  <strong>{progressTotals.learned}</strong>
                </p>
              </div>
            </header>

            <section className="learn-layout">
              <aside className="learn-sidebar">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Filters</p>
                    <h2>Case Set</h2>
                  </div>
                </div>
                <label className="field-label" htmlFor="learn-stage">
                  Algset
                </label>
                <div className="segmented" id="learn-stage">
                  {(["f2l", "oll", "pll"] as const).map((item) => (
                    <button
                      key={item}
                      className={learnStage === item ? "active" : ""}
                      onClick={() => {
                        setLearnStage(item);
                        setLearnSubset("all");
                        setLearnSearch("");
                      }}
                    >
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>

                <label className="field-label" htmlFor="learn-subset">
                  Subset
                </label>
                <div className="segmented" id="learn-subset">
                  <button
                    className={learnSubset === "all" ? "active" : ""}
                    onClick={() => setLearnSubset("all")}
                  >
                    All
                  </button>
                  {learnStage === "oll" && (
                    <button
                      className={learnSubset === "2look-oll" ? "active" : ""}
                      onClick={() => setLearnSubset("2look-oll")}
                    >
                      2-look
                    </button>
                  )}
                  {learnStage === "pll" && (
                    <button
                      className={learnSubset === "2look-pll" ? "active" : ""}
                      onClick={() => setLearnSubset("2look-pll")}
                    >
                      2-look
                    </button>
                  )}
                </div>

                <label className="field-label" htmlFor="learn-progress">
                  Progress
                </label>
                <div className="segmented" id="learn-progress">
                  {(["all", "unknown", "learning", "learned"] as const).map((state) => (
                    <button
                      key={state}
                      className={learnProgressFilter === state ? "active" : ""}
                      onClick={() => setLearnProgressFilter(state)}
                    >
                      {state === "all" ? "All" : state}
                    </button>
                  ))}
                </div>

                <label className="field-label" htmlFor="learn-search">
                  Search
                </label>
                <input
                  className="text-input"
                  id="learn-search"
                  placeholder="Name, shape, or alg"
                  value={learnSearch}
                  onChange={(event) => setLearnSearch(event.target.value)}
                />

                <div className="alg-block practice-queue-block">
                  <div className="alg-title">
                    <span>Practice Queue</span>
                  </div>
                  <p>{selectedPracticeCases.length} selected for weakest-first drilling.</p>
                  <p>
                    Next focus:{" "}
                    {weakestPracticeCase
                      ? `${weakestPracticeCase.name} (${timingStatsLabel(recordForCase(learningData, weakestPracticeCase.id))})`
                      : "Select cases to start."}
                  </p>
                  <div className="practice-action-grid">
                    <button onClick={selectVisiblePracticeCases}>Select all shown</button>
                    <button onClick={selectOnlyLearningPracticeCases}>Only learning</button>
                    <button onClick={clearPracticeSelection}>Clear</button>
                    <button
                      className="primary-button"
                      onClick={practiceWeakestSelectedCase}
                      disabled={selectedPracticeCases.length === 0}
                    >
                      Practice weakest
                    </button>
                  </div>
                </div>
              </aside>

              <section className="learn-grid-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">{learnCases.length} cases</p>
                    <h2>{learnStage.toUpperCase()} Library</h2>
                  </div>
                </div>
                <div className="learn-case-grid">
                  {learnCases.map((item) => {
                    const record = recordForCase(learningData, item.id);
                    return (
                      <article
                        className={`learn-case-card ${record.state} ${
                          selectedLearnCase.id === item.id ? "selected" : ""
                        } ${record.selectedForPractice ? "queued" : ""}`}
                        key={item.id}
                      >
                        <div
                          className="learn-case-main"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedLearnCaseId(item.id);
                            cycleLearningState(item.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedLearnCaseId(item.id);
                              cycleLearningState(item.id);
                            }
                          }}
                          title="Click to cycle progress"
                        >
                          <CasePreview activeCase={item} cubeOrientation={cubeOrientation} compact />
                          <span>{item.name}</span>
                          <strong>{record.state}</strong>
                          <small>{item.group}</small>
                          <small>{timingStatsLabel(record)}</small>
                        </div>
                        <button
                          className="learn-pick-toggle"
                          onClick={() => togglePracticeSelection(item.id)}
                        >
                          {record.selectedForPractice ? "Selected" : "Select for practice"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>

              <aside className="learn-detail-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">{selectedLearnCase.group}</p>
                    <h2>{selectedLearnCase.name}</h2>
                  </div>
                </div>
                <CasePreview activeCase={selectedLearnCase} cubeOrientation={cubeOrientation} />
                <div className="practice-detail-strip">
                  <span>{timingStatsLabel(selectedLearnRecord)}</span>
                  <button onClick={() => togglePracticeSelection(selectedLearnCase.id)}>
                    {selectedLearnRecord.selectedForPractice ? "Remove from practice" : "Add to practice"}
                  </button>
                </div>
                <div className="learn-state-row">
                  {(["unknown", "learning", "learned"] as const).map((state) => (
                    <button
                      key={state}
                      className={selectedLearnRecord.state === state ? "active" : ""}
                      onClick={() => setLearningState(selectedLearnCase.id, state)}
                    >
                      {state}
                    </button>
                  ))}
                </div>
                <div className="alg-block">
                  <div className="alg-title">
                    <span>Default Algorithm</span>
                    <button onClick={() => setPrimaryAlgorithm(selectedLearnCase.id, undefined)}>
                      Use
                    </button>
                  </div>
                  <code>{selectedLearnCase.solutions[selectedLearnRecord.primaryAlgorithmId ? 1 : 0]?.alg ?? selectedLearnCase.solutions[0].alg}</code>
                  <p>{selectedLearnCase.recognition}</p>
                </div>

                <div className="alg-block">
                  <div className="alg-title">
                    <span>Custom Algorithms</span>
                  </div>
                  {selectedLearnRecord.customAlgorithms.length === 0 ? (
                    <p>No custom algorithms yet.</p>
                  ) : (
                    selectedLearnRecord.customAlgorithms.map((algorithm) => (
                      <div className="custom-alg-row" key={algorithm.id}>
                        <code>{algorithm.alg}</code>
                        <span>{algorithm.label}</span>
                        <div>
                          <button onClick={() => setPrimaryAlgorithm(selectedLearnCase.id, algorithm.id)}>
                            Use
                          </button>
                          <button onClick={() => editCustomAlgorithm(algorithm)}>Edit</button>
                          <button onClick={() => removeCustomAlgorithm(selectedLearnCase.id, algorithm.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="alg-block">
                  <div className="alg-title">
                    <span>{editingCustomAlgId ? "Edit Algorithm" : "Add Algorithm"}</span>
                  </div>
                  <input
                    className="text-input"
                    value={customAlgLabelDraft}
                    onChange={(event) => setCustomAlgLabelDraft(event.target.value)}
                    placeholder="Label"
                  />
                  <textarea
                    className="text-input alg-textarea"
                    value={customAlgDraft}
                    onChange={(event) => setCustomAlgDraft(event.target.value)}
                    placeholder="R U R' U'"
                  />
                  <div className="action-row">
                    <button className="primary-button" onClick={saveCustomAlgorithm}>
                      {editingCustomAlgId ? "Save" : "Add"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setEditingCustomAlgId(null);
                        setCustomAlgDraft("");
                        setCustomAlgLabelDraft("Custom");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </aside>
            </section>
          </section>
        )}

        {view === "dashboard" && (
          <section className="dashboard-page">
            <header className="topbar">
              <div>
                <p className="eyebrow">Statistics</p>
                <h1>Session Dashboard</h1>
                <p className="hero-copy">
                  Ranked best times, split averages, and latest solve history from your free-practice sessions.
                </p>
              </div>
            </header>

            <section className="dashboard-strip" aria-label="Session overview">
              <article className="metric-card">
                <span>Best Solve</span>
                <strong>{sessionBestMs === null ? "--" : formatMs(sessionBestMs)}</strong>
                <p>Fastest total solve in recent sessions.</p>
              </article>
              <article className="metric-card">
                <span>Best of 5 Avg</span>
                <strong>{best5AverageMs === null ? "--" : formatMs(best5AverageMs)}</strong>
                <p>Average of your top five solves.</p>
              </article>
              <article className="metric-card">
                <span>Recent Solves</span>
                <strong>{recentSolves.length}</strong>
                <p>Stored in this browser session.</p>
              </article>
              <article className="metric-card">
                <span>Cube Status</span>
                <strong>{smartCubeConnected ? "Connected" : "Offline"}</strong>
                <p>{smartCubeConnected ? "Live tracking enabled." : "Connect cube to track turns."}</p>
              </article>
            </section>

            <section className="dashboard-details">
              <article className="algorithm-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Splits</p>
                    <h2>Average Split Times</h2>
                  </div>
                </div>
                {averageSplitMs ? (
                  <div className="alg-block compact-data-block">
                    <CfopSplitBar
                      cross={averageSplitMs.cross}
                      f2l={averageSplitMs.f2l}
                      oll={averageSplitMs.oll}
                      pll={averageSplitMs.pll}
                    />
                    <div className="stat-grid compact-stat-grid">
                      <p>
                        <span>Cross</span>
                        <strong>{formatMs(averageSplitMs.cross)}</strong>
                      </p>
                      <p>
                        <span>F2L</span>
                        <strong>{formatMs(averageSplitMs.f2l)}</strong>
                      </p>
                      <p>
                        <span>OLL</span>
                        <strong>{formatMs(averageSplitMs.oll)}</strong>
                      </p>
                      <p>
                        <span>PLL</span>
                        <strong>{formatMs(averageSplitMs.pll)}</strong>
                      </p>
                    </div>
                    <p>Total average: {formatMs(averageSplitMs.total)}</p>
                  </div>
                ) : (
                  <div className="alg-block">
                    <p>No solve data yet.</p>
                  </div>
                )}
              </article>

              <article className="algorithm-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">History</p>
                    <h2>Latest Solves</h2>
                  </div>
                </div>
                <div className="alg-block">
                  {recentSolves.length === 0 ? (
                    <p>No solves yet.</p>
                  ) : (
                    <div className="solve-table-wrap">
                      <table className="solve-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Total</th>
                            <th>Cross</th>
                            <th>F2L</th>
                            <th>OLL</th>
                            <th>PLL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentSolves.map((solve, index) => (
                            <tr key={`${solve.finishedAt}-${index}`}>
                              <td>{index + 1}</td>
                              <td>{formatMs(solve.totalMs)}</td>
                              <td>{formatMs(solve.crossMs)}</td>
                              <td>{formatMs(solve.f2lMs)}</td>
                              <td>{formatMs(solve.ollMs)}</td>
                              <td>{formatMs(solve.pllMs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </article>
            </section>
          </section>
        )}

      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
