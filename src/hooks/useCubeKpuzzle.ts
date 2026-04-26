import { useEffect, useState } from "react";
import { cube3x3x3 } from "cubing/puzzles";
import type { CubeKpuzzle } from "../lib/cubePattern";

export function useCubeKpuzzle() {
  const [cubeKpuzzle, setCubeKpuzzle] = useState<CubeKpuzzle | null>(null);

  useEffect(() => {
    let cancelled = false;
    void cube3x3x3.kpuzzle().then((kpuzzle) => {
      if (!cancelled) {
        setCubeKpuzzle(kpuzzle);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return cubeKpuzzle;
}
