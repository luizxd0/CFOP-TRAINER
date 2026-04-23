import { Alg } from "cubing/alg";

export type Stage = "cross" | "f2l" | "oll" | "pll";

export interface AlgorithmCase {
  id: string;
  stage: Stage;
  name: string;
  group: string;
  difficulty: number;
  recognition: string;
  baseSetup: string;
  setup: string;
  solutions: Array<{
    alg: string;
    label: string;
    source: string;
    notes: string;
  }>;
}

const inverse = (alg: string) => new Alg(alg).invert().toString();

const caseFromSolution = (
  item: Omit<AlgorithmCase, "baseSetup" | "setup" | "solutions"> & {
    solution: string;
    source: string;
    notes: string;
    setup?: string;
  },
): AlgorithmCase => ({
  id: item.id,
  stage: item.stage,
  name: item.name,
  group: item.group,
  difficulty: item.difficulty,
  recognition: item.recognition,
  baseSetup: item.setup ?? inverse(item.solution),
  setup: item.setup ?? inverse(item.solution),
  solutions: [
    {
      alg: item.solution,
      label: "Main",
      source: item.source,
      notes: item.notes,
    },
  ],
});

export const crossCases: AlgorithmCase[] = [
  caseFromSolution({
    id: "cross-1",
    stage: "cross",
    name: "1 move cross",
    group: "White cross",
    difficulty: 1,
    recognition: "One cross edge is flipped out of place.",
    solution: "F",
    source: "Generated cross drill",
    notes: "Useful for warming up exact color orientation.",
  }),
  caseFromSolution({
    id: "cross-2",
    stage: "cross",
    name: "2 move cross",
    group: "White cross",
    difficulty: 2,
    recognition: "One edge is one setup move away from the D layer.",
    solution: "R F",
    source: "Generated cross drill",
    notes: "Track the affected side color before turning.",
  }),
  caseFromSolution({
    id: "cross-3",
    stage: "cross",
    name: "3 move cross",
    group: "White cross",
    difficulty: 3,
    recognition: "Two short insertions share a face.",
    solution: "U R F",
    source: "Generated cross drill",
    notes: "Try planning all moves before touching the cube.",
  }),
  caseFromSolution({
    id: "cross-4",
    stage: "cross",
    name: "4 move cross",
    group: "White cross",
    difficulty: 4,
    recognition: "A simple four-move line with no regrips required.",
    solution: "F R U R'",
    source: "Generated cross drill",
    notes: "Aim for one continuous turn sequence.",
  }),
  caseFromSolution({
    id: "cross-5",
    stage: "cross",
    name: "5 move cross",
    group: "White cross",
    difficulty: 5,
    recognition: "One edge needs preserving while another is inserted.",
    solution: "D R F U R'",
    source: "Generated cross drill",
    notes: "Keep the solved edge on D while solving the next one.",
  }),
  caseFromSolution({
    id: "cross-6",
    stage: "cross",
    name: "6 move cross",
    group: "White cross",
    difficulty: 6,
    recognition: "A moderate cross that rewards tracking two edges.",
    solution: "F U R D R' F'",
    source: "Generated cross drill",
    notes: "Look for a rotationless execution.",
  }),
  caseFromSolution({
    id: "cross-7",
    stage: "cross",
    name: "7 move cross",
    group: "White cross",
    difficulty: 7,
    recognition: "Three edges are coordinated through U and D layers.",
    solution: "R U F D R' U' F'",
    source: "Generated cross drill",
    notes: "Good for inspection discipline.",
  }),
  caseFromSolution({
    id: "cross-8",
    stage: "cross",
    name: "8 move cross",
    group: "White cross",
    difficulty: 8,
    recognition: "Full cross planning drill at realistic solve difficulty.",
    solution: "F R U R' D F' U' R",
    source: "Generated cross drill",
    notes: "Eight moves is the practical upper bound for any cross.",
  }),
];

