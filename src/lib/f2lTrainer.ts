import { Alg } from "cubing/alg";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import type { CubeKpuzzle } from "./cubePattern";
import { stripCubeRotations, toPlainAlgText, simplifyAlgText } from "./notation";
import { joinAlgs } from "./trainer";

function invertAlgToPlain(alg: string): string {
  const normalized = alg.trim();
  if (!normalized) {
    return "";
  }
  try {
    return toPlainAlgText(new Alg(normalized).invert().toString());
  } catch {
    return "";
  }
}

export function normalizeF2LCaseSetup(caseSetup: string): string {
  return simplifyAlgText(toPlainAlgText(caseSetup));
}

type BuildF2LSetupFromCurrentStateParams = {
  kpuzzle: CubeKpuzzle | null;
  currentStateAlg: string;
  caseSetupAlg: string;
};

export async function buildF2LSetupFromCurrentState(
  params: BuildF2LSetupFromCurrentStateParams,
): Promise<string> {
  const { kpuzzle, currentStateAlg, caseSetupAlg } = params;
  const normalizedCaseSetup = normalizeF2LCaseSetup(caseSetupAlg);
  if (!kpuzzle) {
    return simplifyAlgText(
      joinAlgs([invertAlgToPlain(currentStateAlg), normalizedCaseSetup]),
    );
  }

  const currentPattern = kpuzzle.defaultPattern().applyAlg(currentStateAlg);
  const targetCasePattern = kpuzzle.defaultPattern().applyAlg(normalizedCaseSetup);
  const [currentToSolvedAlg, caseToSolvedAlg] = await Promise.all([
    experimentalSolve3x3x3IgnoringCenters(currentPattern),
    experimentalSolve3x3x3IgnoringCenters(targetCasePattern),
  ]);

  const currentToSolved = toPlainAlgText(
    stripCubeRotations(currentToSolvedAlg.toString()),
  );
  const solvedToCase = invertAlgToPlain(
    stripCubeRotations(caseToSolvedAlg.toString()),
  );
  return simplifyAlgText(joinAlgs([currentToSolved, solvedToCase]));
}

