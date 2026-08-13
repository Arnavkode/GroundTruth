"use client";

import { useEffect, useState } from "react";
import type { BudgetSnapshot } from "@/lib/stream";

/**
 * Rate-limit and spend state, in the app's own voice.
 *
 * The rule this follows: a limit being hit is not an error, and must not look
 * like one. Every result on screen is still complete and still correct — the
 * deterministic checks, confidence and buckets never depended on a live model.
 * The only thing that changed is where the narrative reasoning came from. So
 * the notice explains the trade, shows what remains, and says when it lifts.
 */

const REASON_COPY: Record<
  string,
  { title: string; tone: "neutral" | "warn" | "stop"; body: (b: BudgetSnapshot) => string }
> = {
  "ip-limit-exceeded": {
    title: "Hourly limit reached for your connection",
    tone: "warn",
    body: (b) =>
      `You have used all ${b.limits.perIpPerHour} live reasoning runs available per hour. Everything below still ran — the deterministic checks, the confidence model and the buckets never needed a model — but the written analysis is canned rather than generated.`,
  },
  "daily-cap-reached": {
    title: "Daily call cap reached",
    tone: "stop",
    body: (b) =>
      `This deployment allows ${b.limits.dailyCalls} live calls a day across all traffic — deliberately a fraction of the provider's ${b.limits.freeTierRpd}/day free allowance, so we never run up against their ceiling. Resolution quality is unaffected; the reasoning step is canned until the cap resets.`,
  },
  "quota-exhausted": {
    title: "Free-tier quota exhausted for today",
    tone: "stop",
    body: (b) =>
      `The provider returned a quota error, so live reasoning is off until the daily quota resets. There is no billing account behind this key — past the free quota the request simply stops, which is the point. ${b.callsUsedToday} live calls were made today.`,
  },
  "upload-cap-reached": {
    title: "Live-call limit reached for this run",
    tone: "warn",
    body: (b) =>
      `One run may use at most ${b.runMax} live calls, so a large upload cannot spend the whole day's budget by itself. The remaining transactions in this batch were resolved with canned reasoning.`,
  },
  "kill-switch": {
    title: "Live reasoning is switched off",
    tone: "neutral",
    body: () =>
      "DISABLE_REAL_MODE is set on this deployment, so every reasoning step is canned. Nothing else about the resolver changes.",
  },
  "no-api-key": {
    title: "Running in mock mode",
    tone: "neutral",
    body: () =>
      "No Gemini API key is configured, so the reasoning step is served from hand-written per-case analysis. Every check, score and bucket you see is computed from the data either way — those come from the fitted model, not from a language model.",
  },
  "forced-mock": {
    title: "Mock mode forced",
    tone: "neutral",
    body: () => "FORCE_MOCK_MODE is set on this deployment.",
  },
};

const TONE: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  neutral: { border: "border-rule", bg: "bg-surface", text: "text-muted", dot: "bg-muted/50" },
  warn: {
    border: "border-explained/40",
    bg: "bg-explained/[0.07]",
    text: "text-explained",
    dot: "bg-explained",
  },
  stop: {
    border: "border-flagged/40",
    bg: "bg-flagged/[0.06]",
    text: "text-flagged",
    dot: "bg-flagged",
  },
};

function useCountdown(target: number | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [target]);

  if (target === null) return null;
  const ms = target - Date.now();
  if (ms <= 0) return "now";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs} h` : `${hrs} h ${rem} min`;
}

/** Compact status pill for the toolbar row. */
export function BudgetBadge({ budget }: { budget: BudgetSnapshot | null }) {
  if (!budget) return null;
  const live = budget.mode === "real";
  return (
    <span
      className={`chip ${
        live ? "border-signal/40 bg-signal/[0.07] text-signal" : "border-rule bg-surface text-muted"
      }`}
      title={budget.message}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-signal" : "bg-muted/50"}`} aria-hidden />
      {live ? "live reasoning" : "mock reasoning"}
      {live && budget.limits.perIpPerHour < Infinity && (
        <span className="tnum font-mono opacity-70">
          {budget.ipRemaining}/{budget.limits.perIpPerHour}
        </span>
      )}
    </span>
  );
}

export function BudgetNotice({ budget }: { budget: BudgetSnapshot | null }) {
  const resets = useCountdown(budget?.resetAt ?? null);
  if (!budget) return null;

  const copy = REASON_COPY[budget.reason];
  // Nothing to say when live reasoning is simply working.
  if (!copy) return null;

  const tone = TONE[copy.tone];
  const isLimit = [
    "ip-limit-exceeded",
    "daily-cap-reached",
    "quota-exhausted",
    "upload-cap-reached",
  ].includes(budget.reason);

  return (
    <section
      className={`card mt-6 border ${tone.border} ${tone.bg} px-5 py-4 animate-riseIn`}
      role={isLimit ? "status" : undefined}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`flex items-center gap-2 text-sm font-medium ${tone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
          {copy.title}
        </span>
        {resets && isLimit && (
          <span className="tnum font-mono text-xs text-muted">resets in {resets}</span>
        )}
      </div>

      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{copy.body(budget)}</p>

      {isLimit && (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          <span className="text-ink">Nothing on this page is degraded output.</span> Amounts, fee and
          FX checks, posting windows, confidence scores and bucket assignments are all computed from
          the data and are identical either way.
        </p>
      )}

      <dl className="mt-4 grid gap-px overflow-hidden rounded border border-rule bg-rule sm:grid-cols-4">
        <Cell
          label="this hour"
          value={`${budget.ipRemaining} / ${budget.limits.perIpPerHour}`}
          spent={budget.ipRemaining === 0}
        />
        <Cell
          label="today"
          value={`${budget.dailyRemaining} / ${budget.limits.dailyCalls}`}
          spent={budget.dailyRemaining === 0}
        />
        <Cell
          label="tokens today"
          value={budget.tokensUsedToday.toLocaleString("en-US")}
          spent={false}
        />
        <Cell
          label="this run"
          value={Number.isFinite(budget.runMax) ? `${budget.runUsed} / ${budget.runMax}` : "—"}
          spent={budget.runUsed >= budget.runMax}
        />
      </dl>

      {budget.store === "memory" && budget.mode === "real" && (
        <p className="mt-3 text-xs leading-relaxed text-flagged">
          Caps are being counted per serverless instance, not globally — set{" "}
          <code className="font-mono">UPSTASH_REDIS_REST_URL</code> and{" "}
          <code className="font-mono">UPSTASH_REDIS_REST_TOKEN</code> (or the{" "}
          <code className="font-mono">KV_REST_API_*</code> pair Vercel&apos;s integration sets) to make
          them real.
        </p>
      )}
    </section>
  );
}

function Cell({ label, value, spent }: { label: string; value: string; spent: boolean }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-micro uppercase tracking-widest text-muted">{label}</dt>
      <dd className={`tnum mt-0.5 font-mono text-sm ${spent ? "text-flagged" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
