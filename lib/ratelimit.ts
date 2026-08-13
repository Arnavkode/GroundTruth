import { Redis } from "@upstash/redis";

/**
 * Quota guard for real Gemini calls.
 *
 * There is deliberately no dollar cap here any more, because there are no
 * dollars. The provider is a Gemini free-tier key with no billing account
 * attached: past the free quota a request 429s and stops. That is a stronger
 * guarantee than any limiter can make on a metered provider — no bug, no abuse
 * case and no runaway loop can turn into a charge. See DECISIONS.md.
 *
 * What is left to protect is the quota itself, so the app never runs up against
 * Google's ceiling and 429s a legitimate demo request:
 *
 *   1. DISABLE_REAL_MODE=1        kill switch, beats everything
 *   2. No / placeholder API key   nothing to call with
 *   3. Quota exhausted            a 429 was seen today; stop trying until tomorrow
 *   4. Per IP, per hour           RATE_LIMIT_PER_IP_PER_HOUR (default 3)
 *   5. Global calls per day       DAILY_REAL_CALL_CAP (default 300, well under the free RPD)
 *   6. Per run                    bounds one upload's share of the day
 *
 * Every one of them fails the same safe way: the request is served with canned
 * reasoning rather than erroring.
 *
 * The store is Upstash Redis when UPSTASH_REDIS_REST_* or KV_REST_API_* are set, and
 * an in-process map otherwise. Vercel runs many concurrent instances, so an
 * in-memory limiter gives each its own budget and the effective public limit is
 * (configured limit × instances). Redis makes the cap global and real.
 */

const HOUR_MS = 3_600_000;
const DAY_SECONDS = 86_400;

/**
 * Free-tier limits for the default model, confirmed 2026-08-12. Google's own
 * rate-limit page defers to the AI Studio dashboard for exact numbers, so these
 * are the published figures for the Flash-Lite tier and are used only to size
 * our own caps conservatively — never as something to run up against.
 */
export const FREE_TIER = { rpm: 15, rpd: 1000, tpm: 250_000 } as const;

export type Mode = "real" | "mock";

export type DecisionReason =
  | "no-api-key"
  | "forced-mock"
  | "kill-switch"
  | "quota-exhausted"
  | "ip-limit-exceeded"
  | "daily-cap-reached"
  | "upload-cap-reached"
  | "allowed";

export interface Decision {
  mode: Mode;
  reason: DecisionReason;
  /** Human-readable, surfaced in the UI and the SSE stream. */
  message: string;
  ipRemaining: number;
  dailyRemaining: number;
  callsUsedToday: number;
  tokensUsedToday: number;
  /** Which store answered — "redis" means the cap is global, not per-instance. */
  store: "redis" | "memory";
  /** Epoch ms at which the limiting window frees up. Null when not limited. */
  resetAt: number | null;
  limits: {
    perIpPerHour: number;
    dailyCalls: number;
    perRun: number;
    freeTierRpd: number;
    freeTierRpm: number;
  };
}

/* ─────────────────────────── configuration ────────────────────────────────*/

export function perIpLimit(): number {
  return Number(process.env.RATE_LIMIT_PER_IP_PER_HOUR ?? 3);
}

/** Sized at roughly a third of the free RPD so we never approach Google's own ceiling. */
export function dailyCap(): number {
  return Number(process.env.DAILY_REAL_CALL_CAP ?? 300);
}

export function realModeDisabled(): boolean {
  return process.env.DISABLE_REAL_MODE === "1";
}

/**
 * A placeholder key is treated exactly like no key at all. Gemini keys are long
 * opaque strings; rather than pin a prefix that Google may change, this rejects
 * anything short or obviously a stand-in.
 */
export function hasRealApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return false;
  if (/placeholder|your-key|your_key|changeme|xxx|example|test-key/i.test(key)) return false;
  return key.length >= 30;
}

/* ───────────────────────────── the store ──────────────────────────────────*/

