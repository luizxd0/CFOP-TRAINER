import { Move } from "cubing/alg";

function normalizeAmount(amount: number): number {
  const mod = ((amount % 4) + 4) % 4;
  return mod;
}

function tokenFromFamilyAndAmount(family: string, normalizedAmount: number): string | null {
  if (normalizedAmount === 0) {
    return null;
  }
  if (normalizedAmount === 1) {
    return family;
  }
  if (normalizedAmount === 2) {
    return `${family}2`;
  }
  return `${family}'`;
}

export function appendCompressedDisplayMove(
  current: string[],
  nextToken: string,
  maxLength = 19,
): string[] {
  const trimmed = nextToken.trim();
  if (!trimmed) {
    return current;
  }

  const next = [...current];
  const lastToken = next[next.length - 1];
  if (lastToken) {
    try {
      const lastMove = Move.fromString(lastToken);
      const incomingMove = Move.fromString(trimmed);
      if (lastMove.family === incomingMove.family) {
        const combined = tokenFromFamilyAndAmount(
          incomingMove.family,
          normalizeAmount(lastMove.amount + incomingMove.amount),
        );
        next.pop();
        if (combined) {
          next.push(combined);
        }
        return next.slice(-maxLength);
      }
    } catch {
      // Fall through to simple append.
    }
  }

  next.push(trimmed);
  return next.slice(-maxLength);
}
