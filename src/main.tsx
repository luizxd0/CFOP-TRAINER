import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
  Bluetooth,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  ListRestart,
  Moon,
  Radio,
  Shuffle,
  Smartphone,
  Sun,
  TimerReset,
} from "lucide-react";
import { Alg, Move } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { cube3x3x3 } from "cubing/puzzles";
import { TwistyPlayer } from "cubing/twisty";
import {
  connectSmartCube as connectAnySmartCube,
  type SmartCubeConnection,
} from "../vendor/smartcube-web-bluetooth/src/smartcube/index";
import type { MacAddressProvider } from "../vendor/smartcube-web-bluetooth/src/smartcube/types";
import { CubieCube } from "../vendor/smartcube-web-bluetooth/src/smartcube/cubie-cube";
import {
  buildContextForStage,
  casesForStage,
  joinAlgs,
  moveCount,
  pickRandomCase,
  stages,
} from "./lib/trainer";
import { generateExactCrossCase } from "./lib/crossTrainer";
import { stageMeta, type AlgorithmCase, type Stage } from "./data/cfopData";
import "./styles.css";

type CubeOrientation = "yellow-top" | "white-top";
type ThemeMode = "light" | "dark";
type AppMode = "trainer" | "free";
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

function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage.getItem("cfopTheme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function orientationPrefix(orientation: CubeOrientation): string {
  // TwistyPlayer does not expose direct U/D color remapping, so we rotate the
  // puzzle frame for visualization and playback when yellow should be on top.
  return orientation === "yellow-top" ? "z2" : "";
}

