import type { LearningSubset } from "../data/cfopData";

export type CubeSkin = "classic" | "f2l";
export type ThemeMode = "light" | "dark";
export type AppMode = "trainer" | "free";
export type AppView = "home" | "training" | "dashboard" | "learn";
export type LearnStage = "f2l" | "oll" | "pll";
export type LearningSubsetFilter = "all" | LearningSubset;
export type FreeSolveRecord = {
  totalMs: number;
  crossMs: number;
  f2lMs: number;
  ollMs: number;
  pllMs: number;
  finishedAt: number;
};

export type SolveRecord = {
  totalMs: number;
  finishedAt: number;
};
