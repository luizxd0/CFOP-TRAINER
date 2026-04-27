import React from "react";
import type { AlgorithmCase } from "../data/cfopData";
import { CasePreview } from "./CasePreview";
import { recordForCase, timingStatsLabel, type CustomAlgorithm, type LearningCaseRecord, type LearningData, type LearningProgressFilter, type LearningProgressState } from "../lib/learning";
import type { CubeOrientation } from "../lib/notation";
import type { CubeSkin } from "../types/app";
import { RotateCcw } from "lucide-react";

type LearnStage = "f2l" | "oll" | "pll";
type LearningSubsetFilter = "all" | "2look-oll" | "2look-pll" | "full-oll" | "full-pll";

export function LearnPage({
  progressTotals,
  learnStage,
  learnSubset,
  learnProgressFilter,
  learnSearch,
  selectedPracticeCount,
  weakestPracticeLabel,
  onLearnStageChange,
  onLearnSubsetChange,
  onLearnProgressFilterChange,
  onLearnSearchChange,
  onSelectVisiblePracticeCases,
  onSelectOnlyLearningPracticeCases,
  onClearPracticeSelection,
  onPracticeWeakestSelectedCase,
  learnCases,
  learningData,
  selectedLearnCase,
  selectedLearnRecord,
  cubeOrientation,
  cubeSkin,
  onCubeSkinChange,
  onTogglePracticeSelection,
  onCycleLearningState,
  onSelectLearnCaseId,
  onSetLearningState,
  onSetPrimaryAlgorithm,
  onEditCustomAlgorithm,
  onRemoveCustomAlgorithm,
  editingCustomAlgId,
  customAlgLabelDraft,
  customAlgDraft,
  onCustomAlgLabelDraftChange,
  onCustomAlgDraftChange,
  onSaveCustomAlgorithm,
  onClearCustomAlgorithmDraft,
}: {
  progressTotals: { unknown: number; learning: number; learned: number };
  learnStage: LearnStage;
  learnSubset: LearningSubsetFilter;
  learnProgressFilter: LearningProgressFilter;
  learnSearch: string;
  selectedPracticeCount: number;
  weakestPracticeLabel: string;
  onLearnStageChange: (stage: LearnStage) => void;
  onLearnSubsetChange: (subset: LearningSubsetFilter) => void;
  onLearnProgressFilterChange: (filter: LearningProgressFilter) => void;
  onLearnSearchChange: (text: string) => void;
  onSelectVisiblePracticeCases: () => void;
  onSelectOnlyLearningPracticeCases: () => void;
  onClearPracticeSelection: () => void;
  onPracticeWeakestSelectedCase: () => void;
  learnCases: AlgorithmCase[];
  learningData: LearningData;
  selectedLearnCase: AlgorithmCase;
  selectedLearnRecord: LearningCaseRecord;
  cubeOrientation: CubeOrientation;
  cubeSkin: CubeSkin;
  onCubeSkinChange: (skin: CubeSkin) => void;
  onTogglePracticeSelection: (caseId: string) => void;
  onCycleLearningState: (caseId: string) => void;
  onSelectLearnCaseId: (caseId: string) => void;
  onSetLearningState: (caseId: string, state: LearningProgressState) => void;
  onSetPrimaryAlgorithm: (caseId: string, id?: string) => void;
  onEditCustomAlgorithm: (algorithm: CustomAlgorithm) => void;
  onRemoveCustomAlgorithm: (caseId: string, id: string) => void;
  editingCustomAlgId: string | null;
  customAlgLabelDraft: string;
  customAlgDraft: string;
  onCustomAlgLabelDraftChange: (value: string) => void;
  onCustomAlgDraftChange: (value: string) => void;
  onSaveCustomAlgorithm: () => void;
  onClearCustomAlgorithmDraft: () => void;
}) {
  const previewSkin: CubeSkin = learnStage === "f2l" ? cubeSkin : "classic";

  return (
    <section className="learn-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Learning</p>
          <h1>Build your algorithm library.</h1>
          <p className="hero-copy">
            Track unknown, learning, and learned cases locally, then customize the algorithms you want to drill.
          </p>
        </div>
        <div className="learn-summary">
          <p>
            <span>Unknown</span>
            <strong>{progressTotals.unknown}</strong>
          </p>
          <p>
            <span>Learning</span>
            <strong>{progressTotals.learning}</strong>
          </p>
          <p>
            <span>Learned</span>
            <strong>{progressTotals.learned}</strong>
          </p>
        </div>
      </header>

      <section className="learn-layout">
        <aside className="learn-sidebar">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Filters</p>
              <h2>Case Set</h2>
            </div>
          </div>
          <label className="field-label" htmlFor="learn-stage">
            Algset
          </label>
          <div className="segmented" id="learn-stage">
            {(["f2l", "oll", "pll"] as const).map((item) => (
              <button
                key={item}
                className={learnStage === item ? "active" : ""}
                onClick={() => onLearnStageChange(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="learn-subset">
            Subset
          </label>
          <div className="segmented" id="learn-subset">
            <button
              className={learnSubset === "all" ? "active" : ""}
              onClick={() => onLearnSubsetChange("all")}
            >
              All
            </button>
            {learnStage === "oll" && (
              <button
                className={learnSubset === "2look-oll" ? "active" : ""}
                onClick={() => onLearnSubsetChange("2look-oll")}
              >
                2-look
              </button>
            )}
            {learnStage === "pll" && (
              <button
                className={learnSubset === "2look-pll" ? "active" : ""}
                onClick={() => onLearnSubsetChange("2look-pll")}
              >
                2-look
              </button>
            )}
          </div>

          <label className="field-label" htmlFor="learn-progress">
            Progress
          </label>
          <div className="segmented learn-progress-segmented" id="learn-progress">
            {(["all", "unknown", "learning", "learned"] as const).map((state) => (
              <button
                key={state}
                className={learnProgressFilter === state ? "active" : ""}
                onClick={() => onLearnProgressFilterChange(state)}
              >
                {state === "all" ? "All" : state}
              </button>
            ))}
          </div>

          {learnStage === "f2l" && (
            <>
              <label className="field-label" htmlFor="learn-cube-skin">
                Preview Skin
              </label>
              <div className="segmented" id="learn-cube-skin">
                <button
                  className={cubeSkin === "f2l" ? "active" : ""}
                  onClick={() => onCubeSkinChange("f2l")}
                >
                  F2L
                </button>
                <button
                  className={cubeSkin === "classic" ? "active" : ""}
                  onClick={() => onCubeSkinChange("classic")}
                >
                  Classic
                </button>
              </div>
            </>
          )}

          <label className="field-label" htmlFor="learn-search">
            Search
          </label>
          <input
            className="text-input"
            id="learn-search"
            placeholder="Name, shape, or alg"
            value={learnSearch}
            onChange={(event) => onLearnSearchChange(event.target.value)}
          />

          <div className="alg-block practice-queue-block">
            <div className="alg-title">
              <span>Practice Queue</span>
            </div>
            <p>{selectedPracticeCount} selected for weakest-first drilling.</p>
            <p>Next focus: {weakestPracticeLabel}</p>
            <div className="practice-action-grid">
              <button onClick={onSelectVisiblePracticeCases}>Select all shown</button>
              <button onClick={onSelectOnlyLearningPracticeCases}>Only learning</button>
              <button onClick={onClearPracticeSelection}>Clear</button>
              <button
                className="primary-button"
                onClick={onPracticeWeakestSelectedCase}
                disabled={selectedPracticeCount === 0}
              >
                Practice weakest
              </button>
            </div>
          </div>
        </aside>

        <section className="learn-grid-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{learnCases.length} cases</p>
              <h2>{learnStage.toUpperCase()} Library</h2>
            </div>
          </div>
          <div className="learn-case-grid">
            {learnCases.map((item) => {
              const record = recordForCase(learningData, item.id);
              return (
                <article
                  className={`learn-case-card ${record.state} ${
                    selectedLearnCase.id === item.id ? "selected" : ""
                  } ${record.selectedForPractice ? "queued" : ""}`}
                  key={item.id}
                >
                  <div
                    className="learn-case-main"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onSelectLearnCaseId(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectLearnCaseId(item.id);
                      }
                    }}
                    title="Click to select"
                  >
                    <CasePreview
                      activeCase={item}
                      cubeOrientation={cubeOrientation}
                      cubeSkin={previewSkin}
                      compact
                    />
                    <span>{item.name}</span>
                    <strong>{record.state}</strong>
                    <small>{item.group}</small>
                    <small>{timingStatsLabel(record)}</small>
                  </div>
                  <button
                    className="learn-state-cycle"
                    onClick={() => onCycleLearningState(item.id)}
                    title="Cycle learning state"
                    aria-label={`Cycle learning state for ${item.name}`}
                  >
                    <RotateCcw size={14} />
                    Cycle state
                  </button>
                  <button
                    className="learn-pick-toggle"
                    onClick={() => onTogglePracticeSelection(item.id)}
                  >
                    {record.selectedForPractice ? "Selected" : "Select for practice"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="learn-detail-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{selectedLearnCase.group}</p>
              <h2>{selectedLearnCase.name}</h2>
            </div>
          </div>
          <CasePreview
            activeCase={selectedLearnCase}
            cubeOrientation={cubeOrientation}
            cubeSkin={previewSkin}
          />
          <div className="practice-detail-strip">
            <span>{timingStatsLabel(selectedLearnRecord)}</span>
            <button onClick={() => onTogglePracticeSelection(selectedLearnCase.id)}>
              {selectedLearnRecord.selectedForPractice ? "Remove from practice" : "Add to practice"}
            </button>
          </div>
          <div className="learn-state-row">
            {(["unknown", "learning", "learned"] as const).map((state) => (
              <button
                key={state}
                className={selectedLearnRecord.state === state ? "active" : ""}
                onClick={() => onSetLearningState(selectedLearnCase.id, state)}
              >
                {state}
              </button>
            ))}
          </div>
          <div className="alg-block">
            <div className="alg-title">
              <span>Default Algorithm</span>
              <button onClick={() => onSetPrimaryAlgorithm(selectedLearnCase.id, undefined)}>
                Use
              </button>
            </div>
            <code>{selectedLearnCase.solutions[selectedLearnRecord.primaryAlgorithmId ? 1 : 0]?.alg ?? selectedLearnCase.solutions[0].alg}</code>
            <p>{selectedLearnCase.recognition}</p>
          </div>

          <div className="alg-block">
            <div className="alg-title">
              <span>Custom Algorithms</span>
            </div>
            {selectedLearnRecord.customAlgorithms.length === 0 ? (
              <p>No custom algorithms yet.</p>
            ) : (
              selectedLearnRecord.customAlgorithms.map((algorithm) => (
                <div className="custom-alg-row" key={algorithm.id}>
                  <code>{algorithm.alg}</code>
                  <span>{algorithm.label}</span>
                  <div>
                    <button onClick={() => onSetPrimaryAlgorithm(selectedLearnCase.id, algorithm.id)}>
                      Use
                    </button>
                    <button onClick={() => onEditCustomAlgorithm(algorithm)}>Edit</button>
                    <button onClick={() => onRemoveCustomAlgorithm(selectedLearnCase.id, algorithm.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="alg-block">
            <div className="alg-title">
              <span>{editingCustomAlgId ? "Edit Algorithm" : "Add Algorithm"}</span>
            </div>
            <input
              className="text-input"
              value={customAlgLabelDraft}
              onChange={(event) => onCustomAlgLabelDraftChange(event.target.value)}
              placeholder="Label"
            />
            <textarea
              className="text-input alg-textarea"
              value={customAlgDraft}
              onChange={(event) => onCustomAlgDraftChange(event.target.value)}
              placeholder="R U R' U'"
            />
            <div className="action-row">
              <button className="primary-button" onClick={onSaveCustomAlgorithm}>
                {editingCustomAlgId ? "Save" : "Add"}
              </button>
              <button
                className="ghost-button"
                onClick={onClearCustomAlgorithmDraft}
              >
                Clear
              </button>
            </div>
          </div>
        </aside>
      </section>
    </section>
  );
}