const F2L_41_DATA: Array<{ id: number; setup: string; solution: string }> = [
  { id: 1, setup: "R U R' U' R U' R' U2", solution: "U2 (R U R') U (R U' R')" },
  { id: 2, setup: "R U R' U' R U2 R' U'", solution: "U (R U2 R') U (R U' R')" },
  { id: 3, setup: "R' D' R U2 R' D R2 U R'", solution: "U (R U' R') U' (R U' R' U R U' R')" },
  { id: 4, setup: "R U' R' U R U2 R'", solution: "(R U2 R') U' (R U R')" },
  { id: 5, setup: "L' U' L U L' U L U2 y'", solution: "y U2 (L' U' L) U' (L' U L)" },
  { id: 6, setup: "L' U' L U L' U2 L U y'", solution: "y U' (L' U2 L) U' (L' U L)" },
  { id: 7, setup: "R U R' F R U R' U' F'", solution: "y U' (L' U L) U (L' U L U' L' U L)" },
  { id: 8, setup: "L' U L U' L' U2 L y'", solution: "y (L' U2 L) U (L' U' L)" },
  { id: 9, setup: "R U' R'", solution: "(R U R')" },
  { id: 10, setup: "R U' R' U' R U' R' U", solution: "U' (R U R') U (R U R')" },
  { id: 11, setup: "R' U' R2 U' R2 U2 R", solution: "R' U2 R2 U R2' U R" },
  { id: 12, setup: "R U' R' U' R U R' U", solution: "U' (R U' R') U (R U R')" },
  { id: 13, setup: "L' U L y'", solution: "y (L' U' L)" },
  { id: 14, setup: "L' U L U L' U L U' y'", solution: "y U (L' U' L) U' (L' U' L)" },
  { id: 15, setup: "L U L2 U L2 U2 L' y'", solution: "y L U2 L2' U' L2 U' L'" },
  { id: 16, setup: "L' U L U L' U' L U' y'", solution: "y U (L' U L) U' (L' U' L)" },
  { id: 17, setup: "L' U' L U y'", solution: "y U' (L' U L)" },
  { id: 18, setup: "L' U' L U2 L' U2 L U' y'", solution: "y U (L' U2 L) U2 (L' U L)" },
  { id: 19, setup: "R U R' U2 R U' R' U", solution: "U' (R U R') U2 (R U' R')" },
  { id: 20, setup: "R U R' U' R' D' R U R' D R", solution: "M U (L F' L') U' M'" },
  { id: 21, setup: "R U R' U'", solution: "U (R U' R')" },
  { id: 22, setup: "R U R' U2 R U2 R' U", solution: "U' (R U2 R') U2 (R U' R')" },
  { id: 23, setup: "L' U' L U2 L' U L U' y'", solution: "y U (L' U' L) U2 (L' U L)" },
  { id: 24, setup: "L' U L y' U2 R U R'", solution: "(R U' R') U2 y (L' U' L)" },
  { id: 25, setup: "R U' R' U2 R U' R' U'", solution: "U (R U R') U2 (R U R')" },
  { id: 26, setup: "R U R' U2 R U R' U", solution: "U' R U' R' U2 R U' R'" },
  { id: 27, setup: "(U R U' R') (U R U' R') (U R U' R')", solution: "(U R U' R')3" },
  { id: 28, setup: "R U' R' U F' U F U'", solution: "U (F' U' F) U' (R U R')" },
  { id: 29, setup: "L' U L y' U' R U' R' U", solution: "U' (R U R') U y (L' U' L)" },
  { id: 30, setup: "R U R' F R' F' R U", solution: "U' (R' F R F') (R U' R')" },
  { id: 31, setup: "R U' R' U R U' R'", solution: "(R U R') U' (R U R')" },
  { id: 32, setup: "R U R' U' R U R'", solution: "(R U' R') U (R U' R')" },
  { id: 33, setup: "R U' R' F R' F' R U", solution: "U' (R' F R F') (R U R')" },
  { id: 34, setup: "L' U L U' L' U L y'", solution: "y (L' U' L) U (L' U' L)" },
  { id: 35, setup: "L' U' L U L' U' L y'", solution: "y (L' U L) U' (L' U L)" },
  { id: 36, setup: "L' U' L y' U R U R' U'", solution: "U (R U' R' U') y (L' U L)" },
  { id: 37, setup: "R U R' U' R U2 R' U' R U R'", solution: "(R U' R') U (R U2 R') U (R U' R')" },
  { id: 38, setup: "R U R' U2 R U' R' U R U R'", solution: "(R U' R') U' (R U R') U2 (R U' R')" },
  { id: 39, setup: "F' U F U' R U2 R' U' R U2 R'", solution: "(R U2 R') U (R U2 R') U (F' U' F)" },
  { id: 40, setup: "r U' r' U2 r U r' R U R'", solution: "(R U' R') (r U' r') U2 (r U r')" },
  { id: 41, setup: "R U' R' r U' r' U2 r U r'", solution: "(r U' r') U2 (r U r') (R U R')" },
];

