"use client";

/**
 * Owns the analysis Web Worker. Requests are "latest wins": while one snapshot is in flight, newer
 * scrubber positions replace the pending one, so playback never queues up stale frames.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GridValidation } from "@/domain/grid/grid";
import type { TimeWindow } from "@/domain/types";
import type {
  AnalysisRequest,
  AnalysisResponse,
  SeriesResult,
  SnapshotResult,
  WindowResult,
} from "@/workers/analysisProtocol";

export type AnalysisStatus = "loading" | "ready" | "error";

export interface AnalysisView {
  status: AnalysisStatus;
  error: string | null;
  validation: GridValidation | undefined;
  windowResult: WindowResult | null;
  windowPending: boolean;
  snapshot: SnapshotResult | null;
  series: SeriesResult | null;
  requestSnapshot: (tMs: number) => void;
  requestSeries: (cell: number | null) => void;
}

type Kind = AnalysisRequest["type"];

export function useAnalysis(window: TimeWindow, stepHours: number): AnalysisView {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const latest = useRef<Record<Kind, number>>({ window: 0, snapshot: 0, series: 0 });
  const busy = useRef<Record<Kind, boolean>>({ window: false, snapshot: false, series: false });
  const pending = useRef<Partial<Record<Kind, AnalysisRequest>>>({});
  const windowRef = useRef(window);

  const [status, setStatus] = useState<AnalysisStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<GridValidation>();
  const [windowResult, setWindowResult] = useState<WindowResult | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [series, setSeries] = useState<SeriesResult | null>(null);

  const send = useCallback((req: AnalysisRequest) => {
    const w = workerRef.current;
    if (!w) return;
    latest.current[req.type] = req.id;
    // The worker itself abandons superseded window jobs, so windows are never gated here.
    if (req.type === "window") {
      w.postMessage(req);
      return;
    }
    if (busy.current[req.type]) {
      pending.current[req.type] = req;
      return;
    }
    busy.current[req.type] = true;
    w.postMessage(req);
  }, []);

  useEffect(() => {
    const w = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<AnalysisResponse>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        setStatus("ready");
        setValidation(msg.validation);
        return;
      }
      if (msg.type === "error") {
        console.error("[analysis worker]", msg.message);
        setError(msg.message);
        if (msg.id === undefined) setStatus("error");
        return;
      }
      if (msg.type === "window") {
        if (msg.id === latest.current.window) setWindowResult(msg);
        return;
      }
      busy.current[msg.type] = false;
      const next = pending.current[msg.type];
      if (next) {
        delete pending.current[msg.type];
        busy.current[msg.type] = true;
        w.postMessage(next);
      }
      if (msg.id !== latest.current[msg.type] && next) return; // stale, a newer one is running
      if (msg.type === "snapshot") setSnapshot(msg);
      else setSeries(msg);
    };
    w.onerror = (e) => {
      setStatus("error");
      setError(e.message || "The analysis worker failed to start.");
    };
    return () => {
      w.terminate();
      workerRef.current = null;
      // Requests in flight die with the worker (e.g. React StrictMode's dev double-mount):
      // forget them, or later requests would wait forever behind a reply that never comes.
      busy.current = { window: false, snapshot: false, series: false };
      pending.current = {};
    };
  }, []);

  useEffect(() => {
    windowRef.current = window;
    send({ type: "window", id: nextId.current++, window, stepHours });
  }, [window, stepHours, send]);

  const requestSnapshot = useCallback(
    (tMs: number) => send({ type: "snapshot", id: nextId.current++, tMs }),
    [send],
  );

  const requestSeries = useCallback(
    (cell: number | null) => {
      if (cell === null) {
        setSeries(null);
        return;
      }
      send({
        type: "series",
        id: nextId.current++,
        cell,
        window: windowRef.current,
        stepHours: 1,
      });
    },
    [send],
  );

  // Derived, not stored: the shown result is stale until it matches the requested window.
  const windowPending =
    !windowResult ||
    windowResult.partial ||
    windowResult.window.startMs !== window.startMs ||
    windowResult.window.endMs !== window.endMs;

  return {
    status,
    error,
    validation,
    windowResult,
    windowPending,
    snapshot,
    series,
    requestSnapshot,
    requestSeries,
  };
}