function remapMoveForOrientation(move: string, orientation: CubeOrientation): string {
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

function invertMoveToken(token: string): string {
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
  x: { U: "B", B: "D", D: "F", F: "U", R: "R", L: "L" },
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

function patternFromFacelets(facelets: string, kpuzzle: CubeKpuzzle): KPattern | null {
  const parsed = new CubieCube().fromFacelet(facelets);
  if (parsed === -1) {
    return null;
  }
  const cubie = parsed as CubieCube;
  return new KPattern(kpuzzle, {
    EDGES: {
      pieces: cubie.ea.map((entry) => entry >> 1),
      orientation: cubie.ea.map((entry) => entry & 1),
    },
    CORNERS: {
      pieces: cubie.ca.map((entry) => entry & 7),
      orientation: cubie.ca.map((entry) => entry >> 3),
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

function CubeViewer({
  setup,
  alg,
  title,
  contextMoves,
  cubeOrientation,
  liveMoves = [],
  guideSteps = [],
  timerLabel = null,
  isTimerRunning = false,
  isLive = false,
  gyroQuaternion = null,
  gyroSession = 0,
}: {
  setup: string;
  alg: string;
  title: string;
  contextMoves: number;
  cubeOrientation: CubeOrientation;
  liveMoves?: string[];
  guideSteps?: Array<{ label: string; state: GuideStepState; progress: number }>;
  timerLabel?: string | null;
  isTimerRunning?: boolean;
  isLive?: boolean;
  gyroQuaternion?: GyroQuaternion | null;
  gyroSession?: number;
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

    hostRef.current.replaceChildren();
    const player = new TwistyPlayer({
      puzzle: "3x3x3",
      experimentalSetupAlg: "",
      alg: "",
      background: "none",
      controlPanel: "bottom-row",
      visualization: "3D",
      experimentalStickering: "full",
      cameraLatitude: 28,
      cameraLongitude: 38,
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

    player.controlPanel = isLive ? "none" : "bottom-row";
    player.tempoScale = isLive ? 2.5 : 1;

    if (!isLive) {
      liveSetupTokensRef.current = [];
      liveSyncReadyRef.current = false;
      liveOrientationRef.current = null;
      player.experimentalSetupAlg = joinAlgs([orientationPrefix(cubeOrientation), setup]);
      player.alg = alg;
      return;
    }

    const nextTokens = splitAlgTokens(setup);
    const previousTokens = liveSetupTokensRef.current;
    const orientationChanged = liveOrientationRef.current !== cubeOrientation;
    const isPrefix =
      nextTokens.length >= previousTokens.length &&
      previousTokens.every((token, index) => token === nextTokens[index]);

    if (!liveSyncReadyRef.current || orientationChanged || !isPrefix) {
      player.experimentalSetupAlg = joinAlgs([orientationPrefix(cubeOrientation), setup]);
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

    player.experimentalSetupAlg = joinAlgs([orientationPrefix(cubeOrientation), setup]);
    player.alg = "";
    player.jumpToEnd({ flash: false });
    liveSetupTokensRef.current = nextTokens;
    liveSyncReadyRef.current = true;
    liveOrientationRef.current = cubeOrientation;
  }, [setup, alg, cubeOrientation, isLive]);

  useEffect(() => {
    gyroBasisRef.current = null;
    liveTargetQuaternionRef.current = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((15 * Math.PI) / 180, (-20 * Math.PI) / 180, 0),
    );
    if (puzzleObjectRef.current) {
      puzzleObjectRef.current.quaternion.copy(liveTargetQuaternionRef.current);
    }
    if (!isLive) {
      puzzleObjectRef.current = null;
      vantageRef.current = null;
    }
  }, [gyroSession, isLive, cubeOrientation]);

  useEffect(() => {
    if (!isLive || !gyroQuaternion) {
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
  }, [gyroQuaternion, isLive, cubeOrientation]);

  useEffect(() => {
    if (!isLive || !playerRef.current) {
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
        puzzle.quaternion.slerp(liveTargetQuaternionRef.current, 0.25);
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
  }, [isLive, gyroSession]);

  const visibleLiveMoves = useMemo(() => liveMoves.slice(-32), [liveMoves]);

  return (
    <section className="viewer-panel" aria-label={title}>
      <div className="viewer-toolbar">
        <div>
          <p className="eyebrow">3D setup</p>
          <h2>{title}</h2>
        </div>
        <div className="chip-row">
          {timerLabel && (
            <span className={`timer-chip ${isTimerRunning ? "running" : ""}`}>{timerLabel}</span>
          )}
          <span className="chip">{isLive ? `${contextMoves} live turns` : `${moveCount(setup)} prep moves`}</span>
          {!isLive && contextMoves > 0 && <span className="chip">{contextMoves} context moves</span>}
        </div>
      </div>
      <div className="twisty-host" ref={hostRef} />
      {isLive && (
        <>
          <div className="live-guide-strip">
            <div className="live-guide-head">
              <span>Setup Algorithm</span>
            </div>
            <div className="live-guide-steps">
              {guideSteps.length === 0 ? (
                <span>Waiting for setup algorithm...</span>
              ) : (
                guideSteps.map((step, index) => (
                  <i
                    key={`${step.label}-${index}`}
                    className={`guide-step ${step.state}`}
                    style={{ ["--progress" as string]: `${Math.round(step.progress * 100)}%` }}
                  >
                    {step.label}
                  </i>
                ))
              )}
            </div>
          </div>
          <div className="live-move-strip">
            {visibleLiveMoves.length === 0 ? (
              <span>Moves will appear here as you turn the cube.</span>
            ) : (
              visibleLiveMoves.map((move, index) => (
                <b key={`${move}-${index}`}>{move}</b>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SmartCubePanel({
  onMove,
  onGyro,
  onFacelets,
  onConnectionChange,
  onResetLiveState,
  cubeOrientation,
  freeLastSolves,
}: {
  onMove?: (move: { raw: string; display: string }) => void;
  onGyro?: (quaternion: GyroQuaternion | null) => void;
  onFacelets?: (facelets: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onResetLiveState?: () => void;
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
  const [showBluetoothDetails, setShowBluetoothDetails] = useState(true);
  const smartRef = useRef<SmartCubeConnection | null>(null);
  const smartSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const gyroBasisForMovesRef = useRef<THREE.Quaternion | null>(null);
  const gyroRelativeForMovesRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const yellowTopRotationRef = useRef(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
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
      gyroBasisForMovesRef.current = null;
      gyroRelativeForMovesRef.current.identity();
      emitConnectionChange(false);
      emitGyro(null);
    };
  }, [emitConnectionChange, emitGyro]);

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
    if (!isFallbackCall) {
      // Let automatic discovery run first; provide cached manual MAC if we already have one.
      return cachedManualMac;
    }

    const fallbackHint =
      typeof device.watchAdvertisements !== "function"
        ? "\n\nTip: auto discovery can improve if Chrome enables:\nchrome://flags/#enable-experimental-web-platform-features"
        : "";
    const userInput = window.prompt(
      `Unable to determine cube MAC address automatically.\nEnter your cube MAC (format AA:BB:CC:DD:EE:FF).${fallbackHint}`,
      cachedManualMac ?? "",
    );
    if (!userInput) {
      return null;
    }
    const normalized = normalizeMacAddress(userInput);
    if (!normalized) {
      window.alert("Invalid MAC format. Use 12 hex digits (AA:BB:CC:DD:EE:FF).");
      return null;
    }
    storeManualMacForDevice(device, normalized);
    return normalized;
  }, []);

  function attachSmartConnection(conn: SmartCubeConnection) {
    smartRef.current = conn;
    const nextName = conn.deviceName || "Smart cube";
    setDeviceName(nextName);
    setPreferredDeviceName(nextName);
    setDeviceMac(conn.deviceMAC || "Unknown");
    setStatus(`Connected via ${conn.protocol.name}`);
    setIsConnected(true);
    setShowBluetoothDetails(false);
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
            const orientedMove = remapMoveForOrientation(move, cubeOrientation);
            emitMove({
              raw: move,
              display: remapMoveForPerspective(orientedMove, gyroRelativeForMovesRef.current),
            });
          }
          break;
        case "FACELETS":
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
          setStatus("Disconnected");
          setIsConnected(false);
          setShowBluetoothDetails(true);
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
      void conn.sendCommand({ type: "REQUEST_FACELETS" });
      void syncInitialCubeState(conn);
    }
  }

  function waitForFaceletsEvent(conn: SmartCubeConnection, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: number | null = null;
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
        sub.unsubscribe();
        resolve(result);
      };

      const sub = conn.events$.subscribe((event) => {
        if (event.type === "FACELETS") {
          finish(true);
          return;
        }
        if (event.type === "DISCONNECT") {
          finish(false);
        }
      });

      timer = window.setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function syncInitialCubeState(conn: SmartCubeConnection): Promise<void> {
    if (!conn.capabilities.facelets) {
      return;
    }
    // Some cubes can miss the first state packet right after pairing; retry a few requests.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await conn.sendCommand({ type: "REQUEST_FACELETS" });
      } catch {
        // Keep trying; protocol drivers may transiently reject writes while settling.
      }
      const received = await waitForFaceletsEvent(conn, 900 + attempt * 350);
      if (received) {
        return;
      }
    }
    setStatus("Connected, but initial cube state is pending. Turn one face to force sync.");
  }

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
      setStatus("Opening Bluetooth picker...");
      setDeviceMac("Unknown");
      setBattery(null);
      setOrientation("Waiting for gyro data");
      gyroBasisForMovesRef.current = null;
      gyroRelativeForMovesRef.current.identity();
      emitGyro(null);
      await connectUsingSmartCubeApi();
    } catch (error) {
      if (isMissingCubeMacError(error)) {
        setStatus(
          "Cube MAC auto-detect failed. Retry and allow manual MAC prompt, keep only your cube powered nearby, and ensure Android Chrome runs on HTTPS.",
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
    setStatus("Disconnected");
    setIsConnected(false);
    setShowBluetoothDetails(true);
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
        {isConnected && (
          <button
            className="ghost-button span-2"
            onClick={() => setShowBluetoothDetails((value) => !value)}
          >
            {showBluetoothDetails ? <EyeOff size={18} /> : <Eye size={18} />}
            {showBluetoothDetails ? "Hide Bluetooth details" : "Show Bluetooth details"}
          </button>
        )}
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
  const [showSetup, setShowSetup] = useState(true);
  const [showCaseSetup, setShowCaseSetup] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const mainAlg = activeCase.solutions[0];
  const displaySetup = remapAlgForOrientation(activeCase.setup, cubeOrientation);
  const displayCaseSetup = remapAlgForOrientation(activeCase.baseSetup, cubeOrientation);
  const displaySolution = remapAlgForOrientation(mainAlg.alg, cubeOrientation);

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
          <span>{isCross ? "Cross setup scramble (from solved)" : "Training scramble (from solved)"}</span>
          <button onClick={() => setShowSetup((value) => !value)}>
            {showSetup ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <code>{showSetup ? displaySetup : "Hidden"}</code>
        <p>
          {isCross
            ? "Generated by exact search for the selected optimal cross move count."
            : "Context is mixed on purpose so finishing the case does not end in solved."}
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
  stepMarks,
}: {
  scramble: string;
  inspectionEnabled: boolean;
  inspectionRunning: boolean;
  inspectionRemainingMs: number | null;
  timerLabel: string;
  stepMarks: { crossMs: number | null; f2lMs: number | null; ollMs: number | null };
}) {
  const inspectionText = inspectionEnabled
    ? inspectionRunning
      ? `${Math.max(0, Math.ceil((inspectionRemainingMs ?? 0) / 1000))}s`
      : inspectionRemainingMs === 0
        ? "Done"
        : "Ready"
    : "Unlimited";
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
        <p>Cross: {stepMarks.crossMs === null ? "--" : formatMs(stepMarks.crossMs)}</p>
        <p>F2L: {stepMarks.f2lMs === null ? "--" : formatMs(stepMarks.f2lMs)}</p>
        <p>OLL: {stepMarks.ollMs === null ? "--" : formatMs(stepMarks.ollMs)}</p>
      </div>
    </section>
  );
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [mode, setMode] = useState<AppMode>("trainer");
  const [stage, setStage] = useState<Stage>("cross");
  const [cubeOrientation, setCubeOrientation] =
    useState<CubeOrientation>("yellow-top");
  const [smartCubeConnected, setSmartCubeConnected] = useState(false);
  const [smartCubeMoves, setSmartCubeMoves] = useState<string[]>([]);
  const smartCubeMovesRef = useRef<string[]>([]);
  const [smartCubeDisplayMoves, setSmartCubeDisplayMoves] = useState<string[]>([]);
  const [liveSessionMoveCount, setLiveSessionMoveCount] = useState(0);
  const [liveSessionStartMoves, setLiveSessionStartMoves] = useState<string[]>([]);
  const [trainingSessionId, setTrainingSessionId] = useState(0);
  const [sessionAwareSetupAlg, setSessionAwareSetupAlg] = useState<string | null>(null);
  const [smartCubeGyro, setSmartCubeGyro] = useState<GyroQuaternion | null>(null);
  const [smartCubeGyroSession, setSmartCubeGyroSession] = useState(0);
  const [setupGuideSteps, setSetupGuideSteps] = useState<GuideStepInternal[]>([]);
  const [setupGuideComplete, setSetupGuideComplete] = useState(false);
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
  const [cubeKpuzzle, setCubeKpuzzle] = useState<CubeKpuzzle | null>(null);
  const setupGuideCompleteRef = useRef(false);
  const prevSetupGuideCompleteRef = useRef(false);
  const prevAttemptFinishedRef = useRef(false);
  const pendingFaceletsBootstrapRef = useRef(false);
  const pendingFaceletsValueRef = useRef<string | null>(null);
  const bootstrappingFaceletsRef = useRef(false);
  const [difficulty, setDifficulty] = useState<number | "all">(1);
  const [selectedCaseId, setSelectedCaseId] = useState("cross-1");
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
    smartCubeMovesRef.current = smartCubeMoves;
  }, [smartCubeMoves]);

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
  const stageCases = useMemo(() => casesForStage(stage), [stage]);
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

    const setup = joinAlgs([contextAlg, activeCase.baseSetup]);
    return { ...activeCase, setup };
  }, [activeCase, contextAlg, crossDifficulty, crossGenerated, isCross]);

  const solution = activeCaseWithTrainingSetup.solutions[0].alg;
  const freeScrambleForOrientation = useMemo(
    () => remapAlgForOrientation(freeScramble, cubeOrientation),
    [cubeOrientation, freeScramble],
  );
  const setupAlgForOrientation = useMemo(
    () => remapAlgForOrientation(activeCaseWithTrainingSetup.setup, cubeOrientation),
    [activeCaseWithTrainingSetup.setup, cubeOrientation],
  );
  const solutionAlgForOrientation = useMemo(
    () => remapAlgForOrientation(solution, cubeOrientation),
    [solution, cubeOrientation],
  );
  const smartCubeAlg = useMemo(
    () => smartCubeMoves.map((move) => remapMoveForOrientation(move, cubeOrientation)).join(" "),
    [cubeOrientation, smartCubeMoves],
  );
  const liveSessionStartAlg = useMemo(
    () =>
      liveSessionStartMoves
        .map((move) => remapMoveForOrientation(move, cubeOrientation))
        .join(" "),
    [cubeOrientation, liveSessionStartMoves],
  );
  const targetSetupAlgForOrientation = isFreeMode ? freeScrambleForOrientation : setupAlgForOrientation;
  const setupGuideAlg = useMemo(
    () => {
      const raw = smartCubeConnected
        ? (sessionAwareSetupAlg ?? targetSetupAlgForOrientation)
        : targetSetupAlgForOrientation;
      return simplifyAlgText(raw);
    },
    [sessionAwareSetupAlg, smartCubeConnected, targetSetupAlgForOrientation],
  );
  const isLiveViewer = smartCubeConnected;
  const viewerTitle = isLiveViewer
    ? "Live Smart Cube"
    : isFreeMode
      ? "Free Practice"
      : activeCaseWithTrainingSetup.name;
  // In live mode we must use setup (not alg) so the cube shows current state immediately.
  const viewerSetup = isLiveViewer
    ? smartCubeAlg
    : isFreeMode
      ? freeScramble
      : activeCaseWithTrainingSetup.setup;
  const viewerAlg = isLiveViewer || isFreeMode ? "" : solution;
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
  const currentLivePattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(smartCubeAlg) : null),
    [cubeKpuzzle, smartCubeAlg],
  );
  const solvedPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern() : null),
    [cubeKpuzzle],
  );
  const setupTargetPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(targetSetupAlgForOrientation) : null),
    [cubeKpuzzle, targetSetupAlgForOrientation],
  );
  const solvedTargetPattern = useMemo(
    () => {
      if (isFreeMode) {
        return solvedPattern;
      }
      return setupTargetPattern
        ? setupTargetPattern.applyAlg(solutionAlgForOrientation)
        : null;
    },
    [isFreeMode, setupTargetPattern, solutionAlgForOrientation, solvedPattern],
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
      setMovesAfterSetup((current) => current + 1);
      return;
    }
    setSetupGuideSteps((current) => {
      if (current.length === 0) {
        return current;
      }
      // Guide tracking must use cube-state notation (not gyro-perspective display labels).
      const normalizedToken = remapMoveForOrientation(move.raw, cubeOrientation).trim();
      const incomingAtoms = tokenToAtoms(normalizedToken)
        .map((atom) => atom.trim())
        .filter((atom) => atom.length > 0);
      if (incomingAtoms.length === 0) {
        return current.map(cloneGuideStep);
      }

      let next = current.map(cloneGuideStep);
      for (const normalizedMove of incomingAtoms) {
        const activeIndex = next.findIndex((step) => step.doneAtoms < step.atoms.length);
        if (activeIndex < 0) {
          break;
        }
        const active = next[activeIndex];

        if (active.atoms.length === 2 && active.doneAtoms === 0) {
          const primary = active.atoms[0];
          const opposite = invertMoveToken(primary);
          if (normalizedMove === primary || normalizedMove === opposite) {
            if (normalizedMove === opposite) {
              active.atoms = [opposite, opposite];
            }
            active.doneAtoms = 1;
            continue;
          }
        }

        const expected = active.atoms[active.doneAtoms];
        if (normalizedMove === expected) {
          active.doneAtoms += 1;
          continue;
        }

        if (
          active.atoms.length === 2 &&
          active.doneAtoms === 1 &&
          normalizedMove === invertMoveToken(active.atoms[0])
        ) {
          // For things like U2, opposite second turn cancels the half progress.
          active.doneAtoms = 0;
          continue;
        }

        const corrective = invertMoveToken(normalizedMove);
        if (corrective.length > 0) {
          next.splice(activeIndex, 0, {
            label: corrective,
            atoms: [corrective],
            doneAtoms: 0,
          });
          next = normalizePendingGuideSteps(next);
        }
      }
      return next;
    });
  }, [cubeOrientation, freeInspectionRunning, isFreeMode]);

  const handleSmartCubeGyro = useCallback((quaternion: GyroQuaternion | null) => {
    setSmartCubeGyro(quaternion);
  }, []);

  const hardResetLiveCubeState = useCallback(() => {
    setSmartCubeMoves([]);
    smartCubeMovesRef.current = [];
    setLiveSessionStartMoves([]);
    setLiveSessionMoveCount(0);
    setSmartCubeDisplayMoves([]);
    setSessionAwareSetupAlg(null);
    setTrainingSessionId((current) => current + 1);
    setSetupGuideComplete(false);
    setupGuideCompleteRef.current = false;
    prevSetupGuideCompleteRef.current = false;
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    setTimerRunning(false);
    setTimerStartAt(null);
    setTimerElapsedMs(0);
    setFreeInspectionRunning(false);
    setFreeInspectionRemainingMs(null);
    setFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
    freeSolveLoggedRef.current = false;
  }, []);

  const resetTrainingSessionFromCurrentState = useCallback(() => {
    const currentMoves = [...smartCubeMovesRef.current];
    setLiveSessionStartMoves(currentMoves);
    setLiveSessionMoveCount(0);
    setSmartCubeDisplayMoves([]);
    setSessionAwareSetupAlg(null);
    setTrainingSessionId((current) => current + 1);
    setSetupGuideComplete(false);
    setupGuideCompleteRef.current = false;
    prevSetupGuideCompleteRef.current = false;
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    setTimerRunning(false);
    setTimerStartAt(null);
    setTimerElapsedMs(0);
    setFreeInspectionRunning(false);
    setFreeInspectionRemainingMs(null);
    setFreeStepMarks({ crossMs: null, f2lMs: null, ollMs: null });
    freeSolveLoggedRef.current = false;
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
    const pattern = patternFromFacelets(facelets, cubeKpuzzle);
    if (!pattern) {
      return;
    }
    bootstrappingFaceletsRef.current = true;
    void experimentalSolve3x3x3IgnoringCenters(pattern)
      .then((solveToSolved) => {
        const fromSolved = new Alg(stripCubeRotations(solveToSolved.toString())).invert().toString();
        const nextMoves = splitAlgTokens(fromSolved).slice(-500);
        setSmartCubeMoves(nextMoves);
        smartCubeMovesRef.current = nextMoves;
        setLiveSessionStartMoves([...nextMoves]);
        setLiveSessionMoveCount(0);
        setSmartCubeDisplayMoves([]);
        setSessionAwareSetupAlg(null);
        setTrainingSessionId((current) => current + 1);
        setSetupGuideComplete(false);
        setupGuideCompleteRef.current = false;
        prevSetupGuideCompleteRef.current = false;
        setMovesAfterSetup(0);
        setAttemptFinished(false);
        setTimerRunning(false);
        setTimerStartAt(null);
        setTimerElapsedMs(0);
      })
      .catch(() => {
        // Ignore bootstrap errors and keep move-based tracking.
      })
      .finally(() => {
        pendingFaceletsBootstrapRef.current = false;
        bootstrappingFaceletsRef.current = false;
      });
  }, [cubeKpuzzle, smartCubeConnected]);

  const handleSmartCubeFacelets = useCallback((facelets: string) => {
    pendingFaceletsValueRef.current = facelets;
    attemptFaceletsBootstrap();
  }, [attemptFaceletsBootstrap]);

  useEffect(() => {
    attemptFaceletsBootstrap();
  }, [attemptFaceletsBootstrap, cubeKpuzzle]);

  const handleSmartCubeConnectionChange = useCallback((connected: boolean) => {
    setSmartCubeConnected(connected);
    if (connected) {
      pendingFaceletsBootstrapRef.current = true;
      pendingFaceletsValueRef.current = null;
      setSmartCubeGyroSession((current) => current + 1);
      // Keep current visual state until we bootstrap from FACELETS, then swap to real cube state.
      resetTrainingSessionFromCurrentState();
      return;
    }
    pendingFaceletsBootstrapRef.current = false;
    pendingFaceletsValueRef.current = null;
    setSmartCubeGyro(null);
    hardResetLiveCubeState();
  }, [hardResetLiveCubeState, resetTrainingSessionFromCurrentState]);

  const handleSmartCubeResetLiveState = useCallback(() => {
    pendingFaceletsBootstrapRef.current = false;
    pendingFaceletsValueRef.current = null;
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

  useEffect(() => {
    const nextDifficulty = stage === "cross" ? 1 : "all";
    setDifficulty(nextDifficulty);
    const nextCase = casesForStage(stage).find((item) =>
      nextDifficulty === "all" ? true : item.difficulty === nextDifficulty,
    );
    setSelectedCaseId(nextCase?.id ?? casesForStage(stage)[0].id);
  }, [stage]);

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
    if (!smartCubeConnected) {
      setSessionAwareSetupAlg(null);
      return;
    }
    let cancelled = false;

    const applyFallback = () => {
      const normalizeToSolved =
        liveSessionStartAlg.trim().length > 0
          ? new Alg(liveSessionStartAlg).invert().toString()
          : "";
      setSessionAwareSetupAlg(
        simplifyAlgText(joinAlgs([normalizeToSolved, targetSetupAlgForOrientation])),
      );
    };

    if (!cubeKpuzzle) {
      applyFallback();
      return;
    }

    const sessionStartPattern = cubeKpuzzle.defaultPattern().applyAlg(liveSessionStartAlg);
    void experimentalSolve3x3x3IgnoringCenters(sessionStartPattern)
      .then((solveToSolved) => {
        if (cancelled) {
          return;
        }
        setSessionAwareSetupAlg(
          simplifyAlgText(
            joinAlgs([stripCubeRotations(solveToSolved.toString()), targetSetupAlgForOrientation]),
          ),
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
    liveSessionStartAlg,
    targetSetupAlgForOrientation,
    smartCubeConnected,
    trainingSessionId,
  ]);

  useEffect(() => {
    const nextSteps = buildGuideStepsFromAlg(setupGuideAlg);
    setSetupGuideSteps(nextSteps);
    const complete = nextSteps.length === 0;
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
    prevSetupGuideCompleteRef.current = complete;
    setMovesAfterSetup(0);
    setAttemptFinished(false);
    setTimerRunning(false);
    setTimerStartAt(null);
    setTimerElapsedMs(0);
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
    const wasFinished = prevAttemptFinishedRef.current;
    const justFinished = !wasFinished && attemptFinished;
    prevAttemptFinishedRef.current = attemptFinished;
    if (!justFinished || !smartCubeConnected || isFreeMode) {
      return;
    }
    // As soon as a case is solved, recompute setup from current physical state
    // so the same selected case can be drilled repeatedly.
    resetTrainingSessionFromCurrentState();
  }, [attemptFinished, isFreeMode, resetTrainingSessionFromCurrentState, smartCubeConnected]);

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
      }
      if (
        next.f2lMs === null &&
        isF2LSolved(
          currentLivePattern as unknown as { patternData: Record<string, any> },
          solvedPattern as unknown as { patternData: Record<string, any> },
        )
      ) {
        next.f2lMs = elapsed;
        changed = true;
      }
      if (
        next.ollMs === null &&
        isOllSolved(
          currentLivePattern as unknown as { patternData: Record<string, any> },
          solvedPattern as unknown as { patternData: Record<string, any> },
        )
      ) {
        next.ollMs = elapsed;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [currentLivePattern, isFreeMode, solvedPattern, timerRunning, timerStartAt]);

  useEffect(() => {
    if (!timerRunning || !currentLivePattern || !solvedTargetPattern) {
      return;
    }
    const exactMatch = currentLivePattern.isIdentical(solvedTargetPattern);
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
    const f2lGoalMatch =
      !isFreeMode &&
      stage === "f2l" &&
      solvedPattern &&
      isF2LSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
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
        (exactMatch || crossGoalMatch || f2lGoalMatch || ollGoalMatch || pllGoalMatch || stageGoalMatch))
    ) {
      const totalMs = timerStartAt !== null ? performance.now() - timerStartAt : timerElapsedMs;
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
      setAttemptFinished(true);
      setTimerElapsedMs(totalMs);
    }
  }, [
    freeStepMarks.crossMs,
    freeStepMarks.f2lMs,
    freeStepMarks.ollMs,
    isFreeMode,
    timerRunning,
    currentLivePattern,
    solvedTargetPattern,
    stage,
    timerElapsedMs,
    timerStartAt,
    requiredSolvedSlots,
    solvedPattern,
  ]);

  function randomTrainingCase() {
    resetTrainingSessionFromCurrentState();
    if (stage === "cross") {
      setCrossRefresh((value) => value + 1);
      return;
    }
    const next = pickRandomCase(stage, difficulty === "all" ? undefined : difficulty);
    setSelectedCaseId(next.id);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CFOP Trainer</p>
          <h1>Practice Cross, F2L, OLL and PLL with visual setup drills.</h1>
        </div>
        <div className="platforms">
          <span>
            <CheckCircle2 size={16} />
            PC Chrome/Edge
          </span>
          <span>
            <Smartphone size={16} />
            Android Chrome
          </span>
          <button
            className="theme-toggle"
            onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
            title={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <nav className="stage-tabs" aria-label="CFOP stages">
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

      <section className="trainer-layout">
        <aside className="control-panel">
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
            </>
          )}
        </aside>

        <div className="main-column">
          <CubeViewer
            title={viewerTitle}
            setup={viewerSetup}
            alg={viewerAlg}
            contextMoves={viewerContextMoves}
            cubeOrientation={cubeOrientation}
            liveMoves={smartCubeDisplayMoves}
            guideSteps={setupGuideStepViews}
            timerLabel={timerLabel}
            isTimerRunning={timerRunning}
            isLive={isLiveViewer}
            gyroQuaternion={isLiveViewer ? smartCubeGyro : null}
            gyroSession={smartCubeGyroSession}
          />
          {isFreeMode ? (
            <FreePracticePanel
              scramble={freeScrambleForOrientation}
              inspectionEnabled={freeInspectionEnabled}
              inspectionRunning={freeInspectionRunning}
              inspectionRemainingMs={freeInspectionRemainingMs}
              timerLabel={formatMs(timerElapsedMs)}
              stepMarks={freeStepMarks}
            />
          ) : (
            <AlgorithmCard
              activeCase={activeCaseWithTrainingSetup}
              cubeOrientation={cubeOrientation}
            />
          )}
        </div>

        <SmartCubePanel
          onMove={handleSmartCubeMove}
          onGyro={handleSmartCubeGyro}
          onFacelets={handleSmartCubeFacelets}
          onConnectionChange={handleSmartCubeConnectionChange}
          onResetLiveState={handleSmartCubeResetLiveState}
          cubeOrientation={cubeOrientation}
          freeLastSolves={freeLastSolves}
        />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
