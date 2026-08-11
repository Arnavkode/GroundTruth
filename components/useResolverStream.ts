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
  origin: "fixtures" | "upload" | null;
  datasetLabel: string;
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
  origin: null,
  datasetLabel: "",
  live: null,
  resolutions: [],
  summary: null,
  rebuttal: null,
  error: null,
};

export function useResolverStream() {
  const [state, setState] = useState<StreamState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  /**
   * Consume an SSE stream with fetch rather than EventSource — EventSource is
   * GET-only, and an uploaded dataset has to be POSTed.
   */
  const start = useCallback(
    (url: string, body?: unknown) => {
      stop();
      setState({ ...EMPTY, phase: "running" });
      const controller = new AbortController();
      abortRef.current = controller;

      const apply = (e: Record<string, unknown>) =>
        setState((prev) => {
          switch (e.type) {
            case "meta":
              return {
                ...prev,
                mode: e.mode as "real" | "mock",
                modeMessage: String(e.message ?? ""),
                origin: (e.origin as "fixtures" | "upload") ?? null,
                datasetLabel: String(e.datasetLabel ?? ""),
              };
            case "unit-start":
              return {
                ...prev,
                live: {
                  ref: String(e.ref),
                  label: String(e.label),
                  index: Number(e.index),
                  total: Number(e.total),
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
                        { source: String(e.source), detail: String(e.detail), found: Boolean(e.found) },
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
                        {
                          label: String(e.label),
                          outcome: String(e.outcome),
                          detail: String(e.detail),
                          kind: String(e.kind),
                        },
                      ],
                    },
                  }
                : prev;
            case "reasoning":
              return prev.live
                ? { ...prev, live: { ...prev.live, reasoning: String(e.question) } }
                : prev;
            case "resolution":
              return { ...prev, resolutions: [...prev.resolutions, e.resolution as Resolution] };
            case "summary":
              return {
                ...prev,
                summary: {
                  matched: Number(e.matched),
                  explained: Number(e.explained),
                  flagged: Number(e.flagged),
                  total: Number(e.total),
                },
              };
            case "rebuttal":
              return {
                ...prev,
                rebuttal: {
                  rebuttal: e.rebuttal as Rebuttal,
                  factors: e.factors as { label: string; weight: number; citation: Citation }[],
                },
              };
            case "error":
              return { ...prev, phase: "error", error: String(e.message) };
            case "done":
              return { ...prev, phase: "done", live: null };
            default:
              return prev;
          }
        });

      (async () => {
        try {
          const res = await fetch(url, {
            method: body === undefined ? "GET" : "POST",
            headers: body === undefined ? undefined : { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            let message = `The resolver returned ${res.status}.`;
            try {
              const j = await res.json();
              if (j?.problems?.length) message = `Dataset rejected: ${j.problems.join("; ")}`;
              else if (j?.error) message = String(j.error);
            } catch {
              /* keep the status-code message */
            }
            setState((prev) => ({ ...prev, phase: "error", error: message }));
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const line = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (line) apply(JSON.parse(line.slice(6)));
            }
          }
          setState((prev) => (prev.phase === "running" ? { ...prev, phase: "done", live: null } : prev));
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: "Connection to the resolver stream was lost.",
          }));
        }
      })();
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState(EMPTY);
  }, [stop]);

  return { state, start, reset };
}