function f2lDifficultyFromId(id: number): number {
  if (id <= 8) return 1;
  if (id <= 16) return 2;
  if (id <= 24) return 3;
  if (id <= 32) return 4;
  return 5;
}

function f2lGroupFromId(id: number): string {
  if (id <= 8) return "Cases 1-8";
  if (id <= 16) return "Cases 9-16";
  if (id <= 24) return "Cases 17-24";
  if (id <= 32) return "Cases 25-32";
  return "Cases 33-41";
}

export const f2lCases: AlgorithmCase[] = F2L_41_DATA.map((entry) =>
  caseFromSolution({
    id: `f2l-${String(entry.id).padStart(2, "0")}`,
    stage: "f2l",
    name: `F2L Case ${String(entry.id).padStart(2, "0")}`,
    group: f2lGroupFromId(entry.id),
    difficulty: f2lDifficultyFromId(entry.id),
    recognition: `Official J Perm Best F2L case #${entry.id}.`,
    setup: entry.setup,
    solution: entry.solution,
    source: "J Perm Best F2L Algorithms (bit.ly/bestf2l)",
    notes: "Primary algorithm from the J Perm 41-case sheet set.",
  }),
);

export const ollCases: AlgorithmCase[] = [
  caseFromSolution({
    id: "oll-21",
    stage: "oll",
    name: "OLL 21",
    group: "Cross OLL",
    difficulty: 2,
    recognition: "All edges oriented; headlights on the front.",
    solution: "R U2 R' U' R U R' U' R U' R'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "A very standard OLL with simple R/U flow.",
  }),
  caseFromSolution({
    id: "oll-22",
    stage: "oll",
    name: "OLL 22",
    group: "Cross OLL",
    difficulty: 2,
    recognition: "All edges oriented; no headlights.",
    solution: "R U2 R2 U' R2 U' R2 U2 R",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Keep the R2 turns crisp.",
  }),
  caseFromSolution({
    id: "oll-23",
    stage: "oll",
    name: "OLL 23",
    group: "Cross OLL",
    difficulty: 3,
    recognition: "All edges oriented; one solved corner block.",
    solution: "R2 D R' U2 R D' R' U2 R'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Commonly called a headlights OLL.",
  }),
  caseFromSolution({
    id: "oll-24",
    stage: "oll",
    name: "OLL 24",
    group: "Cross OLL",
    difficulty: 3,
    recognition: "All edges oriented; anti-sune corner orientation.",
    solution: "r U R' U' r' F R F'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "A clean wide-move solution.",
  }),
  caseFromSolution({
    id: "oll-25",
    stage: "oll",
    name: "OLL 25",
    group: "Cross OLL",
    difficulty: 3,
    recognition: "All edges oriented; sune-like corner orientation.",
    solution: "F' r U R' U' r' F R",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Pairs well with OLL 24 recognition.",
  }),
  caseFromSolution({
    id: "oll-26",
    stage: "oll",
    name: "Anti-Sune",
    group: "Corners",
    difficulty: 1,
    recognition: "One oriented corner; anti-sune shape.",
    solution: "R U2 R' U' R U' R'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Essential beginner-to-full OLL bridge.",
  }),
  caseFromSolution({
    id: "oll-27",
    stage: "oll",
    name: "Sune",
    group: "Corners",
    difficulty: 1,
    recognition: "One oriented corner; sune shape.",
    solution: "R U R' U R U2 R'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "One of the most important OLL algs.",
  }),
  caseFromSolution({
    id: "oll-45",
    stage: "oll",
    name: "T shape",
    group: "No dot",
    difficulty: 2,
    recognition: "Top stickers form a T shape.",
    solution: "F R U R' U' F'",
    source: "2-look OLL / JPerm common alg",
    notes: "Also the standard last-layer edge orientation trigger.",
  }),
  caseFromSolution({
    id: "oll-44",
    stage: "oll",
    name: "P shape",
    group: "No dot",
    difficulty: 2,
    recognition: "P shape on top with the block on the left.",
    solution: "f R U R' U' f'",
    source: "2-look OLL / JPerm common alg",
    notes: "Lowercase f means a wide front move.",
  }),
  caseFromSolution({
    id: "oll-48",
    stage: "oll",
    name: "Small L",
    group: "No dot",
    difficulty: 3,
    recognition: "Small L shape with two adjacent oriented corners.",
    solution: "F R U R' U' R U R' U' F'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "A reliable beginner-friendly full OLL alg.",
  }),
  caseFromSolution({
    id: "oll-57",
    stage: "oll",
    name: "H shape",
    group: "Edges oriented",
    difficulty: 2,
    recognition: "Top has an H pattern.",
    solution: "R U R' U' M' U R U' r'",
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Efficient if M moves are comfortable.",
  }),
  caseFromSolution({
    id: "oll-dot",
    stage: "oll",
    name: "Dot edges",
    group: "Dot OLL",
    difficulty: 4,
    recognition: "No last-layer edges are oriented.",
    solution: "F R U R' U' F' f R U R' U' f'",
    source: "2-look OLL / JPerm common alg",
    notes: "Practical dot-case baseline.",
  }),
];

