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

export function CasePreview({
  activeCase,
  cubeOrientation,
  compact = false,
}: {
  activeCase: AlgorithmCase;
  cubeOrientation: CubeOrientation;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setup = joinAlgs([
    orientationPrefix(cubeOrientation),
    activeCase.diagramSetup ?? activeCase.baseSetup,
  ]);
  const previewKey = `${setup}|${compact ? "compact" : "detail"}`;
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
    void requestCasePreview({ key: previewKey, setup, compact }).then((src) => {
      if (!cancelled) {
        setPreviewSrc(src);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [compact, previewKey, previewSrc, setup, visible]);

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
