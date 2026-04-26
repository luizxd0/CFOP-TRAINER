import type { LearningSubset } from "../data/cfopData";

export type CubeSkin = "classic" | "f2l";
export type ThemeMode = "light" | "dark";
export type AppMode = "trainer" | "free";
export type AppView = "home" | "training" | "dashboard" | "learn";
export type LearnStage = "f2l" | "oll" | "pll";
export type LearningSubsetFilter = "all" | LearningSubset;
export type FreeSolveRecord = {
  totalMs: number;
  totalMoves: number;
  crossMs: number;
  crossMoves: number;
  f2lMs: number;
  f2lMoves: number;
  ollMs: number;
  ollMoves: number;
  pllMs: number;
  pllMoves: number;
  finishedAt: number;
};

export type SolveRecord = {
  totalMs: number;
  totalMoves: number;
  finishedAt: number;
};
