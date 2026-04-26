import { useEffect } from "react";

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

export function useScreenWakeLock(enabled: boolean) {
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
        !enabled ||
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
    if (enabled) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [enabled]);
}
