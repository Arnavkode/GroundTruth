"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Citation, Rebuttal, Resolution } from "@/lib/resolver/types";

interface LiveUnit {
  ref: string;
  label: string;
  index: number;
  total: number;
  sources: { source: string; detail: string; found: boolean }[];
  checks: { label: string; outcome: string; detail: string; kind: string }[];
  reasoning: string | null;
}

export interface StreamState {
  phase: "idle" | "running" | "done" | "error";
  mode: "real" | "mock" | null;
  modeMessage: string;
  live: LiveUnit | null;
  resolutions: Resolution[];
  summary: { matched: number; explained: number; flagged: number; total: number } | null;
  rebuttal: {
    rebuttal: Rebuttal;
    factors: { label: string; weight: number; citation: Citation }[];
  } | null;
  error: string | null;
}

const EMPTY: StreamState = {
  phase: "idle",
  mode: null,
  modeMessage: "",
  live: null,
  resolutions: [],
  summary: null,
  rebuttal: null,
  error: null,
};

export function useResolverStream() {
  const [state, setState] = useState<StreamState>(EMPTY);
  const sourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (url: string) => {
      stop();
      setState({ ...EMPTY, phase: "running" });
      const es = new EventSource(url);
      sourceRef.current = es;

      es.onmessage = (msg) => {
        const e = JSON.parse(msg.data);
        setState((prev) => {
          switch (e.type) {
            case "meta":
              return { ...prev, mode: e.mode, modeMessage: e.message };
            case "unit-start":
              return {
                ...prev,
                live: {
                  ref: e.ref,
                  label: e.label,
                  index: e.index,
                  total: e.total,
                  sources: [],
                  checks: [],
                  reasoning: null,
                },
              };
            case "source":
              return prev.live
                ? {
                    ...prev,
                    live: {
                      ...prev.live,
                      sources: [
                        ...prev.live.sources,
                        { source: e.source, detail: e.detail, found: e.found },
                      ],
                    },
                  }
                : prev;
            case "check":
              return prev.live
                ? {
                    ...prev,
                    live: {
                      ...prev.live,
                      checks: [
                        ...prev.live.checks,
                        { label: e.label, outcome: e.outcome, detail: e.detail, kind: e.kind },
                      ],
                    },
                  }
                : prev;
            case "reasoning":
              return prev.live ? { ...prev, live: { ...prev.live, reasoning: e.question } } : prev;
            case "resolution":
              return { ...prev, resolutions: [...prev.resolutions, e.resolution] };
            case "summary":
              return {
                ...prev,
                summary: {
                  matched: e.matched,
                  explained: e.explained,
                  flagged: e.flagged,
                  total: e.total,
                },
              };
            case "rebuttal":
              return { ...prev, rebuttal: { rebuttal: e.rebuttal, factors: e.factors } };
            case "error":
              return { ...prev, phase: "error", error: e.message };
            case "done":
              es.close();
              return { ...prev, phase: "done", live: null };
            default:
              return prev;
          }
        });
      };

      es.onerror = () => {
        es.close();
        setState((prev) =>
          prev.phase === "done"
            ? prev
            : { ...prev, phase: "error", error: "Connection to the resolver stream was lost." },
        );
      };
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState(EMPTY);
  }, [stop]);

  return { state, start, reset };
}
