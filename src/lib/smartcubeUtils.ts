const SMARTCUBE_MANUAL_MAC_KEY = "smartcubeManualMacByDevice:";
const SMARTCUBE_DEBUG = true;

export function isMissingCubeMacError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("unable to determine cube mac address");
}

export function webBluetoothBlockReason(): string | null {
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

export function smartCubeDebug(...args: unknown[]): void {
  if (!SMARTCUBE_DEBUG || typeof console === "undefined") {
    return;
  }
  console.log("[smartcube]", ...args);
}

export function normalizeMacAddress(input: string): string | null {
  const compact = input.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (compact.length !== 12) {
    return null;
  }
  const parts = compact.match(/.{1,2}/g);
  return parts ? parts.join(":") : null;
}

export function readManualMacForDevice(device: BluetoothDevice): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = `${SMARTCUBE_MANUAL_MAC_KEY}${device.id}`;
  const value = window.localStorage.getItem(key);
  return value && value.length > 0 ? value : null;
}

export function storeManualMacForDevice(device: BluetoothDevice, mac: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = `${SMARTCUBE_MANUAL_MAC_KEY}${device.id}`;
  window.localStorage.setItem(key, mac);
}

export function maskFacelets(facelets: string): string {
  return facelets.length <= 18 ? facelets : `${facelets.slice(0, 18)}...`;
}
