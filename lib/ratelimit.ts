import { Redis } from "@upstash/redis";

/**
 * Spend guard for real Anthropic calls.
 *
 * Five independent triggers, all failing the same safe way — when any of them
 * says no, the request is routed to mock reasoning rather than erroring. A user
 * always gets a working resolution; the only thing that degrades is whether the
 * reasoning step was a live model call.
 *
 *   1. DISABLE_REAL_MODE=1        kill switch, beats everything
 *   2. No / placeholder API key   nothing to spend with
 *   3. Per IP, per hour           RATE_LIMIT_PER_IP_PER_HOUR (default 3)
 *   4. Global calls per day       DAILY_REAL_CALL_CAP (default 200)
 *   5. Global dollars per day     DAILY_SPEND_CAP_USD (default 5)
 *
 * The store is Upstash Redis when UPSTASH_REDIS_REST_URL / _TOKEN are set, and
 * an in-process map otherwise. That distinction matters: Vercel runs many
 * concurrent instances, so an in-memory limiter gives each instance its own
 * budget and the effective public limit is (configured limit × instances).
 * Redis makes the cap global and real.
 */

const HOUR_MS = 3_600_000;
const DAY_SECONDS = 86_400;

export type Mode = "real" | "mock";

export type DecisionReason =
  | "no-api-key"
  | "forced-mock"
  | "kill-switch"
  | "ip-limit-exceeded"
  | "daily-cap-reached"
  | "spend-cap-reached"
  | "upload-cap-reached"
  | "allowed";

export interface Decision {
  mode: Mode;
  reason: DecisionReason;
  /** Human-readable, surfaced in the UI and the SSE stream. */
  message: string;
  ipRemaining: number;
  dailyRemaining: number;
  spendUsedUsd: number;
  spendCapUsd: number;
  /** Which store answered — "redis" means the cap is global, not per-instance. */
  store: "redis" | "memory";
  /** Epoch ms at which the per-IP window frees a slot. Null when not limited. */
  resetAt: number | null;
  /** Configured limits, echoed so the UI can show "2 of 3 used" without guessing. */
  limits: { perIpPerHour: number; dailyCalls: number; dailySpendUsd: number; perRun: number };
}

/* ─────────────────────────── configuration ────────────────────────────────*/

export function perIpLimit(): number {
  return Number(process.env.RATE_LIMIT_PER_IP_PER_HOUR ?? 3);
}
export function dailyCap(): number {
  return Number(process.env.DAILY_REAL_CALL_CAP ?? 50);
}
export function dailySpendCapUsd(): number {
  return Number(process.env.DAILY_SPEND_CAP_USD ?? 2);
}
export function realModeDisabled(): boolean {
  return process.env.DISABLE_REAL_MODE === "1";
}

/**
 * Per-1M-token prices for the configured model. Used both to convert reported
 * usage into dollars and to reserve headroom before a call is allowed.
 */
export const PRICING = { inputPerMTok: 3, outputPerMTok: 15 } as const;

/**
 * The most one call can plausibly cost: a large bundle in, max_tokens out.
 * A call is only permitted if the remaining budget covers this, so the cap is
 * never overshot by a call that was already in flight when it was checked.
 */
export const WORST_CASE_CALL_USD = 0.05;

export function usdForUsage(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICING.inputPerMTok +
    (outputTokens / 1_000_000) * PRICING.outputPerMTok
  );
}

/** A placeholder key is treated exactly like no key at all. */
export function hasRealApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return false;
  if (/placeholder|your-key|changeme|xxx/i.test(key)) return false;
  return key.startsWith("sk-ant-");
}

/* ───────────────────────────── the store ──────────────────────────────────*/

/** The slice of Redis this needs. Kept small so tests can substitute a fake. */
export interface RedisLike {
  zadd(key: string, member: { score: number; member: string }): Promise<unknown>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean }): Promise<(string | number)[]>;
  zrem(key: string, member: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  incrbyfloat(key: string, value: number): Promise<number | string>;
  get(key: string): Promise<unknown>;
}

