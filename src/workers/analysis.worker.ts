/// <reference lib="webworker" />
/**
 * Heavy per-cell computation off the main thread: window-averaged Sun/Earth visibility for all
 * 40k cells, per-frame Sun snapshots for the scrubber, and point time series.
 *
 * Window jobs run in slices and yield between them, so:
 *  - a quick coarse pass (6 h step) is posted first and the map fills in immediately,
 *  - scrubber snapshots are answered while a long window is still computing,
 *  - a window superseded by a newer request is abandoned.
 * The worker loads the grid and ephemeris itself through the data provider (no big copies).
 */
import { getDataProvider } from "@/data";
import { NRHO_9_2_SOUTH } from "@/domain/comms/relay";
import {
  createRelayAccumulator,
  relayPointSeries,
  type RelayLinkConfig,
  type RelayWindowResult,
} from "@/domain/comms/relayGrid";
import { localSky } from "@/domain/ephemeris/localSky";
import { xyToLonLat } from "@/domain/geo/polarStereo";
import { cellsInExtent, type AnalysisGrid } from "@/domain/grid/grid";
import {
  bodyDirection,
  buildCellFrames,
  createWindowAccumulator,
  pointSeries,
  SUN_RADIUS_DEG,
  visibilitySnapshot,
  type CellFrames,
  type WindowVisibility,
} from "@/domain/illumination/illumination";
import type { EphemerisSeries } from "@/domain/types";
import type { AnalysisRequest, AnalysisResponse, WindowResult } from "./analysisProtocol";

declare const self: DedicatedWorkerGlobalScope;

type State = { grid: AnalysisGrid; eph: EphemerisSeries; frames: CellFrames };
type WindowRequest = Extract<AnalysisRequest, { type: "window" }>;

let state: State | null = null;
const queue: AnalysisRequest[] = [];
let currentWindowId = 0;

/** Samples per slice before yielding (~50 ms of work). */
const SLICE = 24;
const COARSE_STEP_HOURS = 6;
/** Relay link parameters (docs/comms-model.md). */
const RELAY: RelayLinkConfig = { orbit: NRHO_9_2_SOUTH, minClearanceDeg: 2 };

const post = (msg: AnalysisResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

/** Yield to the event loop so queued messages (snapshots, newer windows) are handled. */
const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

async function init() {
  try {
    const provider = getDataProvider();
    const [grid, eph] = await Promise.all([provider.getAnalysisGrid(), provider.getEphemeris()]);
    state = { grid, eph, frames: buildCellFrames(grid, cellsInExtent(grid.geometry)) };
    post({ type: "ready", validation: grid.validation, cells: state.frames.cells.length });
    while (queue.length) handle(queue.shift()!);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

function postWindow(
  req: WindowRequest,
  sun: WindowVisibility,
  earth: WindowVisibility,
  relay: RelayWindowResult,
  partial: boolean,
  t0: number,
) {
  const msg: WindowResult = {
    type: "window",
    id: req.id,
    window: req.window,
    partial,
    sunFraction: sun.fraction,
    earthFraction: earth.fraction,
    longestNightHours: sun.longestGapHours,
    longestEarthGapHours: earth.longestGapHours,
    relayFraction: relay.fraction,
    relayGapHours: relay.longestGapHours,
    computeMs: performance.now() - t0,
  };
  post(msg, [
    sun.fraction.buffer,
    earth.fraction.buffer,
    sun.longestGapHours.buffer,
    earth.longestGapHours.buffer,
    relay.fraction.buffer,
    relay.longestGapHours.buffer,
  ]);
}

async function runWindow(s: State, req: WindowRequest) {
  const t0 = performance.now();
  const { grid, eph, frames } = s;
  const make = (step: number) => ({
    sun: createWindowAccumulator(grid, frames, eph, req.window, "sun", step),
    earth: createWindowAccumulator(grid, frames, eph, req.window, "earth", step),
    relay: createRelayAccumulator(grid, frames, eph, req.window, RELAY, step),
  });

  // 1. Coarse preview (cheap), so the heatmap appears at once.
  if (req.stepHours < COARSE_STEP_HOURS) {
    const c = make(COARSE_STEP_HOURS);
    c.sun.advance(c.sun.samples);
    c.earth.advance(c.earth.samples);
    c.relay.advance(c.relay.samples);
    postWindow(req, c.sun.result(), c.earth.result(), c.relay.result(), true, t0);
    await yieldNow();
  }

  // 2. Full resolution, in slices.
  const f = make(req.stepHours);
  for (;;) {
    if (req.id !== currentWindowId) return; // superseded by a newer window
    const sunDone = f.sun.advance(SLICE);
    const earthDone = f.earth.advance(SLICE);
    const relayDone = f.relay.advance(SLICE);
    if (sunDone && earthDone && relayDone) break;
    await yieldNow();
  }
  postWindow(req, f.sun.result(), f.earth.result(), f.relay.result(), false, t0);
}

function handle(req: AnalysisRequest) {
  if (!state) {
    // Keep only the latest request of each type while loading.
    const i = queue.findIndex((q) => q.type === req.type);
    if (i >= 0) queue.splice(i, 1);
    queue.push(req);
    return;
  }
  const { grid, eph, frames } = state;
  try {
    if (req.type === "window") {
      currentWindowId = req.id;
      runWindow(state, req).catch((e: unknown) =>
        post({ type: "error", id: req.id, message: e instanceof Error ? e.message : String(e) }),
      );
    } else if (req.type === "snapshot") {
      const dir = bodyDirection(eph, "sun", req.tMs);
      const out = visibilitySnapshot(grid, frames, dir, SUN_RADIUS_DEG);
      const [x0, y0, x1, y1] = grid.geometry.extentM;
      const centre = xyToLonLat((x0 + x1) / 2 + 1, (y0 + y1) / 2 + 1);
      const sky = localSky(centre, dir.subPoint);
      post(
        {
          type: "snapshot",
          id: req.id,
          tMs: req.tMs,
          sun: out,
          sunMapBearingDeg: dir.subPoint.lon,
          sunElevationDeg: sky.elevationDeg,
        },
        [out.buffer],
      );
    } else {
      post({
        type: "series",
        id: req.id,
        cell: req.cell,
        sun: pointSeries(grid, req.cell, eph, req.window, "sun", req.stepHours),
        earth: pointSeries(grid, req.cell, eph, req.window, "earth", req.stepHours),
        relay: relayPointSeries(
          grid,
          buildCellFrames(grid, Int32Array.of(req.cell)),
          eph,
          req.window,
          RELAY,
          10,
        ),
      });
    }
  } catch (e) {
    post({ type: "error", id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => handle(e.data);
void init();
