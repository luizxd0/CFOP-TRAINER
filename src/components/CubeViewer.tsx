import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PlayCircle } from "lucide-react";
import { TwistyPlayer } from "cubing/twisty";
import { moveCount, joinAlgs } from "../lib/trainer";
import { orientationPrefix, splitAlgTokens, type CubeOrientation } from "../lib/notation";
import type { GyroQuaternion } from "../lib/cubePattern";

type CubeSkin = "classic" | "f2l";
type GuideStepState = "pending" | "partial" | "done";

const FULL_STICKERING_MASK = "EDGES:------------,CORNERS:--------,CENTERS:------";
const F2L_STICKERING_MASK_BY_ORIENTATION: Record<CubeOrientation, string> = {
  "white-top": "EDGES:IIII--------,CORNERS:IIII----,CENTERS:I-----",
  "yellow-top": "EDGES:----IIII----,CORNERS:----IIII,CENTERS:-----I",
};

export function CubeViewer({
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
