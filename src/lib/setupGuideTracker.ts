import { invertMoveToken, remapMoveForOrientation, type CubeOrientation } from "./notation";
import { cloneGuideStep, tokenToAtoms, type GuideStepInternal } from "./guide";

export function guideAtomsFromRawMove(
  incomingRawMove: string,
  cubeOrientation: CubeOrientation,
) {
  const normalizedToken = remapMoveForOrientation(incomingRawMove, cubeOrientation).trim();
  return tokenToAtoms(normalizedToken)
    .map((atom) => atom.trim())
    .filter((atom) => atom.length > 0);
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

function pendingAtomsFromSteps(steps: GuideStepInternal[]): string[] {
  return steps.flatMap((step) => step.atoms.slice(step.doneAtoms));
}

function applyMoveToGuideSteps(
  steps: GuideStepInternal[],
  normalizedMove: string,
): GuideStepInternal[] {
  const next = steps.map(cloneGuideStep);
  const activeIndex = next.findIndex((step) => step.doneAtoms < step.atoms.length);
  if (activeIndex < 0) {
    return next;
  }
  const active = next[activeIndex];

  if (active.atoms.length === 2 && active.doneAtoms === 0) {
    const primary = active.atoms[0];
    const opposite = invertMoveToken(primary);
    if (normalizedMove === primary || normalizedMove === opposite) {
      if (normalizedMove === opposite) {
        active.atoms = [opposite, opposite];
      }
      active.doneAtoms = 1;
      return next;
    }
  }

  const expected = active.atoms[active.doneAtoms];
  if (normalizedMove === expected) {
    active.doneAtoms += 1;
    return next;
  }

  if (
    active.atoms.length === 2 &&
    active.doneAtoms === 1 &&
    normalizedMove === invertMoveToken(active.atoms[0])
  ) {
    // For things like U2, opposite second turn cancels the half progress.
    active.doneAtoms = 0;
    return next;
  }

  // Wrong move: rewrite setup from current state by prepending the inverse.
  const pendingAtoms = pendingAtomsFromSteps(next);
  const adjustedAtoms = simplifyQuarterAtoms([invertMoveToken(normalizedMove), ...pendingAtoms]);
  return buildGuideStepsFromAtoms(adjustedAtoms);
}

export function advanceSetupGuideSteps(
  currentSteps: GuideStepInternal[],
  incomingRawMove: string,
  cubeOrientation: CubeOrientation,
) {
  if (currentSteps.length === 0) {
    return currentSteps;
  }
  const incomingAtoms = guideAtomsFromRawMove(incomingRawMove, cubeOrientation);
  if (incomingAtoms.length === 0) {
    return currentSteps.map(cloneGuideStep);
  }

  let next = currentSteps.map(cloneGuideStep);
  for (const normalizedMove of incomingAtoms) {
    next = applyMoveToGuideSteps(next, normalizedMove);
  }
  return next;
}
