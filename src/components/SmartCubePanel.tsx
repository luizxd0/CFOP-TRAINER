import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Bluetooth,
  Eye,
  EyeOff,
  ListRestart,
  Radio,
  TimerReset,
} from "lucide-react";
import {
  connectSmartCube as connectAnySmartCube,
  type SmartCubeConnection,
} from "../../vendor/smartcube-web-bluetooth/src/smartcube/index";
import type { MacAddressProvider } from "../../vendor/smartcube-web-bluetooth/src/smartcube/types";
import { formatMs } from "../lib/time";
import type { CubeOrientation } from "../lib/notation";
import { remapMoveForOrientation, remapMoveForPerspective } from "../lib/notation";
import { normalizeQuaternion, type GyroQuaternion } from "../lib/cubePattern";
import type { SolveRecord } from "../types/app";
import {
  isMissingCubeMacError,
  maskFacelets,
  readManualMacForDevice,
  smartCubeDebug,
  webBluetoothBlockReason,
} from "../lib/smartcubeUtils";

export function SmartCubePanel({
  onMove,
  onGyro,
  onFacelets,
  onConnectionChange,
  onResetLiveState,
  liveStateReady,
  cubeOrientation,
  moveRemapOrientation,
  recentSolves,
}: {
  onMove?: (move: { raw: string; display: string }) => void;
  onGyro?: (quaternion: GyroQuaternion | null) => void;
  onFacelets?: (facelets: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onResetLiveState?: () => void;
  liveStateReady: boolean;
  cubeOrientation: CubeOrientation;
  /** Face-letter remap for live move display; defaults to cubeOrientation. */
  moveRemapOrientation?: CubeOrientation;
  recentSolves: SolveRecord[];
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
            const orientedMove = remapMoveForOrientation(
              move,
              moveRemapOrientation ?? cubeOrientation,
            );
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
    () => [...recentSolves].sort((a, b) => a.totalMs - b.totalMs).slice(0, 5),
    [recentSolves],
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
                {index + 1}. {formatMs(solve.totalMs)} | {solve.totalMoves} moves
              </p>
            ))}
            <p>Average: {rankedAverageMs === null ? "--" : formatMs(rankedAverageMs)}</p>
          </>
        )}
      </div>
    </section>
  );
}
