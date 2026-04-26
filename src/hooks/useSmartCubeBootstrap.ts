import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alg } from "cubing/alg";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { SOLVED_FACELET } from "../../vendor/smartcube-web-bluetooth/src/smartcube/cubie-cube";
import type { CubeKpuzzle, GyroQuaternion } from "../lib/cubePattern";
import { splitAlgTokens, stripCubeRotations } from "../lib/notation";
import { maskFacelets, smartCubeDebug } from "../lib/smartcubeUtils";
import { patternFromFacelets } from "../lib/cubePattern";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseSmartCubeBootstrapParams = {
  cubeKpuzzle: CubeKpuzzle | null;
  smartCubeConnected: boolean;
  setSmartCubeConnected: SetState<boolean>;
  setSmartCubeStateBootstrapped: SetState<boolean>;
  setSmartCubeGyro: SetState<GyroQuaternion | null>;
  setSmartCubeGyroSession: SetState<number>;
  onBootstrapMoves: (nextMoves: string[]) => void;
  onConnectedReset: () => void;
  onDisconnectedReset: () => void;
};

export function useSmartCubeBootstrap(params: UseSmartCubeBootstrapParams) {
  const {
    cubeKpuzzle,
    smartCubeConnected,
    setSmartCubeConnected,
    setSmartCubeStateBootstrapped,
    setSmartCubeGyro,
    setSmartCubeGyroSession,
    onBootstrapMoves,
    onConnectedReset,
    onDisconnectedReset,
  } = params;

  const pendingFaceletsBootstrapRef = useRef(false);
  const pendingFaceletsValueRef = useRef<string | null>(null);
  const bootstrappingFaceletsRef = useRef(false);
  const solvedFaceletsBootstrapStreakRef = useRef(0);

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
        setSmartCubeStateBootstrapped(true);
        onBootstrapMoves(nextMoves);
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
  }, [cubeKpuzzle, onBootstrapMoves, setSmartCubeStateBootstrapped, smartCubeConnected]);

  const handleSmartCubeFacelets = useCallback((facelets: string) => {
    smartCubeDebug("handle facelets", {
      preview: maskFacelets(facelets),
    });
    pendingFaceletsValueRef.current = facelets;
    attemptFaceletsBootstrap();
  }, [attemptFaceletsBootstrap]);

  useEffect(() => {
    attemptFaceletsBootstrap();
  }, [attemptFaceletsBootstrap]);

  const handleSmartCubeConnectionChange = useCallback((connected: boolean) => {
    setSmartCubeConnected(connected);
    if (connected) {
      setSmartCubeStateBootstrapped(false);
      solvedFaceletsBootstrapStreakRef.current = 0;
      pendingFaceletsBootstrapRef.current = true;
      pendingFaceletsValueRef.current = null;
      setSmartCubeGyroSession((current) => current + 1);
      onConnectedReset();
      return;
    }
    pendingFaceletsBootstrapRef.current = false;
    pendingFaceletsValueRef.current = null;
    setSmartCubeStateBootstrapped(false);
    solvedFaceletsBootstrapStreakRef.current = 0;
    setSmartCubeGyro(null);
    onDisconnectedReset();
  }, [
    onConnectedReset,
    onDisconnectedReset,
    setSmartCubeConnected,
    setSmartCubeGyro,
    setSmartCubeGyroSession,
    setSmartCubeStateBootstrapped,
  ]);

  const handleSmartCubeResetLiveState = useCallback(() => {
    pendingFaceletsBootstrapRef.current = false;
    pendingFaceletsValueRef.current = null;
    setSmartCubeStateBootstrapped(false);
    solvedFaceletsBootstrapStreakRef.current = 0;
    onDisconnectedReset();
    setSmartCubeGyro(null);
    setSmartCubeGyroSession((current) => current + 1);
  }, [onDisconnectedReset, setSmartCubeGyro, setSmartCubeGyroSession, setSmartCubeStateBootstrapped]);

  return {
    handleSmartCubeFacelets,
    handleSmartCubeConnectionChange,
    handleSmartCubeResetLiveState,
  };
}
