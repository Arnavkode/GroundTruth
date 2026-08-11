/**
 * Spend guard for real Anthropic calls.
 *
 * Two independent limits, both fail-safe: when either is exhausted the caller
 * is routed to mock mode rather than erroring. A user always gets a working
 * resolution; the only thing that degrades is whether the reasoning step is a
 * live model call.
 *
 *   - Per IP:  RATE_LIMIT_PER_IP_PER_HOUR   (default 10) — sliding 1h window
 *   - Global:  DAILY_REAL_CALL_CAP          (default 200) — rolling 24h window
 *
 * The store is in-memory and therefore scoped to one serverless instance. That
 * is deliberate for tonight: it needs no signup, costs nothing, and errs
 * conservatively per instance. See MORNING_CHECKLIST.md for the Upstash Redis
 * upgrade if you want a cap that holds across cold starts.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type Mode = "real" | "mock";

export type DecisionReason =
  | "no-api-key"
  | "forced-mock"
  | "ip-limit-exceeded"
  | "daily-cap-reached"
  | "allowed";

export interface Decision {
  mode: Mode;
  reason: DecisionReason;
  /** Human-readable, surfaced in the UI and the SSE stream. */
  message: string;
  ipRemaining: number;
  dailyRemaining: number;
  /** When the oldest call in this IP's window falls out, ms epoch. */
  resetAt: number | null;
}

interface Store {
  byIp: Map<string, number[]>;
  global: number[];
}

/** Survives hot reload in dev; one instance per serverless container in prod. */
const store: Store = ((globalThis as Record<string, unknown>).__gtRateLimit as Store) ?? {
  byIp: new Map<string, number[]>(),
  global: [],
};
(globalThis as Record<string, unknown>).__gtRateLimit = store;

export function perIpLimit(): number {
  return Number(process.env.RATE_LIMIT_PER_IP_PER_HOUR ?? 10);
}

export function dailyCap(): number {
  return Number(process.env.DAILY_REAL_CALL_CAP ?? 200);
}

/** A placeholder key is treated exactly like no key at all. */
export function hasRealApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return false;
  if (/placeholder|your-key|changeme|xxx/i.test(key)) return false;
  return key.startsWith("sk-ant-");
}

function prune(times: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < times.length && times[i] <= cutoff) i += 1;
  return i === 0 ? times : times.slice(i);
}

/**
 * Decide whether this request may make a real API call, and reserve a slot if
 * so. Call exactly once per resolver run, before any Anthropic call.
 */
export function checkRateLimit(ip: string, now: number = Date.now()): Decision {
  const ipMax = perIpLimit();
  const dayMax = dailyCap();

  const ipTimes = prune(store.byIp.get(ip) ?? [], now, HOUR_MS);
  const globalTimes = prune(store.global, now, DAY_MS);
  store.byIp.set(ip, ipTimes);
  store.global = globalTimes;

  const ipRemaining = Math.max(0, ipMax - ipTimes.length);
  const dailyRemaining = Math.max(0, dayMax - globalTimes.length);
  const resetAt = ipTimes.length > 0 ? ipTimes[0] + HOUR_MS : null;

  const base = { ipRemaining, dailyRemaining, resetAt };

  if (process.env.FORCE_MOCK_MODE === "1") {
    return {
      ...base,
      mode: "mock",
      reason: "forced-mock",
      message: "FORCE_MOCK_MODE is set — using canned reasoning.",
    };
  }

  if (!hasRealApiKey()) {
    return {
      ...base,
      mode: "mock",
      reason: "no-api-key",
      message: "No ANTHROPIC_API_KEY present — reasoning is canned, not live.",
    };
  }

  if (globalTimes.length >= dayMax) {
    return {
      ...base,
      mode: "mock",
      reason: "daily-cap-reached",
      message: `Global daily cap of ${dayMax} real calls reached — falling back to mock reasoning.`,
    };
  }

  if (ipTimes.length >= ipMax) {
    return {
      ...base,
      mode: "mock",
      reason: "ip-limit-exceeded",
      message: `Rate limit reached (${ipMax} real runs per hour per IP) — falling back to mock reasoning.`,
    };
  }

  // Reserve the slot.
  ipTimes.push(now);
  globalTimes.push(now);
  store.byIp.set(ip, ipTimes);
  store.global = globalTimes;

  return {
    ...base,
    mode: "real",
    reason: "allowed",
    ipRemaining: ipRemaining - 1,
    dailyRemaining: dailyRemaining - 1,
    message: "Live reasoning permitted.",
  };
}

/** Test-only: wipe the sliding windows. */
export function __resetRateLimit(): void {
  store.byIp.clear();
  store.global = [];
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}
