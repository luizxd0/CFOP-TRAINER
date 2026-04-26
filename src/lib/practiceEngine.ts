import type { AlgorithmCase } from "../data/cfopData";
import { deriveCaseSetup } from "./trainer";
import { stripCubeRotations, toPlainAlgText } from "./notation";

type CubeKpuzzleLike = {
  defaultPattern(): unknown;
};

export function resolveStageCaseSetup(
  stageCase: AlgorithmCase,
  _kpuzzle: CubeKpuzzleLike | null,
): string {
  if (stageCase.stage === "f2l") {
    const authored = stageCase.setup || stageCase.baseSetup || deriveCaseSetup(stageCase);
    return stripCubeRotations(toPlainAlgText(authored));
  }
  return stripCubeRotations(deriveCaseSetup(stageCase));
}