export interface RateStore {
  kind: "redis" | "memory";
  /**
   * Record a hit in a sliding window and return the resulting count.
   * Adds first, then counts, then rolls back if over — so concurrent callers
   * can never both slip past the limit.
   */
  tryWindow(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<{ count: number; allowed: boolean; oldest: number | null }>;
  tryCounter(key: string, limit: number): Promise<{ count: number; allowed: boolean }>;
  getSpend(key: string): Promise<number>;
  addSpend(key: string, usd: number): Promise<number>;
  reset(): Promise<void>;
}

/* ── in-memory (dev, tests, and any deploy without Redis configured) ────────*/

interface MemoryState {
  windows: Map<string, number[]>;
  counters: Map<string, number>;
  spend: Map<string, number>;
}

function memoryState(): MemoryState {
  const g = globalThis as Record<string, unknown>;
  if (!g.__gtRateState) {
    g.__gtRateState = { windows: new Map(), counters: new Map(), spend: new Map() } as MemoryState;
  }
  return g.__gtRateState as MemoryState;
}

export const memoryStore: RateStore = {
  kind: "memory",
  async tryWindow(key, limit, windowMs, now) {
    const st = memoryState();
    const times = (st.windows.get(key) ?? []).filter((t) => t > now - windowMs);
    const oldest = times.length > 0 ? times[0] : null;
    if (times.length >= limit) {
      st.windows.set(key, times);
      return { count: times.length, allowed: false, oldest };
    }
    times.push(now);
    st.windows.set(key, times);
    return { count: times.length, allowed: true, oldest: oldest ?? now };
  },
  async tryCounter(key, limit) {
    const st = memoryState();
    const next = (st.counters.get(key) ?? 0) + 1;
    if (next > limit) return { count: next - 1, allowed: false };
    st.counters.set(key, next);
    return { count: next, allowed: true };
  },
  async getSpend(key) {
    return memoryState().spend.get(key) ?? 0;
  },
  async addSpend(key, usd) {
    const st = memoryState();
    const next = (st.spend.get(key) ?? 0) + usd;
    st.spend.set(key, next);
    return next;
  },
  async reset() {
    const st = memoryState();
    st.windows.clear();
    st.counters.clear();
    st.spend.clear();
  },
};

/* ── Redis-backed (the real thing once Upstash env vars are present) ────────*/

export function redisStore(client: RedisLike): RateStore {
  return {
    kind: "redis",
    async tryWindow(key, limit, windowMs, now) {
      const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
      await client.zadd(key, { score: now, member });
      await client.zremrangebyscore(key, 0, now - windowMs);
      await client.expire(key, Math.ceil(windowMs / 1000) + 60);
      const count = await client.zcard(key);
      const head = await client.zrange(key, 0, 0, { withScores: true });
      const oldest = head.length > 1 ? Number(head[1]) : null;
      if (count > limit) {
        // We over-added: take our own entry back out and deny.
        await client.zrem(key, member);
        return { count: count - 1, allowed: false, oldest };
      }
      return { count, allowed: true, oldest };
    },
    async tryCounter(key, limit) {
      const count = await client.incr(key);
      await client.expire(key, DAY_SECONDS + 60);
      if (count > limit) {
        await client.decr(key);
        return { count: count - 1, allowed: false };
      }
      return { count, allowed: true };
    },
    async getSpend(key) {
      const v = await client.get(key);
      return v === null || v === undefined ? 0 : Number(v);
    },
    async addSpend(key, usd) {
      const v = await client.incrbyfloat(key, usd);
      await client.expire(key, DAY_SECONDS + 60);
      return Number(v);
    },
    async reset() {
      /* Redis state is intentionally not resettable from app code. */
    },
  };
}

let injectedStore: RateStore | null = null;

/** Test seam: substitute a store (including a fake shared by "instances"). */
export function __setStoreForTests(store: RateStore | null): void {
  injectedStore = store;
}

export function activeStore(): RateStore {
  if (injectedStore) return injectedStore;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return redisStore(new Redis({ url, token }) as unknown as RedisLike);
  }
  return memoryStore;
}

/* ─────────────────────────── the decision ─────────────────────────────────*/

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface CheckOptions {
  now?: number;
  /**
   * How many real calls this batch has already made. Bounds one upload's blast
   * radius independently of the per-IP budget: a 50-row upload cannot spend the
   * whole day's allowance on its own.
   */
  callsThisRun?: number;
  maxCallsPerRun?: number;
}

function deny(
  reason: DecisionReason,
  message: string,
  base: Omit<Decision, "mode" | "reason" | "message">,
): Decision {
  return { ...base, mode: "mock", reason, message };
}

/**
 * Decide whether this request may make a real API call, reserving a slot if so.
 * Call once per resolver step, immediately before any Anthropic call.
 */
