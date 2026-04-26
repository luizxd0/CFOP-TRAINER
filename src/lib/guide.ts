import { splitAlgTokens } from "./notation";

export type GuideStepState = "pending" | "partial" | "done";
export type GuideStepInternal = {
  label: string;
  atoms: string[];
  doneAtoms: number;
};

export function tokenToAtoms(token: string): string[] {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const face = trimmed[0];
  const suffix = trimmed.slice(1);
  if (suffix.startsWith("2")) {
    const quarter = suffix.includes("'") ? `${face}'` : face;
    return [quarter, quarter];
  }
  return [trimmed];
}

export function cloneGuideStep(step: GuideStepInternal): GuideStepInternal {
  return {
    label: step.label,
    atoms: [...step.atoms],
    doneAtoms: step.doneAtoms,
  };
}

function simplifyQuarterAtoms(atoms: string[]): string[] {
  const stack: Array<{ face: string; turns: number }> = [];
  for (const atom of atoms) {
    const trimmed = atom.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const face = trimmed[0].toUpperCase();
    if (!"UDRLFB".includes(face)) {
      continue;
    }
    const isPrime = trimmed.endsWith("'");
    const turns = isPrime ? 3 : 1;
    const top = stack[stack.length - 1];
    if (top && top.face === face) {
      top.turns = (top.turns + turns) % 4;
      if (top.turns === 0) {
        stack.pop();
      }
    } else {
      stack.push({ face, turns });
    }
  }
  const simplified: string[] = [];
  for (const item of stack) {
    if (item.turns === 1) {
      simplified.push(item.face);
    } else if (item.turns === 2) {
      simplified.push(item.face, item.face);
    } else if (item.turns === 3) {
      simplified.push(`${item.face}'`);
    }
  }
  return simplified;
}

function buildGuideStepsFromAtoms(atoms: string[]): GuideStepInternal[] {
  const next: GuideStepInternal[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const token = atoms[i];
    if (i + 1 < atoms.length && atoms[i + 1] === token) {
      const face = token[0].toUpperCase();
      next.push({
        label: `${face}2`,
        atoms: [token, token],
        doneAtoms: 0,
      });
      i += 1;
      continue;
    }
    next.push({
      label: token,
      atoms: [token],
      doneAtoms: 0,
    });
  }
  return next;
}

export function buildGuideStepsFromAlg(alg: string): GuideStepInternal[] {
  return splitAlgTokens(alg).map((token) => ({
    label: token,
    atoms: tokenToAtoms(token),
    doneAtoms: 0,
  }));
}

export function normalizePendingGuideSteps(steps: GuideStepInternal[]): GuideStepInternal[] {
  const firstPending = steps.findIndex((step) => step.doneAtoms < step.atoms.length);
  if (firstPending < 0) {
    return steps.map(cloneGuideStep);
  }
  const completed = steps.slice(0, firstPending).map(cloneGuideStep);
  const pendingAtoms = steps
    .slice(firstPending)
    .flatMap((step) => step.atoms.slice(step.doneAtoms));
  const simplified = simplifyQuarterAtoms(pendingAtoms);
  const rebuiltPending = buildGuideStepsFromAtoms(simplified);
  return [...completed, ...rebuiltPending];
}

export function guideStepView(step: GuideStepInternal): {
  label: string;
  state: GuideStepState;
  progress: number;
} {
  const total = Math.max(step.atoms.length, 1);
  const progress = Math.max(0, Math.min(1, step.doneAtoms / total));
  const state: GuideStepState =
    progress >= 1 ? "done" : progress > 0 ? "partial" : "pending";
  return {
    label: step.label,
    state,
    progress,
  };
}
