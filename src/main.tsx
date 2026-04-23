import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
  Bluetooth,
  BookOpen,
  CheckCircle2,
  ChevronRight,
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
import { randomScrambleForEvent } from "cubing/scramble";
import { cube3x3x3 } from "cubing/puzzles";
import { TwistyPlayer } from "cubing/twisty";
import {
  connectSmartCube as connectAnySmartCube,
  type MacAddressProvider,
  type SmartCubeConnection,
} from "smartcube-web-bluetooth";
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
type GyroQuaternion = { x: number; y: number; z: number; w: number };
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
  const face = move[0];
  const suffix = move.slice(1);
  const remap: Record<string, string> = {
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
  };
  return `${remap[face] ?? face}${suffix}`;
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

function splitAlgTokens(alg: string): string[] {
  return alg
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
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
      liveTargetQuaternionRef.current = new THREE.Quaternion().setFromEuler(
        new THREE.Euler((15 * Math.PI) / 180, (-20 * Math.PI) / 180, 0),
      );
    };
  }, []);

  useEffect(() => {
    if (!playerRef.current) {
      return;
    }
    playerRef.current.controlPanel = isLive ? "none" : "bottom-row";
    playerRef.current.experimentalSetupAlg = joinAlgs([orientationPrefix(cubeOrientation), setup]);
    playerRef.current.alg = alg;
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
              <b className={isTimerRunning ? "running" : ""}>{timerLabel ?? "0.00"}</b>
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
  onConnectionChange,
  onResetLiveState,
  cubeOrientation,
}: {
  onMove?: (move: { raw: string; display: string }) => void;
  onGyro?: (quaternion: GyroQuaternion | null) => void;
  onConnectionChange?: (connected: boolean) => void;
  onResetLiveState?: () => void;
  cubeOrientation: CubeOrientation;
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
    gyroBasisForMovesRef.current = null;
    gyroRelativeForMovesRef.current.identity();
    emitResetLiveState();
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
    }
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
      emitResetLiveState();
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

  return (
    <section className="smart-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Experimental</p>
          <h2>Smart Cube</h2>
        </div>
        <Radio size={20} />
      </div>
      <p className="support-note">
        Bluetooth picker is filtered to supported smart-cube devices.
      </p>
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
      </div>
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
    </section>
  );
}

