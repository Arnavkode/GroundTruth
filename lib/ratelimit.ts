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
 *   6. Per run                    MAX_REAL_CALLS_PER_RUN (default 16 = the fixture set)
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

/**
 * Most live calls one run may make, whatever the per-IP budget allows.
 *
 * This is the cap that actually decides whether a batch resolves fully live,
 * and it binds before the per-IP one does: raising the hourly limit alone
 * changes nothing if a single run still stops at ten. The default matches the
 * bundled fixture set (16 units) so a reviewer sees the whole thing reasoned
 * rather than the first ten units live and the rest canned.
 *
 * It still exists because an upload may carry up to 50 rows, and one upload
 * must not be able to spend the whole day's budget by itself.
 */
export function perRunLimit(): number {
  return Number(process.env.MAX_REAL_CALLS_PER_RUN ?? 16);
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
  setFlag(key: string, ttlSeconds?: number): Promise<void>;
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
    // The in-memory store has no expiry; only the Redis path is load-bearing
    // for the cooldown, and tests drive the clock explicitly.
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
    async setFlag(key, ttlSeconds) {
      await client.set(key, "1");
      await client.expire(key, ttlSeconds ?? DAY_SECONDS + 60);
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

  // A recent 429 from the provider. Back off for the cooldown rather than
  // hammering a limit we cannot distinguish between "per minute" and "per day".
  if (await store.getFlag(QUOTA_COOLDOWN_KEY)) {
    base.resetAt = now + QUOTA_COOLDOWN_SECONDS * 1000;
    return deny(
      "quota-exhausted",
      `The provider returned a rate/quota error recently — reasoning is canned for up to ` +
        `${QUOTA_COOLDOWN_SECONDS / 60} minutes, then live reasoning is retried automatically.`,
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

  // ── Order matters here, and getting it wrong is an availability bug ───────
  //
  // The per-IP window is checked BEFORE the global daily counter is
  // incremented. Done the other way round — as this did until a review caught
  // it — every refused request still consumed a slot from the global budget,
  // so one address looping a few hundred times could exhaust the day's live
  // reasoning for every other visitor while receiving only its own handful of
  // calls. Pure damage, no benefit to the attacker. That matters more than it
  // first appears: per-IP limits are weak against a client whose egress
  // address rotates, which makes the global counter the cap that actually
  // holds, and therefore the one that must not be spendable by a denial.
  //
  // The residual asymmetry is deliberate. If the daily cap denies after the
  // per-IP window was taken, that visitor has burned one of their own slots
  // for a canned answer — but the daily cap means everyone is getting canned
  // answers anyway, so it costs them nothing they had. The reverse leak cost
  // everyone the rest of the day.
  const perIp = await store.tryWindow(`gt:ip:${ip}`, ipMax, HOUR_MS, now);
  base.ipRemaining = Math.max(0, ipMax - perIp.count);
  base.resetAt = perIp.oldest !== null ? perIp.oldest + HOUR_MS : null;
  if (!perIp.allowed) {
    // Read, never increment — reporting the number must not spend it.
    base.callsUsedToday = await store.readCounter(`gt:calls:${day}`);
    base.dailyRemaining = Math.max(0, dayMax - base.callsUsedToday);
    return deny(
      "ip-limit-exceeded",
      `Rate limit reached (${ipMax} live calls per hour per IP — one per transaction reasoned) — falling back to mock reasoning.`,
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
 * How long a provider 429 disables live reasoning.
 *
 * This used to be the rest of the UTC day, and that was wrong in a way that
 * only showed up in production: Gemini returns 429 for *both* "you have used
 * your 1000 requests today" and "you have exceeded 15 requests this minute",
 * and the error does not reliably distinguish them. A single unpaced batch of
 * 16 units is enough to trip the per-minute limit — so one burst switched the
 * whole deployment to canned reasoning for hours while the provider was
 * perfectly happy to serve. Verified directly: the deployment reported
 * `quota-exhausted` with 194 of our own 300 daily calls still unspent, and a
 * one-shot call to the same key with the same model answered in 4.3 seconds.
 *
 * A cooldown handles both cases correctly. A per-minute spike recovers by
 * itself; genuine daily exhaustion simply re-latches on the next attempt, at a
 * cost of one wasted call per cooldown window — a few dozen a day at most,
 * against a budget of 300, to avoid hours of needless degradation.
 */
const QUOTA_COOLDOWN_SECONDS = 15 * 60;

/** Not day-scoped any more: the TTL is what expires it. */
const QUOTA_COOLDOWN_KEY = "gt:quota-cooldown";

export async function markQuotaExhausted(
  detail: string,
  now: number = Date.now(),
): Promise<void> {
  await activeStore().setFlag(QUOTA_COOLDOWN_KEY, QUOTA_COOLDOWN_SECONDS);
  console.error(
    `[groundtruth] Gemini returned 429 at ${new Date(now).toISOString()}. Live reasoning is ` +
      `disabled for ${QUOTA_COOLDOWN_SECONDS / 60} minutes, then retried — this covers a ` +
      `per-minute rate spike and genuine daily exhaustion alike. Requests are served with canned ` +
      `reasoning meanwhile. This is expected behaviour, not an outage. Detail: ${detail}`,
  );
}

export async function isQuotaExhausted(): Promise<boolean> {
  return activeStore().getFlag(QUOTA_COOLDOWN_KEY);
}

export async function currentUsage(now: number = Date.now()) {
  const store = activeStore();
  const day = dayKey(now);
  return {
    calls: await store.readCounter(`gt:calls:${day}`),
    tokens: await store.readCounter(`gt:tokens:${day}`),
  };
}

/* ─────────────────────── the ingestion endpoint ───────────────────────────*/

/**
 * Uploading is an iterate-and-retry loop — you fix a rejected row and try
 * again — so this is deliberately far looser than the reasoning cap.
 */
export function ingestLimit(): number {
  return Number(process.env.RATE_LIMIT_INGEST_PER_HOUR ?? 20);
}

export interface IngestDecision {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
  /** Epoch ms at which the window frees up. Null when not limited. */
  resetAt: number | null;
  store: "redis" | "memory";
}

/**
 * Per-IP limit for `/api/ingest`, kept deliberately separate from
 * `checkRateLimit`.
 *
 * They answer different questions. `checkRateLimit` answers "may this request
 * spend a live model call?", and answering it consumes `gt:ip:<ip>` — a
 * visitor's whole live-reasoning allowance for the hour. Ingestion makes *zero*
 * model calls: it parses and validates a file. Charging it to the reasoning
 * budget would let three CSV uploads silently burn a visitor's live reasoning,
 * and would make `callsUsedToday` stop being a true count of calls made.
 *
 * The failure mode differs too. The resolver *degrades* when limited — the
 * resolution is still complete and correct, only the prose goes canned. There
 * is no canned validation of somebody's file, so this one has to actually
 * refuse.
 */
export async function checkIngestLimit(
  ip: string,
  opts: { now?: number } = {},
): Promise<IngestDecision> {
  const now = opts.now ?? Date.now();
  const store = activeStore();
  const limit = ingestLimit();
  const hit = await store.tryWindow(`gt:ingest:${ip}`, limit, HOUR_MS, now);
  return {
    allowed: hit.allowed,
    used: hit.count,
    remaining: Math.max(0, limit - hit.count),
    limit,
    resetAt: hit.allowed ? null : (hit.oldest ?? now) + HOUR_MS,
    store: store.kind,
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
