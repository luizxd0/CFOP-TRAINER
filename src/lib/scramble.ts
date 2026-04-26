export function generateRandomScramble(length = 20): string {
  const faces = ["U", "D", "R", "L", "F", "B"] as const;
  const suffixes = ["", "'", "2"] as const;
  const axisByFace: Record<(typeof faces)[number], number> = {
    U: 0,
    D: 0,
    R: 1,
    L: 1,
    F: 2,
    B: 2,
  };
  const tokens: string[] = [];
  let prevFace: (typeof faces)[number] | null = null;
  let prevAxis: number | null = null;

  for (let i = 0; i < length; i += 1) {
    const candidates = faces.filter(
      (face) => face !== prevFace && axisByFace[face] !== prevAxis,
    );
    const face = candidates[Math.floor(Math.random() * candidates.length)] ?? faces[0];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)] ?? "";
    tokens.push(`${face}${suffix}`);
    prevFace = face;
    prevAxis = axisByFace[face];
  }

  return tokens.join(" ");
}