export const pllCases: AlgorithmCase[] = [
  ["Aa", "Adjacent corner 3-cycle", "x R' U R' D2 R U' R' D2 R2 x'", 3],
  ["Ab", "Adjacent corner 3-cycle", "x R2 D2 R U R' D2 R U' R x'", 3],
  ["E", "Diagonal corner swap", "x' R U' R' D R U R' D' R U R' D R U' R' D' x", 5],
  ["F", "Corner and edge swap", "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R", 5],
  ["Ga", "G permutation", "R2 U R' U R' U' R U' R2 D U' R' U R D'", 5],
  ["Gb", "G permutation", "R' U' R U D' R2 U R' U R U' R U' R2 D", 5],
  ["Gc", "G permutation", "R2 U' R U' R U R' U R2 D' U R U' R' D", 5],
  ["Gd", "G permutation", "R U R' U' D R2 U' R U' R' U R' U R2 D'", 5],
  ["H", "Opposite edge swaps", "M2 U M2 U2 M2 U M2", 1],
  ["Ja", "Adjacent corner and edge swap", "x R2 F R F' R U2 r' U r U2 x'", 4],
  ["Jb", "Adjacent corner and edge swap", "R U R' F' R U R' U' R' F R2 U' R'", 2],
  ["Na", "Diagonal blocks", "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'", 6],
  ["Nb", "Diagonal blocks", "R' U R U' R' F' U' F R U R' F R' F' R U' R", 6],
  ["Ra", "R permutation", "R U' R' U' R U R D R' U' R D' R' U2 R'", 4],
  ["Rb", "R permutation", "R2 F R U R U' R' F' R U2 R' U2 R", 4],
  ["T", "Headlights with adjacent swap", "R U R' U' R' F R2 U' R' U' R U R' F'", 2],
  ["Ua", "Edge 3-cycle clockwise", "R U' R U R U R U' R' U' R2", 1],
  ["Ub", "Edge 3-cycle counterclockwise", "R2 U R U R' U' R' U' R' U R'", 1],
  ["V", "Diagonal corner and edge swap", "R' U R' U' y R' F' R2 U' R' U R' F R F", 5],
  ["Y", "Diagonal corner swap with edges", "F R U' R' U' R U R' F' R U R' U' R' F R F'", 4],
  ["Z", "Opposite edge 3-cycle", "M' U M2 U M2 U M' U2 M2", 2],
].map(([name, recognition, solution, difficulty]) =>
  caseFromSolution({
    id: `pll-${String(name).toLowerCase()}`,
    stage: "pll",
    name: `${name} perm`,
    group: "Full PLL",
    difficulty: Number(difficulty),
    recognition: String(recognition),
    solution: String(solution),
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Mainstream speedsolving PLL choice.",
  }),
);

export const allCases = [...crossCases, ...f2lCases, ...ollCases, ...pllCases];

export const stageMeta: Record<
  Stage,
  { title: string; subtitle: string; caseLabel: string }
> = {
  cross: {
    title: "Cross",
    subtitle: "Choose an exact move target and train planning before execution.",
    caseLabel: "Move target",
  },
  f2l: {
    title: "F2L",
    subtitle: "Pick a pair case, set it up, and drill a pro-style solution.",
    caseLabel: "Case",
  },
  oll: {
    title: "OLL",
    subtitle: "Recognize the last-layer orientation and execute one-look OLLs.",
    caseLabel: "Case",
  },
  pll: {
    title: "PLL",
    subtitle: "Practice recognition and high-quality full PLL algorithms.",
    caseLabel: "Case",
  },
};
