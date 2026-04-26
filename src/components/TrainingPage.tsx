import React from "react";
import { BookOpen, Eye, EyeOff, Shuffle } from "lucide-react";
import { CfopSplitBar } from "./CfopSplitBar";
import { CubeViewer } from "./CubeViewer";
import { SmartCubePanel } from "./SmartCubePanel";
import { formatMs } from "../lib/time";
import type { Stage } from "../data/cfopData";
import type { CubeOrientation } from "../lib/notation";
import type { GuideStepState } from "../lib/guide";
import type { GyroQuaternion } from "../lib/cubePattern";
import type { AlgorithmCase } from "../data/cfopData";
import type { SolveRecord } from "../types/app";

type CubeSkin = "classic" | "f2l";

export function TrainingPage({
  isFreeMode,
  handleFreeMode,
  stages,
  stage,
  handleStageChange,
  stageMeta,
  cubeOrientation,
  setCubeOrientation,
  cubeSkin,
  setCubeSkin,
  mirrorHintsEnabled,
  setMirrorHintsEnabled,
  freeInspectionEnabled,
  setFreeInspectionEnabled,
  handleNewFreeScramble,
  smartCubeConnected,
  freeCurrentSplits,
  freeInspectionText,
  difficulty,
  availableDifficulties,
  handleDifficultyChange,
  subsetOptions,
  trainingSubsetFilter,
  resetTrainingSessionFromCurrentState,
  setTrainingSubsetFilter,
  setDifficulty,
  activeCase,
  filteredCases,
  handleCaseChange,
  randomTrainingCase,
  crossGenerated,
  showPanelSolution,
  setShowPanelSolution,
  solutionAlgForOrientation,
  activeCaseWithTrainingSetup,
  viewerTitle,
  viewerSetup,
  viewerAlg,
  viewerContextMoves,
  setupGuideAlg,
  timerRunning,
  freeInspectionRunning,
  isDemoViewer,
  smartCubeDisplayMoves,
  setupGuideComplete,
  setupGuideStepViews,
  demoPlayerAvailable,
  demoPlayerEnabled,
  setDemoPlayerEnabled,
  timerLabel,
  isLiveViewer,
  smartCubeGyro,
  smartCubeGyroSession,
  handleSmartCubeMove,
  handleSmartCubeGyro,
  handleSmartCubeFacelets,
  handleSmartCubeConnectionChange,
  handleSmartCubeResetLiveState,
  smartCubeStateBootstrapped,
  freeCurrentSplitMoves,
  smartPanelSolves,
}: {
  isFreeMode: boolean;
  handleFreeMode: () => void;
  stages: Stage[];
  stage: Stage;
  handleStageChange: (stage: Stage) => void;
  stageMeta: Record<Stage, { title: string; subtitle: string; caseLabel: string }>;
  cubeOrientation: CubeOrientation;
  setCubeOrientation: (value: CubeOrientation) => void;
  cubeSkin: CubeSkin;
  setCubeSkin: (value: CubeSkin) => void;
  mirrorHintsEnabled: boolean;
  setMirrorHintsEnabled: (value: boolean) => void;
  freeInspectionEnabled: boolean;
  setFreeInspectionEnabled: (value: boolean) => void;
  handleNewFreeScramble: () => void;
  smartCubeConnected: boolean;
  freeCurrentSplits: { cross: number | null; f2l: number | null; oll: number | null; pll: number | null; total: number };
  freeInspectionText: string;
  difficulty: number | "all";
  availableDifficulties: number[];
  handleDifficultyChange: (value: number | "all") => void;
  subsetOptions: Array<{ id: "all" | "2look-oll" | "2look-pll"; label: string }>;
  trainingSubsetFilter: "all" | "2look-oll" | "2look-pll" | "full-oll" | "full-pll";
  resetTrainingSessionFromCurrentState: () => void;
  setTrainingSubsetFilter: (value: "all" | "2look-oll" | "2look-pll" | "full-oll" | "full-pll") => void;
  setDifficulty: (value: number | "all") => void;
  activeCase: AlgorithmCase;
  filteredCases: AlgorithmCase[];
  handleCaseChange: (id: string) => void;
  randomTrainingCase: () => void;
  crossGenerated: { loading: boolean };
  showPanelSolution: boolean;
  setShowPanelSolution: (value: (current: boolean) => boolean) => void;
  solutionAlgForOrientation: string;
  activeCaseWithTrainingSetup: AlgorithmCase;
  viewerTitle: string;
  viewerSetup: string;
  viewerAlg: string;
  viewerContextMoves: number;
  setupGuideAlg: string;
  timerRunning: boolean;
  freeInspectionRunning: boolean;
  isDemoViewer: boolean;
  smartCubeDisplayMoves: string[];
  setupGuideComplete: boolean;
  setupGuideStepViews: Array<{ label: string; state: GuideStepState; progress: number }>;
  demoPlayerAvailable: boolean;
  demoPlayerEnabled: boolean;
  setDemoPlayerEnabled: (value: boolean) => void;
  timerLabel: string;
  isLiveViewer: boolean;
  smartCubeGyro: GyroQuaternion | null;
  smartCubeGyroSession: number;
  handleSmartCubeMove: (move: { raw: string; display: string }) => void;
  handleSmartCubeGyro: (q: GyroQuaternion | null) => void;
  handleSmartCubeFacelets: (facelets: string) => void;
  handleSmartCubeConnectionChange: (connected: boolean) => void;
  handleSmartCubeResetLiveState: () => void;
  smartCubeStateBootstrapped: boolean;
  freeCurrentSplitMoves: { cross: number | null; f2l: number | null; oll: number | null; pll: number | null; total: number };
  smartPanelSolves: SolveRecord[];
}) {
  return (
    <section className="trainer-layout trainer-layout-standalone">
      <aside className="control-panel">
        <nav className="stage-tabs training-stage-tabs" aria-label="CFOP stages">
          <button
            className={isFreeMode ? "active" : ""}
            onClick={handleFreeMode}
          >
            Free
          </button>
          {stages.map((item) => (
            <button
              key={item}
              className={!isFreeMode && stage === item ? "active" : ""}
              onClick={() => handleStageChange(item)}
            >
              {stageMeta[item].title}
            </button>
          ))}
        </nav>

        <div className="section-heading">
          <div>
            <p className="eyebrow">{isFreeMode ? "Solve Trainer" : stageMeta[stage].caseLabel}</p>
            <h2>{isFreeMode ? "Free Practice" : stageMeta[stage].title}</h2>
          </div>
          <BookOpen size={20} />
        </div>
        <p className="muted">
          {isFreeMode
            ? "Drill full solves with inspection, split timing, and rolling history."
            : stageMeta[stage].subtitle}
        </p>

        <label className="field-label" htmlFor="cube-orientation">
          Cube orientation
        </label>
        <div className="segmented" id="cube-orientation">
          <button
            className={cubeOrientation === "yellow-top" ? "active" : ""}
            onClick={() => setCubeOrientation("yellow-top")}
          >
            Yellow top
          </button>
          <button
            className={cubeOrientation === "white-top" ? "active" : ""}
            onClick={() => setCubeOrientation("white-top")}
          >
            White top
          </button>
        </div>
        <label className="field-label" htmlFor="cube-skin">
          Cube skin
        </label>
        <div className="segmented" id="cube-skin">
          <button
            className={cubeSkin === "f2l" ? "active" : ""}
            onClick={() => setCubeSkin("f2l")}
          >
            F2L
          </button>
          <button
            className={cubeSkin === "classic" ? "active" : ""}
            onClick={() => setCubeSkin("classic")}
          >
            Classic
          </button>
        </div>
        <label className="field-label" htmlFor="mirror-hints">
          Mirror hints
        </label>
        <div className="segmented" id="mirror-hints">
          <button
            className={cubeSkin !== "f2l" && mirrorHintsEnabled ? "active" : ""}
            disabled={cubeSkin === "f2l"}
            onClick={() => setMirrorHintsEnabled(true)}
          >
            On
          </button>
          <button
            className={cubeSkin === "f2l" || !mirrorHintsEnabled ? "active" : ""}
            disabled={cubeSkin === "f2l"}
            onClick={() => setMirrorHintsEnabled(false)}
          >
            Off
          </button>
        </div>

        {isFreeMode ? (
          <>
            <label className="field-label" htmlFor="inspection-enabled">
              Inspection
            </label>
            <div className="segmented" id="inspection-enabled">
              <button
                className={freeInspectionEnabled ? "active" : ""}
                onClick={() => setFreeInspectionEnabled(true)}
              >
                15s
              </button>
              <button
                className={!freeInspectionEnabled ? "active" : ""}
                onClick={() => setFreeInspectionEnabled(false)}
              >
                Unlimited
              </button>
            </div>
            <div className="action-row">
              <button
                className="primary-button"
                onClick={handleNewFreeScramble}
              >
                <Shuffle size={18} />
                New scramble
              </button>
            </div>
            {smartCubeConnected && (
              <div className="alg-block">
                <div className="alg-title">
                  <span>Current Splits</span>
                </div>
                <CfopSplitBar
                  cross={freeCurrentSplits.cross}
                  f2l={freeCurrentSplits.f2l}
                  oll={freeCurrentSplits.oll}
                  pll={freeCurrentSplits.pll}
                />
                <p>Inspection: {freeInspectionText}</p>
                <p>Total: {formatMs(freeCurrentSplits.total)}</p>
                <p>
                  Moves: C {freeCurrentSplitMoves.cross ?? "--"} | F2L {freeCurrentSplitMoves.f2l ?? "--"} | O {freeCurrentSplitMoves.oll ?? "--"} | P {freeCurrentSplitMoves.pll ?? "--"} | T {freeCurrentSplitMoves.total}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="difficulty">
              Difficulty
            </label>
            <div className="segmented" id="difficulty">
              {stage !== "cross" && (
                <button
                  className={difficulty === "all" ? "active" : ""}
                  onClick={() => handleDifficultyChange("all")}
                >
                  All
                </button>
              )}
              {availableDifficulties.map((level) => (
                <button
                  key={level}
                  className={difficulty === level ? "active" : ""}
                  onClick={() => handleDifficultyChange(level)}
                >
                  {stage === "cross" ? `${level}` : `L${level}`}
                </button>
              ))}
            </div>

            {(stage === "oll" || stage === "pll") && (
              <>
                <label className="field-label" htmlFor="training-subset">
                  Subset
                </label>
                <div className="segmented" id="training-subset">
                  {subsetOptions.map((option) => (
                    <button
                      key={option.id}
                      className={trainingSubsetFilter === option.id ? "active" : ""}
                      onClick={() => {
                        resetTrainingSessionFromCurrentState();
                        setTrainingSubsetFilter(option.id);
                        setDifficulty("all");
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {stage !== "cross" && (
              <>
                <label className="field-label" htmlFor="case-select">
                  Case
                </label>
                <select
                  id="case-select"
                  value={activeCase.id}
                  onChange={(event) => handleCaseChange(event.target.value)}
                >
                  {filteredCases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div className="action-row">
              <button
                className="primary-button"
                onClick={randomTrainingCase}
                disabled={stage === "cross" && crossGenerated.loading}
              >
                <Shuffle size={18} />
                {stage === "cross"
                  ? crossGenerated.loading
                    ? "Generating"
                    : "New cross case"
                  : "Random case"}
              </button>
            </div>
            <div className="alg-block solution solution-at-bottom">
              <div className="alg-title">
                <span>Best Solution</span>
                <button onClick={() => setShowPanelSolution((value) => !value)}>
                  {showPanelSolution ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <code>{showPanelSolution ? solutionAlgForOrientation : "Try it first"}</code>
              {showPanelSolution && (
                <p>{activeCaseWithTrainingSetup.solutions[0]?.source ?? "CFOP reference"}</p>
              )}
            </div>
          </>
        )}
      </aside>

      <div className="main-column main-column-free">
        <CubeViewer
          title={viewerTitle}
          setup={viewerSetup}
          alg={viewerAlg}
          contextMoves={viewerContextMoves}
          headlineAlg={setupGuideAlg}
          timerInHeadline={isFreeMode && (timerRunning || freeInspectionRunning)}
          headlineTimerActive={isFreeMode && (timerRunning || freeInspectionRunning)}
          cubeOrientation={cubeOrientation}
          cubeSkin={cubeSkin}
          mirrorHintsEnabled={mirrorHintsEnabled}
          hideControls={smartCubeConnected ? !isDemoViewer : isFreeMode}
          liveMoves={smartCubeDisplayMoves}
          guideSteps={setupGuideStepViews}
          showLiveMoves={smartCubeConnected && (setupGuideComplete || smartCubeDisplayMoves.length > 0)}
          demoPlayerAvailable={demoPlayerAvailable}
          demoPlayerEnabled={demoPlayerEnabled}
          onDemoPlayerEnabledChange={setDemoPlayerEnabled}
          onDemoPlaybackFinished={() => setDemoPlayerEnabled(false)}
          timerLabel={timerLabel}
          isTimerRunning={timerRunning}
          isLive={isLiveViewer}
          gyroQuaternion={smartCubeConnected ? smartCubeGyro : null}
          gyroSession={smartCubeGyroSession}
          orientationNotice={
            !isFreeMode
              ? `Trainer setup notation follows selected orientation (${cubeOrientation === "yellow-top" ? "Yellow top" : "White top"}).`
              : null
          }
        />
      </div>

      <SmartCubePanel
        onMove={handleSmartCubeMove}
        onGyro={handleSmartCubeGyro}
        onFacelets={handleSmartCubeFacelets}
        onConnectionChange={handleSmartCubeConnectionChange}
        onResetLiveState={handleSmartCubeResetLiveState}
        liveStateReady={smartCubeStateBootstrapped}
        cubeOrientation={cubeOrientation}
        recentSolves={smartPanelSolves}
      />
    </section>
  );
}
