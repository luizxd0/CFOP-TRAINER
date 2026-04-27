import { TwistyPlayer } from "cubing/twisty";

export type CasePreviewRequest = {
  key: string;
  setup: string;
  compact: boolean;
  stickeringMask: string;
};

const FULL_STICKERING_MASK = "EDGES:------------,CORNERS:--------,CENTERS:------";

const casePreviewCache = new Map<string, string>();
const casePreviewPending = new Map<string, Promise<string>>();
const casePreviewSubscribers = new Map<string, Set<() => void>>();
const casePreviewQueue: Array<() => Promise<void>> = [];
let casePreviewQueueRunning = false;
let casePreviewBackend: { host: HTMLDivElement; player: TwistyPlayer } | null = null;

function getCasePreview(key: string): string | undefined {
  return casePreviewCache.get(key);
}

function notifyCasePreview(key: string) {
  const listeners = casePreviewSubscribers.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function awaitTwistyIntersectedCallback(player: TwistyPlayer): Promise<void> {
  let callback: ((this: TwistyPlayer) => Promise<void>) | undefined;
  for (
    let proto: object | null = Object.getPrototypeOf(player);
    proto && !callback;
    proto = Object.getPrototypeOf(proto)
  ) {
    const symbol = Object.getOwnPropertySymbols(proto).find(
      (item) => item.description === "intersectedCallback",
    );
    const candidate = symbol ? (proto as Record<symbol, unknown>)[symbol] : undefined;
    if (typeof candidate === "function") {
      callback = candidate as (this: TwistyPlayer) => Promise<void>;
    }
  }
  if (callback) {
    await callback.call(player);
  }
}

function ensureCasePreviewBackend(): { host: HTMLDivElement; player: TwistyPlayer } {
  if (casePreviewBackend) {
    return casePreviewBackend;
  }
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "260px";
  host.style.height = "260px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  host.style.overflow = "hidden";
  document.body.appendChild(host);

  const player = new TwistyPlayer({
    puzzle: "3x3x3",
    experimentalSetupAlg: "",
    alg: "",
    background: "none",
    controlPanel: "none",
    backView: "none",
    viewerLink: "none",
    visualization: "3D",
    experimentalStickering: "full",
    experimentalStickeringMaskOrbits: FULL_STICKERING_MASK,
    hintFacelets: "none",
    experimentalDragInput: "none",
    experimentalFaceletScale: 0.92,
    experimentalInitialHintFaceletsAnimation: "none",
    cameraLatitude: 28,
    cameraLongitude: 32,
    cameraDistance: 5.85,
  });
  player.style.width = "260px";
  player.style.height = "260px";
  host.appendChild(player);
  casePreviewBackend = { host, player };
  return casePreviewBackend;
}

async function renderCasePreview(request: CasePreviewRequest): Promise<string> {
  const { player } = ensureCasePreviewBackend();
  await awaitTwistyIntersectedCallback(player);
  player.experimentalSetupAlg = request.setup;
  player.alg = "";
  player.experimentalStickering = "full";
  player.experimentalStickeringMaskOrbits = request.stickeringMask;
  player.experimentalFaceletScale = request.compact ? 0.88 : 0.92;
  player.cameraDistance = request.compact ? 6.6 : 5.85;
  player.jumpToStart({ flash: false });
  await nextTask();
  await nextFrame();
  await nextFrame();
  return player.experimentalScreenshot({ width: 512, height: 512 });
}

function enqueueCasePreview(job: () => Promise<void>) {
  casePreviewQueue.push(job);
  void drainCasePreviewQueue();
}

async function drainCasePreviewQueue() {
  if (casePreviewQueueRunning) return;
  casePreviewQueueRunning = true;
  try {
    while (casePreviewQueue.length > 0) {
      const job = casePreviewQueue.shift();
      if (job) {
        await job();
      }
    }
  } finally {
    casePreviewQueueRunning = false;
  }
}

export function subscribeCasePreview(key: string, listener: () => void): () => void {
  const listeners = casePreviewSubscribers.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  casePreviewSubscribers.set(key, listeners);
  return () => {
    const current = casePreviewSubscribers.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      casePreviewSubscribers.delete(key);
    }
  };
}

export function requestCasePreview(request: CasePreviewRequest): Promise<string> {
  const cached = casePreviewCache.get(request.key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = casePreviewPending.get(request.key);
  if (pending) {
    return pending;
  }
  const promise = new Promise<string>((resolve) => {
    enqueueCasePreview(async () => {
      try {
        const src = await renderCasePreview(request);
        if (src) {
          casePreviewCache.set(request.key, src);
        }
        resolve(src);
      } catch {
        resolve("");
      } finally {
        casePreviewPending.delete(request.key);
        notifyCasePreview(request.key);
      }
    });
  });
  casePreviewPending.set(request.key, promise);
  return promise;
}

export function readCasePreviewFromCache(key: string): string | undefined {
  return getCasePreview(key);
}
