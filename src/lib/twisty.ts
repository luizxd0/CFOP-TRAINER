import { setTwistyDebug } from "cubing/twisty";

export function initTwistyDebug() {
  if (typeof window !== "undefined") {
    setTwistyDebug({ shareAllNewRenderers: "always" });
  }
}
