import React, { useEffect, useRef, useState } from "react";
import type { AlgorithmCase } from "../data/cfopData";
import type { CubeOrientation } from "../lib/notation";
import { orientationPrefix } from "../lib/notation";
import { joinAlgs } from "../lib/trainer";
import {
  readCasePreviewFromCache,
  requestCasePreview,
  subscribeCasePreview,
} from "../lib/casePreview";
import type { CubeSkin } from "../types/app";

const FULL_STICKERING_MASK = "EDGES:------------,CORNERS:--------,CENTERS:------";
const F2L_STICKERING_MASK_BY_ORIENTATION: Record<CubeOrientation, string> = {
  "white-top": "EDGES:IIII--------,CORNERS:IIII----,CENTERS:I-----",
  "yellow-top": "EDGES:----IIII----,CORNERS:----IIII,CENTERS:-----I",
};

export function CasePreview({
  activeCase,
  cubeOrientation,
  cubeSkin = "classic",
  compact = false,
}: {
  activeCase: AlgorithmCase;
  cubeOrientation: CubeOrientation;
  cubeSkin?: CubeSkin;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setup = joinAlgs([
    orientationPrefix(cubeOrientation),
    activeCase.diagramSetup ?? activeCase.baseSetup,
  ]);
  const stickeringMask =
    cubeSkin === "f2l"
      ? F2L_STICKERING_MASK_BY_ORIENTATION[cubeOrientation]
      : FULL_STICKERING_MASK;
  const previewKey = `${setup}|${stickeringMask}|${compact ? "compact" : "detail"}`;
  const [previewSrc, setPreviewSrc] = useState(() => readCasePreviewFromCache(previewKey));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setPreviewSrc(readCasePreviewFromCache(previewKey));
  }, [previewKey]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "220px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || previewSrc) {
      return;
    }
    let cancelled = false;
    const unsubscribe = subscribeCasePreview(previewKey, () => {
      if (!cancelled) {
        setPreviewSrc(readCasePreviewFromCache(previewKey));
      }
    });
    void requestCasePreview({ key: previewKey, setup, compact, stickeringMask }).then((src) => {
      if (!cancelled) {
        setPreviewSrc(src);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [compact, previewKey, previewSrc, setup, stickeringMask, visible]);

  return (
    <div className={compact ? "case-preview compact" : "case-preview"} ref={hostRef}>
      {previewSrc ? (
        <img src={previewSrc} alt={`${activeCase.name} preview`} />
      ) : (
        <span>Loading preview...</span>
      )}
    </div>
  );
}