function AlgorithmCard({ activeCase }: { activeCase: AlgorithmCase }) {
  const isCross = activeCase.stage === "cross";
  const [showSetup, setShowSetup] = useState(true);
  const [showCaseSetup, setShowCaseSetup] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const mainAlg = activeCase.solutions[0];

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
        <code>{showSetup ? activeCase.setup : "Hidden"}</code>
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
          <code>{showCaseSetup ? activeCase.baseSetup : "Hidden"}</code>
        </div>
      )}

      <div className="alg-block solution">
        <div className="alg-title">
          <span>{isCross ? "One optimal cross solution" : "Best solution"}</span>
          <button onClick={() => setShowSolution((value) => !value)}>
            {showSolution ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <code>{showSolution ? mainAlg.alg : "Try it first"}</code>
        <p>
          {mainAlg.label} | {mainAlg.source} | {mainAlg.notes}
        </p>
      </div>
    </section>
  );
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [stage, setStage] = useState<Stage>("cross");
  const [cubeOrientation, setCubeOrientation] =
    useState<CubeOrientation>("yellow-top");
  const [smartCubeConnected, setSmartCubeConnected] = useState(false);
  const [smartCubeMoves, setSmartCubeMoves] = useState<string[]>([]);
  const [smartCubeDisplayMoves, setSmartCubeDisplayMoves] = useState<string[]>([]);
  const [smartCubeGyro, setSmartCubeGyro] = useState<GyroQuaternion | null>(null);
  const [smartCubeGyroSession, setSmartCubeGyroSession] = useState(0);
  const [setupGuideSteps, setSetupGuideSteps] = useState<GuideStepInternal[]>([]);
  const [setupGuideComplete, setSetupGuideComplete] = useState(false);
  const [movesAfterSetup, setMovesAfterSetup] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStartAt, setTimerStartAt] = useState<number | null>(null);
  const [timerElapsedMs, setTimerElapsedMs] = useState(0);
  const [cubeKpuzzle, setCubeKpuzzle] =
    useState<Awaited<ReturnType<typeof cube3x3x3.kpuzzle>> | null>(null);
  const setupGuideCompleteRef = useRef(false);
  const [difficulty, setDifficulty] = useState<number | "all">(1);
  const [selectedCaseId, setSelectedCaseId] = useState("cross-1");
  const [contextAlg, setContextAlg] = useState("");
  const [crossRefresh, setCrossRefresh] = useState(0);
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
  const [scramble, setScramble] = useState("R U R' U' F R U R' U' F'");
  const [isLoadingScramble, setIsLoadingScramble] = useState(false);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", themeMode);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cfopTheme", themeMode);
    }
  }, [themeMode]);

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
      if (disposed || document.visibilityState !== "visible" || wakeLock) {
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

    const handleUserInteraction = () => {
      void requestWakeLock();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pointerdown", handleUserInteraction, { passive: true });
    window.addEventListener("keydown", handleUserInteraction);
    void requestWakeLock();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pointerdown", handleUserInteraction);
      window.removeEventListener("keydown", handleUserInteraction);
      void releaseWakeLock();
    };
  }, []);

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
  const isLiveViewer = smartCubeConnected;
  const viewerTitle = isLiveViewer ? "Live Smart Cube" : activeCaseWithTrainingSetup.name;
  // In live mode we must use setup (not alg) so the cube shows current state immediately.
  const viewerSetup = isLiveViewer ? smartCubeAlg : activeCaseWithTrainingSetup.setup;
  const viewerAlg = isLiveViewer ? "" : solution;
  const viewerContextMoves = isLiveViewer ? smartCubeMoves.length : moveCount(contextAlg);
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
  const timerLabel = useMemo(() => formatMs(timerElapsedMs), [timerElapsedMs]);
  const currentLivePattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(smartCubeAlg) : null),
    [cubeKpuzzle, smartCubeAlg],
  );
  const solvedPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern() : null),
    [cubeKpuzzle],
  );
  const setupTargetPattern = useMemo(
    () => (cubeKpuzzle ? cubeKpuzzle.defaultPattern().applyAlg(setupAlgForOrientation) : null),
    [cubeKpuzzle, setupAlgForOrientation],
  );
  const solvedTargetPattern = useMemo(
    () =>
      cubeKpuzzle
        ? cubeKpuzzle.defaultPattern().applyAlg(joinAlgs([setupAlgForOrientation, solutionAlgForOrientation]))
        : null,
    [cubeKpuzzle, setupAlgForOrientation, solutionAlgForOrientation],
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
    setSmartCubeDisplayMoves((current) =>
      current.length >= 19 ? [move.display] : [...current, move.display],
    );
    if (setupGuideCompleteRef.current) {
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
  }, [cubeOrientation]);

  const handleSmartCubeGyro = useCallback((quaternion: GyroQuaternion | null) => {
    setSmartCubeGyro(quaternion);
  }, []);

  const resetLiveMoveHistory = useCallback(() => {
    setSmartCubeMoves([]);
    setSmartCubeDisplayMoves([]);
  }, []);

  const handleSmartCubeConnectionChange = useCallback((connected: boolean) => {
    setSmartCubeConnected(connected);
    if (connected) {
      setSmartCubeGyroSession((current) => current + 1);
    } else {
      setSmartCubeGyro(null);
      resetLiveMoveHistory();
      setSetupGuideComplete(false);
      setupGuideCompleteRef.current = false;
      setMovesAfterSetup(0);
      setTimerRunning(false);
      setTimerStartAt(null);
      setTimerElapsedMs(0);
    }
  }, [resetLiveMoveHistory]);

  const handleSmartCubeResetLiveState = useCallback(() => {
    resetLiveMoveHistory();
    setSmartCubeGyro(null);
    setSmartCubeGyroSession((current) => current + 1);
    setSetupGuideComplete(false);
    setupGuideCompleteRef.current = false;
    setMovesAfterSetup(0);
    setTimerRunning(false);
    setTimerStartAt(null);
    setTimerElapsedMs(0);
  }, [resetLiveMoveHistory]);

  const handleStageChange = useCallback(
    (nextStage: Stage) => {
      if (nextStage === stage) {
        return;
      }
      resetLiveMoveHistory();
      setStage(nextStage);
    },
    [resetLiveMoveHistory, stage],
  );

  const handleDifficultyChange = useCallback(
    (nextDifficulty: number | "all") => {
      if (nextDifficulty === difficulty) {
        return;
      }
      resetLiveMoveHistory();
      setDifficulty(nextDifficulty);
    },
    [difficulty, resetLiveMoveHistory],
  );

  const handleCaseChange = useCallback(
    (nextCaseId: string) => {
      if (nextCaseId === selectedCaseId) {
        return;
      }
      resetLiveMoveHistory();
      setSelectedCaseId(nextCaseId);
    },
    [resetLiveMoveHistory, selectedCaseId],
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

    void generateExactCrossCase(crossDifficulty)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCrossGenerated({
          setup: result.setup,
          solution: result.solution,
          loading: false,
          error: null,
        });
      })
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
    const nextSteps = buildGuideStepsFromAlg(setupAlgForOrientation);
    setSetupGuideSteps(nextSteps);
    const complete = nextSteps.length === 0;
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
    setMovesAfterSetup(0);
    setTimerRunning(false);
    setTimerStartAt(null);
    setTimerElapsedMs(0);
  }, [setupAlgForOrientation, smartCubeGyroSession]);

  useEffect(() => {
    const complete =
      setupGuideSteps.length > 0 &&
      setupGuideSteps.every((step) => step.doneAtoms >= step.atoms.length);
    setSetupGuideComplete(complete);
    setupGuideCompleteRef.current = complete;
  }, [setupGuideSteps]);

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
    if (!smartCubeConnected || !setupGuideComplete || timerRunning || movesAfterSetup === 0) {
      return;
    }
    const startedAt = performance.now();
    setTimerStartAt(startedAt);
    setTimerRunning(true);
  }, [smartCubeConnected, setupGuideComplete, timerRunning, movesAfterSetup]);

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
    if (!timerRunning || !currentLivePattern || !solvedTargetPattern) {
      return;
    }
    const exactMatch = currentLivePattern.isIdentical(solvedTargetPattern);
    const crossGoalMatch =
      stage === "cross" &&
      solvedPattern &&
      isCrossSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
      );
    const stageGoalMatch =
      stage !== "cross" &&
      requiredSolvedSlots.length > 0 &&
      solvedPattern &&
      areSlotsSolved(
        currentLivePattern as unknown as { patternData: Record<string, any> },
        solvedPattern as unknown as { patternData: Record<string, any> },
        requiredSolvedSlots,
      );
    if (exactMatch || crossGoalMatch || stageGoalMatch) {
      setTimerRunning(false);
      if (timerStartAt !== null) {
        setTimerElapsedMs(performance.now() - timerStartAt);
      }
    }
  }, [
    timerRunning,
    currentLivePattern,
    solvedTargetPattern,
    stage,
    timerStartAt,
    requiredSolvedSlots,
    solvedPattern,
  ]);

  async function generateScramble() {
    setIsLoadingScramble(true);
    try {
      const next = await randomScrambleForEvent("333");
      setScramble(next.toString());
    } finally {
      setIsLoadingScramble(false);
    }
  }

  function randomTrainingCase() {
    resetLiveMoveHistory();
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
        {stages.map((item) => (
          <button
            key={item}
            className={stage === item ? "active" : ""}
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
              <p className="eyebrow">{stageMeta[stage].caseLabel}</p>
              <h2>{stageMeta[stage].title}</h2>
            </div>
            <BookOpen size={20} />
          </div>
          <p className="muted">{stageMeta[stage].subtitle}</p>

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
            <button className="ghost-button" onClick={generateScramble}>
              <TimerReset size={18} />
              {isLoadingScramble ? "Loading" : "WCA scramble"}
            </button>
          </div>

          <div className="scramble-box">
            <div>
              <span>Full solve scramble</span>
              <ChevronRight size={16} />
            </div>
            <code>{scramble}</code>
          </div>
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
          <AlgorithmCard activeCase={activeCaseWithTrainingSetup} />
        </div>

        <SmartCubePanel
          onMove={handleSmartCubeMove}
          onGyro={handleSmartCubeGyro}
          onConnectionChange={handleSmartCubeConnectionChange}
          onResetLiveState={handleSmartCubeResetLiveState}
          cubeOrientation={cubeOrientation}
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
