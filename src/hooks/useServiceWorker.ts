import { useEffect } from "react";

export function useServiceWorker() {
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
}