/** The slice of Redis this needs. Kept small so tests can substitute a fake. */
export interface RedisLike {
  zadd(key: string, member: { score: number; member: string }): Promise<unknown>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrange(
    key: string,
    start: number,
    stop: number,
    opts?: { withScores?: boolean },
  ): Promise<(string | number)[]>;
  zrem(key: string, member: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  incrbyfloat(key: string, value: number): Promise<number | string>;
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
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
  readCounter(key: string): Promise<number>;
  addTokens(key: string, tokens: number): Promise<number>;
  getFlag(key: string): Promise<boolean>;
  setFlag(key: string): Promise<void>;
  reset(): Promise<void>;
}

/* ── in-memory (dev, tests, and any deploy without Redis configured) ────────*/

interface MemoryState {
  windows: Map<string, number[]>;
  counters: Map<string, number>;
  flags: Set<string>;
}

function memoryState(): MemoryState {
  const g = globalThis as Record<string, unknown>;
  if (!g.__gtRateState) {
    g.__gtRateState = { windows: new Map(), counters: new Map(), flags: new Set() } as MemoryState;
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
  async readCounter(key) {
    return memoryState().counters.get(key) ?? 0;
  },
  async addTokens(key, tokens) {
    const st = memoryState();
    const next = (st.counters.get(key) ?? 0) + tokens;
    st.counters.set(key, next);
    return next;
  },
  async getFlag(key) {
    return memoryState().flags.has(key);
  },
  async setFlag(key) {
    memoryState().flags.add(key);
  },
  async reset() {
    const st = memoryState();
    st.windows.clear();
    st.counters.clear();
    st.flags.clear();
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
    async readCounter(key) {
      const v = await client.get(key);
      return v === null || v === undefined ? 0 : Number(v);
    },
    async addTokens(key, tokens) {
      const v = await client.incrbyfloat(key, tokens);
      await client.expire(key, DAY_SECONDS + 60);
      return Number(v);
    },
    async getFlag(key) {
      return Boolean(await client.get(key));
    },
    async setFlag(key) {
      await client.set(key, "1");
      await client.expire(key, DAY_SECONDS + 60);
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

/**
 * Upstash credentials arrive under two different names depending on how the
 * database was connected: `UPSTASH_REDIS_REST_*` when you copy them from the
 * Upstash console, and `KV_REST_API_*` when Vercel's marketplace integration
 * provisions it for you. Same REST endpoint, same token, different labels.
 *
 * Reading only one name is how a deployment ends up silently on the in-memory
 * store while the dashboard says Redis is connected — which is precisely the
 * failure the persistent store exists to prevent. So accept both.
 */
export function redisCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function activeStore(): RateStore {
  if (injectedStore) return injectedStore;
  const creds = redisCredentials();
  if (creds) {
    return redisStore(new Redis(creds) as unknown as RedisLike);
  }
  return memoryStore;
}

/* ─────────────────────────── the decision ─────────────────────────────────*/

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
function midnightAfter(now: number): number {
  return Date.parse(dayKey(now) + "T00:00:00Z") + DAY_SECONDS * 1000;
}

export interface CheckOptions {
  now?: number;
  /**
   * How many real calls this batch has already made. Bounds one upload's blast
   * radius independently of the per-IP budget.
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

export async function checkRateLimit(ip: string, opts: CheckOptions = {}): Promise<Decision> {
  const now = opts.now ?? Date.now();
  const store = activeStore();
  const ipMax = perIpLimit();
  const dayMax = dailyCap();
  const day = dayKey(now);

  const callsUsedToday = await store.readCounter(`gt:calls:${day}`);
  const tokensUsedToday = await store.readCounter(`gt:tokens:${day}`);

  const base = {
    ipRemaining: 0,
    dailyRemaining: Math.max(0, dayMax - callsUsedToday),
    callsUsedToday,
    tokensUsedToday,
    store: store.kind,
    resetAt: null as number | null,
    limits: {
      perIpPerHour: ipMax,
      dailyCalls: dayMax,
      perRun: opts.maxCallsPerRun ?? Infinity,
      freeTierRpd: FREE_TIER.rpd,
      freeTierRpm: FREE_TIER.rpm,
    },
  };

  if (realModeDisabled()) {
    return deny("kill-switch", "DISABLE_REAL_MODE is set — all reasoning is mock.", base);
  }
  if (process.env.FORCE_MOCK_MODE === "1") {
    return deny("forced-mock", "FORCE_MOCK_MODE is set — using canned reasoning.", base);
  }
  if (!hasRealApiKey()) {
    return deny("no-api-key", "No GEMINI_API_KEY present — reasoning is canned, not live.", base);
  }

  // A 429 seen earlier today means the free quota is gone. Stop asking.
  if (await store.getFlag(`gt:quota-exhausted:${day}`)) {
    base.resetAt = midnightAfter(now);
    return deny(
      "quota-exhausted",
      "The Gemini free-tier quota for today is exhausted — reasoning is canned until it resets.",
      base,
    );
  }

  const maxPerRun = opts.maxCallsPerRun ?? Infinity;
  if ((opts.callsThisRun ?? 0) >= maxPerRun) {
    return deny(
      "upload-cap-reached",
      `This run has already used its ${maxPerRun} live calls — the rest of the batch is resolved with canned reasoning.`,
      base,
    );
  }

  const daily = await store.tryCounter(`gt:calls:${day}`, dayMax);
  base.callsUsedToday = daily.count;
  base.dailyRemaining = Math.max(0, dayMax - daily.count);
  if (!daily.allowed) {
    base.resetAt = midnightAfter(now);
    return deny(
      "daily-cap-reached",
      `Global daily cap of ${dayMax} live calls reached — falling back to mock reasoning.`,
      base,
    );
  }

  const perIp = await store.tryWindow(`gt:ip:${ip}`, ipMax, HOUR_MS, now);
  base.ipRemaining = Math.max(0, ipMax - perIp.count);
  base.resetAt = perIp.oldest !== null ? perIp.oldest + HOUR_MS : null;
  if (!perIp.allowed) {
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

/** Record token usage from a completed call. Observability, not a cap. */
export async function recordUsage(
  inputTokens: number,
  outputTokens: number,
  now: number = Date.now(),
): Promise<number> {
  return activeStore().addTokens(`gt:tokens:${dayKey(now)}`, inputTokens + outputTokens);
}

/**
 * Latch "the free quota is gone" for the rest of the day.
 *
 * Deliberately loud: running out of quota should be boring and recoverable, but
 * an operator reading logs must be able to see that live mode degraded and when.
 */
export async function markQuotaExhausted(
  detail: string,
  now: number = Date.now(),
): Promise<void> {
  const day = dayKey(now);
  await activeStore().setFlag(`gt:quota-exhausted:${day}`);
  console.error(
    `[groundtruth] GEMINI FREE QUOTA EXHAUSTED on ${day}. Live reasoning is disabled until ` +
      `${new Date(midnightAfter(now)).toISOString()}; every request is now served with canned ` +
      `reasoning. This is expected behaviour, not an outage. Detail: ${detail}`,
  );
}

export async function isQuotaExhausted(now: number = Date.now()): Promise<boolean> {
  return activeStore().getFlag(`gt:quota-exhausted:${dayKey(now)}`);
}

export async function currentUsage(now: number = Date.now()) {
  const store = activeStore();
  const day = dayKey(now);
  return {
    calls: await store.readCounter(`gt:calls:${day}`),
    tokens: await store.readCounter(`gt:tokens:${day}`),
  };
}

/** Test-only: wipe the in-memory store. */
export async function __resetRateLimit(): Promise<void> {
  await activeStore().reset();
  await memoryStore.reset();
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  // Order matters, and getting it wrong silently voids the per-IP cap.
  //
  // `x-forwarded-for` is a client-supplied header that proxies append to. Vercel
  // appends the real address rather than replacing the list, so the left-most
  // entry is whatever the caller typed — trusting it lets anyone mint a fresh
  // bucket per request with one header. Verified against the live deployment:
  // `-H "x-forwarded-for: 198.51.100.77"` walked straight past an exhausted cap.
  //
  // `x-vercel-forwarded-for` and `x-real-ip` are set by the platform on the way
  // in and overwrite anything the client sent, so they are the trustworthy ones.
  // The left-most `x-forwarded-for` stays as a last resort for hosts that do not
  // set either — better than one shared bucket, but it is not a security control.
  const trusted = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip");
  if (trusted) return trusted.split(",")[0].trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "0.0.0.0";
}
