import { Alg } from "cubing/alg";

export type Stage = "cross" | "f2l" | "oll" | "pll";
export type LearningSubset = "2look-oll" | "2look-pll" | "full-oll" | "full-pll";

export interface AlgorithmCase {
  id: string;
  stage: Stage;
  name: string;
  group: string;
  difficulty: number;
  recognition: string;
  baseSetup: string;
  setup: string;
  subsets?: LearningSubset[];
  recognitionTags?: string[];
  diagramSetup?: string;
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
  subsets: item.subsets,
  recognitionTags: item.recognitionTags,
  diagramSetup: item.diagramSetup,
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

const TWO_LOOK_OLL_IDS = new Set([1, 21, 22, 23, 24, 25, 26, 27, 44, 45]);
const OLL_57_DATA: Array<{
  id: number;
  group: string;
  name?: string;
  recognition: string;
  solution: string;
  difficulty: number;
}> = [
  { id: 1, group: "Dot OLL", recognition: "No edges oriented; two side bars.", solution: "R U2 R2 F R F' U2 R' F R F'", difficulty: 4 },
  { id: 2, group: "Dot OLL", recognition: "No edges oriented; single side bar.", solution: "F R U R' U' F' f R U R' U' f'", difficulty: 4 },
  { id: 3, group: "Dot OLL", recognition: "No edges oriented; left stickers line up.", solution: "f R U R' U' f' U' F R U R' U' F'", difficulty: 4 },
  { id: 4, group: "Dot OLL", recognition: "No edges oriented; mirror of OLL 3.", solution: "f R U R' U' f' U F R U R' U' F'", difficulty: 4 },
  { id: 5, group: "Square Shapes", recognition: "Square shape, left-handed.", solution: "l' U2 L U L' U l", difficulty: 2 },
  { id: 6, group: "Square Shapes", recognition: "Square shape, right-handed.", solution: "r U2 R' U' R U' r'", difficulty: 2 },
  { id: 7, group: "Small Lightning Bolts", recognition: "Small lightning bolt with aligned block.", solution: "r U R' U R U2 r'", difficulty: 2 },
  { id: 8, group: "Small Lightning Bolts", recognition: "Small lightning bolt mirror.", solution: "R U2 R' U2 R' F R F'", difficulty: 2 },
  { id: 9, group: "Fish Shapes", recognition: "Fish shape with front block.", solution: "R U R' U' R' F R2 U R' U' F'", difficulty: 2 },
  { id: 10, group: "Fish Shapes", recognition: "Fish shape with back block.", solution: "R U R' U R' F R F' R U2 R'", difficulty: 3 },
  { id: 11, group: "Small Lightning Bolts", recognition: "Lightning bolt without matching block.", solution: "F' L' U' L U F y F R U R' U' F'", difficulty: 4 },
  { id: 12, group: "Small Lightning Bolts", recognition: "Lightning bolt mirror without matching block.", solution: "F R U R' U' F' U F R U R' U' F'", difficulty: 4 },
  { id: 13, group: "Knight Move Shapes", recognition: "Knight move with two sticker blocks.", solution: "r U' r' U' r U r' y' R' U R", difficulty: 4 },
  { id: 14, group: "Knight Move Shapes", recognition: "Knight move mirror with two sticker blocks.", solution: "R' F R U R' F' R F U' F'", difficulty: 4 },
  { id: 15, group: "Knight Move Shapes", recognition: "Knight move with one sticker block.", solution: "l' U' l L' U' L U l' U l", difficulty: 4 },
  { id: 16, group: "Knight Move Shapes", recognition: "Knight move mirror with one sticker block.", solution: "r U r' R U R' U' r U' r'", difficulty: 4 },
  { id: 17, group: "Dot OLL", recognition: "No edges oriented; arrow-shaped side blocks.", solution: "F R' F' R2 r' U R U' R' U' M'", difficulty: 5 },
  { id: 18, group: "Dot OLL", recognition: "No edges oriented; back sticker bar.", solution: "r U R' U R U2 r2 U' R U' R' U2 r", difficulty: 5 },
  { id: 19, group: "Dot OLL", recognition: "No edges oriented; no sticker bar.", solution: "r' R U R U R' U' M' R' F R F'", difficulty: 5 },
  { id: 20, group: "Dot OLL", recognition: "No edges oriented; M-slice dot case.", solution: "r U R' U' M2 U R U' R' U' M'", difficulty: 5 },
  { id: 21, group: "Edges Oriented", name: "H", recognition: "All edges oriented; H corner pattern.", solution: "R U2 R' U' R U R' U' R U' R'", difficulty: 2 },
  { id: 22, group: "Edges Oriented", name: "Pi", recognition: "All edges oriented; one pair of headlights.", solution: "R U2 R2 U' R2 U' R2 U2 R", difficulty: 2 },
  { id: 23, group: "Edges Oriented", name: "Headlights", recognition: "All edges oriented; headlights.", solution: "R2 D R' U2 R D' R' U2 R'", difficulty: 3 },
  { id: 24, group: "Edges Oriented", name: "T", recognition: "All edges oriented; T/chameleon corner shape.", solution: "r U R' U' r' F R F'", difficulty: 3 },
  { id: 25, group: "Edges Oriented", name: "Bowtie", recognition: "All edges oriented; bowtie corner shape.", solution: "F' r U R' U' r' F R", difficulty: 3 },
  { id: 26, group: "Edges Oriented", name: "Anti-Sune", recognition: "All edges oriented; anti-sune fish.", solution: "R U2 R' U' R U' R'", difficulty: 1 },
  { id: 27, group: "Edges Oriented", name: "Sune", recognition: "All edges oriented; sune fish.", solution: "R U R' U R U2 R'", difficulty: 1 },
  { id: 28, group: "Arrow & H Shapes", name: "Arrow", recognition: "Arrow shape with M-slice solution.", solution: "M' U M U2 M' U M", difficulty: 3 },
  { id: 29, group: "Awkward Shapes", recognition: "Awkward shape with sticker block.", solution: "M U R U R' U' R' F R F' M'", difficulty: 4 },
  { id: 30, group: "Awkward Shapes", recognition: "Awkward shape mirror with sticker block.", solution: "R2 U R' B' R U' R2 U R B R'", difficulty: 4 },
  { id: 31, group: "P Shapes", recognition: "P shape with no bar.", solution: "R' U' F U R U' R' F' R", difficulty: 3 },
  { id: 32, group: "P Shapes", recognition: "Mirror P shape with no bar.", solution: "R U B' U' R' U R B R'", difficulty: 3 },
  { id: 33, group: "T Shapes", recognition: "T shape with two parallel sticker blocks.", solution: "R U R' U' R' F R F'", difficulty: 2 },
  { id: 34, group: "C Shapes", recognition: "C shape without sticker bar.", solution: "R U R2 U' R' F R U R U' F'", difficulty: 3 },
  { id: 35, group: "Fish Shapes", recognition: "Fish shape without sticker blocks.", solution: "R U2 R2 F R F' R U2 R'", difficulty: 3 },
  { id: 36, group: "W Shapes", recognition: "W shape with side block.", solution: "L' U' L U' L' U L U L F' L' F", difficulty: 3 },
  { id: 37, group: "Fish Shapes", recognition: "Fish shape with two sticker blocks.", solution: "F R U' R' U' R U R' F'", difficulty: 3 },
  { id: 38, group: "W Shapes", recognition: "W shape mirror with side block.", solution: "R U R' U R U' R' U' R' F R F'", difficulty: 3 },
  { id: 39, group: "Big Lightning Bolts", recognition: "Big lightning bolt left.", solution: "L F' L' U' L U F U' L'", difficulty: 3 },
  { id: 40, group: "Big Lightning Bolts", recognition: "Big lightning bolt right.", solution: "R' F R U R' U' F' U R", difficulty: 3 },
  { id: 41, group: "Awkward Shapes", recognition: "Awkward shape with headlights.", solution: "R U R' U R U2 R' F R U R' U' F'", difficulty: 4 },
  { id: 42, group: "Awkward Shapes", recognition: "Awkward mirror with headlights.", solution: "R' F R F' R' F R F' R U R' U' R U R'", difficulty: 4 },
  { id: 43, group: "P Shapes", recognition: "P shape mirror with bar.", solution: "R' U' F' U F R", difficulty: 2 },
  { id: 44, group: "P Shapes", recognition: "P shape with bar.", solution: "f R U R' U' f'", difficulty: 2 },
  { id: 45, group: "T Shapes", recognition: "T shape with no sticker blocks.", solution: "F R U R' U' F'", difficulty: 2 },
  { id: 46, group: "C Shapes", recognition: "C shape with sticker bar.", solution: "R' U' R' F R F' U R", difficulty: 3 },
  { id: 47, group: "L Shapes", recognition: "L shape with right-facing headlights.", solution: "F' L' U' L U L' U' L U F", difficulty: 4 },
  { id: 48, group: "L Shapes", recognition: "L shape with left-facing headlights.", solution: "F R U R' U' R U R' U' F'", difficulty: 3 },
  { id: 49, group: "L Shapes", recognition: "L shape with bar and block.", solution: "R' F R' F' R2 U2 y R' F R F'", difficulty: 4 },
  { id: 50, group: "L Shapes", recognition: "Mirror L shape with bar and block.", solution: "R' F R2 B' R2 F' R2 B R'", difficulty: 4 },
  { id: 51, group: "I Shapes", recognition: "I shape with two blocks and headlights.", solution: "f R U R' U' R U R' U' f'", difficulty: 3 },
  { id: 52, group: "I Shapes", recognition: "I shape with single bar.", solution: "R U R' U R d' R U' R' F'", difficulty: 4 },
  { id: 53, group: "L Shapes", recognition: "L shape with bar and left headlights.", solution: "l' U' L U' L' U L U' L' U2 l", difficulty: 4 },
  { id: 54, group: "L Shapes", recognition: "L shape with bar and right headlights.", solution: "r U R' U R U' R' U R U2 r'", difficulty: 4 },
  { id: 55, group: "I Shapes", recognition: "I shape with two side bars.", solution: "R U2 R2 U' R U' R' U2 F R F'", difficulty: 4 },
  { id: 56, group: "I Shapes", recognition: "I shape with two pairs of headlights.", solution: "r U r' U R U' R' U R U' M' U' r'", difficulty: 4 },
  { id: 57, group: "Arrow & H Shapes", name: "H Shape", recognition: "H shape with all edges oriented.", solution: "R U R' U' M' U R U' r'", difficulty: 2 },
];

export const ollCases: AlgorithmCase[] = OLL_57_DATA.map((entry) =>
  caseFromSolution({
    id: `oll-${String(entry.id).padStart(2, "0")}`,
    stage: "oll",
    name: entry.name ? `${entry.name} (OLL ${entry.id})` : `OLL ${String(entry.id).padStart(2, "0")}`,
    group: entry.group,
    difficulty: entry.difficulty,
    recognition: entry.recognition,
    recognitionTags: [entry.group, entry.name ?? `OLL ${entry.id}`],
    solution: entry.solution,
    source: TWO_LOOK_OLL_IDS.has(entry.id)
      ? "2-look OLL / JPerm common alg"
      : "JPerm / Rubik's Place common OLL alg",
    notes: "Mainstream full OLL learning algorithm.",
    subsets: [
      "full-oll",
      ...(TWO_LOOK_OLL_IDS.has(entry.id) ? (["2look-oll"] as const) : []),
    ],
  }),
);

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
].map(([name, recognition, solution, difficulty]) => {
  const twoLookPllNames = new Set(["H", "Jb", "Ua", "Ub", "Y", "Z"]);
  const pllName = String(name);
  return (
  caseFromSolution({
    id: `pll-${pllName.toLowerCase()}`,
    stage: "pll",
    name: `${pllName} perm`,
    group: "Full PLL",
    difficulty: Number(difficulty),
    recognition: String(recognition),
    recognitionTags: [String(recognition), `${pllName} perm`],
    solution: String(solution),
    source: "JPerm / SpeedCubeDB common alg",
    notes: "Mainstream speedsolving PLL choice.",
    subsets: [
      "full-pll",
      ...(twoLookPllNames.has(pllName) ? (["2look-pll"] as const) : []),
    ],
  })
  );
});

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