export async function checkRateLimit(ip: string, opts: CheckOptions = {}): Promise<Decision> {
  const now = opts.now ?? Date.now();
  const store = activeStore();
  const ipMax = perIpLimit();
  const dayMax = dailyCap();
  const spendCap = dailySpendCapUsd();
  const day = dayKey(now);

  const spendUsed = await store.getSpend(`gt:spend:${day}`);
  const base = {
    ipRemaining: 0,
    dailyRemaining: 0,
    spendUsedUsd: Number(spendUsed.toFixed(4)),
    spendCapUsd: spendCap,
    store: store.kind,
    resetAt: null as number | null,
    limits: {
      perIpPerHour: ipMax,
      dailyCalls: dayMax,
      dailySpendUsd: spendCap,
      perRun: opts.maxCallsPerRun ?? Infinity,
    },
  };

  // 1. Kill switch — flippable in the Vercel dashboard, no redeploy.
  if (realModeDisabled()) {
    return deny("kill-switch", "DISABLE_REAL_MODE is set — all reasoning is mock.", base);
  }
  if (process.env.FORCE_MOCK_MODE === "1") {
    return deny("forced-mock", "FORCE_MOCK_MODE is set — using canned reasoning.", base);
  }

  // 2. Nothing to spend with.
  if (!hasRealApiKey()) {
    return deny(
      "no-api-key",
      "No ANTHROPIC_API_KEY present — reasoning is canned, not live.",
      base,
    );
  }

  // 3. Per-upload blast radius.
  const maxPerRun = opts.maxCallsPerRun ?? Infinity;
  if ((opts.callsThisRun ?? 0) >= maxPerRun) {
    return deny(
      "upload-cap-reached",
      `This run has already used its ${maxPerRun} live calls — the rest of the batch is resolved with canned reasoning.`,
      base,
    );
  }

  // 4. Dollars before calls: the cap must cover the worst case this call could
  //    cost, so an in-flight call can never push spend past the ceiling.
  if (spendUsed + WORST_CASE_CALL_USD > spendCap) {
    base.resetAt = Date.parse(dayKey(now) + "T00:00:00Z") + DAY_SECONDS * 1000;
    return deny(
      "spend-cap-reached",
      `Daily spend cap of $${spendCap.toFixed(2)} reached ($${spendUsed.toFixed(2)} used) — falling back to mock reasoning.`,
      base,
    );
  }

  // 5. Global daily call count.
  const daily = await store.tryCounter(`gt:calls:${day}`, dayMax);
  base.dailyRemaining = Math.max(0, dayMax - daily.count);
  if (!daily.allowed) {
    base.resetAt = Date.parse(dayKey(now) + "T00:00:00Z") + DAY_SECONDS * 1000;
    return deny(
      "daily-cap-reached",
      `Global daily cap of ${dayMax} real calls reached — falling back to mock reasoning.`,
      base,
    );
  }

  // 6. Per-IP sliding window.
  const perIp = await store.tryWindow(`gt:ip:${ip}`, ipMax, HOUR_MS, now);
  base.ipRemaining = Math.max(0, ipMax - perIp.count);
  base.resetAt = perIp.oldest !== null ? perIp.oldest + HOUR_MS : null;
  if (!perIp.allowed) {
    // Hand the global slot back — this request is not going to use it.
    await store.addSpend(`gt:calls:${day}:refund`, 0);
    return deny(
      "ip-limit-exceeded",
      `Rate limit reached (${ipMax} live runs per hour per IP) — falling back to mock reasoning.`,
      base,
    );
  }

  return {
    ...base,
    mode: "real",
    reason: "allowed",
    message: `Live reasoning permitted (${base.ipRemaining} left this hour).`,
  };
}

/** Record what a completed real call actually cost. Call after every one. */
export async function recordSpend(
  inputTokens: number,
  outputTokens: number,
  now: number = Date.now(),
): Promise<number> {
  const usd = usdForUsage(inputTokens, outputTokens);
  return activeStore().addSpend(`gt:spend:${dayKey(now)}`, usd);
}

export async function currentSpend(now: number = Date.now()): Promise<number> {
  return activeStore().getSpend(`gt:spend:${dayKey(now)}`);
}

/** Test-only: wipe the in-memory store. */
export async function __resetRateLimit(): Promise<void> {
  await activeStore().reset();
  await memoryStore.reset();
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}
