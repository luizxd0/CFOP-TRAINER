export function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const hundredths = Math.floor((clamped % 1000) / 10);
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
  }
  return `${seconds}.${hundredths.toString().padStart(2, "0")}`;
}
