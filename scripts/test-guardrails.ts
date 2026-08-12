/**
 * Proof for every public-deployment guardrail.
 *
 * Runs with a fake key so the "real" branch is reachable without any network
 * call: nothing here contacts Gemini. The persistent-store tests use a fake
 * Redis shared by several independently-constructed store objects — that is the
 * simulation of concurrent serverless instances.
 *
 *   npm run test:guardrails
 */
// 39 chars, Gemini-shaped, and deliberately not matching the placeholder filter —
// this key is never sent anywhere; no request in this file leaves the process.
process.env.GEMINI_API_KEY = "AIzaSyD1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p";
process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";
process.env.DAILY_REAL_CALL_CAP = "300";
delete process.env.DISABLE_REAL_MODE;
delete process.env.FORCE_MOCK_MODE;

import {
  __resetRateLimit,
  __setStoreForTests,
  checkRateLimit,
  clientIp,
  currentUsage,
  dailyCap,
  FREE_TIER,
  hasRealApiKey,
  isQuotaExhausted,
  markQuotaExhausted,
  memoryStore,
  perIpLimit,
  recordUsage,
  redisStore,
  type RateStore,
  type RedisLike,
} from "../lib/ratelimit";
import { isQuotaError, QuotaExhaustedError } from "../lib/resolver/llm";
import { LIMITS } from "../lib/ingest";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (!cond) failures += 1;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}
function header(t: string) {
  console.log("\n" + "-".repeat(94));
  console.log(t);
  console.log("-".repeat(94));
}

/** A minimal in-process Redis standing in for the one shared Upstash database. */
class FakeRedis implements RedisLike {
  zsets = new Map<string, Map<string, number>>();
  values = new Map<string, number | string>();

  private z(key: string) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key)!;
  }
  async zadd(key: string, m: { score: number; member: string }) {
    this.z(key).set(m.member, m.score);
  }
  async zremrangebyscore(key: string, min: number, max: number) {
    for (const [member, score] of this.z(key)) {
      if (score >= min && score <= max) this.z(key).delete(member);
    }
  }
  async zcard(key: string) {
    return this.z(key).size;
  }
  async zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean }) {
    const sorted = [...this.z(key).entries()].sort((a, b) => a[1] - b[1]);
    const slice = sorted.slice(start, stop === -1 ? undefined : stop + 1);
    return opts?.withScores ? slice.flatMap(([m, sc]) => [m, sc]) : slice.map(([m]) => m);
  }
  async zrem(key: string, member: string) {
    this.z(key).delete(member);
  }
  async expire() {}
  async incr(key: string) {
    const next = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }
  async decr(key: string) {
    const next = Number(this.values.get(key) ?? 0) - 1;
    this.values.set(key, next);
    return next;
  }
  async incrbyfloat(key: string, v: number) {
    const next = Number(this.values.get(key) ?? 0) + v;
    this.values.set(key, next);
    return next;
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  flush() {
    this.zsets.clear();
    this.values.clear();
  }
}

/** One cold serverless instance: a store closed over its own private state. */
function isolatedMemoryStore(): RateStore {
  const windows = new Map<string, number[]>();
  const counters = new Map<string, number>();
  const flags = new Set<string>();
  return {
    kind: "memory",
    async tryWindow(key, limit, windowMs, now) {
      const times = (windows.get(key) ?? []).filter((t) => t > now - windowMs);
      const oldest = times.length > 0 ? times[0] : null;
      if (times.length >= limit) return { count: times.length, allowed: false, oldest };
      times.push(now);
      windows.set(key, times);
      return { count: times.length, allowed: true, oldest: oldest ?? now };
    },
    async tryCounter(key, limit) {
      const next = (counters.get(key) ?? 0) + 1;
      if (next > limit) return { count: next - 1, allowed: false };
      counters.set(key, next);
      return { count: next, allowed: true };
    },
    async readCounter(key) {
      return counters.get(key) ?? 0;
    },
    async addTokens(key, tokens) {
      const next = (counters.get(key) ?? 0) + tokens;
      counters.set(key, next);
      return next;
    },
    async getFlag(key) {
      return flags.has(key);
    },
    async setFlag(key) {
      flags.add(key);
    },
    async reset() {},
  };
}

async function main() {
  console.log("=".repeat(94));
  console.log("GROUNDTRUTH — PUBLIC DEPLOYMENT GUARDRAILS (Gemini free tier)");
  console.log(
    `per-IP ${perIpLimit()}/hr · daily cap ${dailyCap()} calls · free tier ${FREE_TIER.rpm} RPM / ` +
      `${FREE_TIER.rpd} RPD · per-run ${LIMITS.MAX_REAL_CALLS_PER_UPLOAD} · key detected ${hasRealApiKey()}`,
  );
  console.log(
    `Headroom: our daily cap is ${((dailyCap() / FREE_TIER.rpd) * 100).toFixed(0)}% of Google's free RPD, ` +
      `so the app never runs up against the provider's own ceiling.`,
  );
  assert("daily cap leaves real headroom under the free RPD", dailyCap() <= FREE_TIER.rpd * 0.5);

  // ── 1. Persistent store under simulated concurrency ───────────────────────
  header("1. Persistent limiter: 6 concurrent 'serverless instances', one shared Redis");
  const shared = new FakeRedis();
  const instances = Array.from({ length: 6 }, () => redisStore(shared));
  const results: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    __setStoreForTests(instances[i]);
    const d = await checkRateLimit("198.51.100.5");
    results.push(d.mode);
    console.log(
      `  instance ${i + 1} → ${d.mode.padEnd(4)} (${d.reason}), store=${d.store}, ip remaining ${d.ipRemaining}`,
    );
  }
  const realCount = results.filter((m) => m === "real").length;
  assert(`only ${perIpLimit()} of 6 concurrent instances got real mode`, realCount === perIpLimit(), `got ${realCount}`);
  assert("the rest fell back to mock, not an error", results.filter((m) => m === "mock").length === 3);

  header("2. The same six requests against per-instance in-memory stores (the fallback)");
  let memReal = 0;
  for (let i = 0; i < 6; i += 1) {
    __setStoreForTests(isolatedMemoryStore());
    const d = await checkRateLimit("198.51.100.5");
    if (d.mode === "real") memReal += 1;
  }
  console.log(`  per-instance stores → ${memReal} of 6 got real mode (configured limit is ${perIpLimit()})`);
  assert(
    "per-instance memory leaks past the configured limit — which is why Redis is required",
    memReal > perIpLimit(),
    `${memReal} allowed against a limit of ${perIpLimit()}`,
  );

  // ── 3. Daily quota cap ────────────────────────────────────────────────────
  header("3. Global daily call cap trips independently of the per-IP window");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "1000";
  process.env.DAILY_REAL_CALL_CAP = "25";
  let dailyReal = 0;
  let dailyReason = "";
  for (let i = 0; i < 40; i += 1) {
    const d = await checkRateLimit(`203.0.113.${i}`);
    if (d.mode === "real") {
      dailyReal += 1;
      await recordUsage(4000, 900);
    } else {
      dailyReason = d.reason;
      break;
    }
  }
  const usage = await currentUsage();
  console.log(`  cap 25 · ${dailyReal} live calls · ${usage.tokens} tokens recorded · stopped: ${dailyReason}`);
  assert("exactly 25 live calls allowed", dailyReal === 25, `got ${dailyReal}`);
  assert("stopped for the right reason", dailyReason === "daily-cap-reached");
  assert("token usage is accounted for observability", usage.tokens === 25 * 4900);
  process.env.DAILY_REAL_CALL_CAP = "300";
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";

  // ── 4. Quota exhaustion latches for the day ───────────────────────────────
  header("4. A provider 429 latches quota-exhausted for the rest of the day");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  const before = await checkRateLimit("203.0.113.150");
  console.log(`  before → ${before.mode} (${before.reason})`);
  assert("real mode available before the 429", before.mode === "real");

  console.log("  simulating a provider 429 (the console line below is the operator signal):");
  await markQuotaExhausted("429 RESOURCE_EXHAUSTED from the provider (simulated)");
  const after = await checkRateLimit("203.0.113.151");
  console.log(`  after  → ${after.mode} (${after.reason}) resets ${new Date(after.resetAt ?? 0).toISOString()}`);
  assert("latched", await isQuotaExhausted());
  assert("subsequent requests fall back to mock", after.mode === "mock" && after.reason === "quota-exhausted");
  assert("a reset time is given", after.resetAt !== null);

  header("5. 429 detection recognises what the provider actually sends");
  const cases: [string, unknown, boolean][] = [
    ["status 429 object", { status: 429, message: "Too Many Requests" }, true],
    ["RESOURCE_EXHAUSTED message", new Error("RESOURCE_EXHAUSTED: quota"), true],
    ["rate limit prose", new Error("You exceeded your current rate limit"), true],
    ["ordinary 500", { status: 500, message: "Internal error" }, false],
    ["bad request", new Error("invalid argument"), false],
  ];
  for (const [label, err, want] of cases) {
    const got = isQuotaError(err);
    console.log(`  ${label.padEnd(28)} → ${got}`);
    assert(`${label} classified correctly`, got === want);
  }
  assert("QuotaExhaustedError is its own type", new QuotaExhaustedError("x") instanceof Error);

  // ── 6. Kill switch ────────────────────────────────────────────────────────
  header("6. DISABLE_REAL_MODE beats a present key and a full budget");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  process.env.DISABLE_REAL_MODE = "1";
  const killed = await checkRateLimit("203.0.113.200");
  console.log(`  → ${killed.mode} (${killed.reason})`);
  assert("kill switch forces mock", killed.mode === "mock" && killed.reason === "kill-switch");
  delete process.env.DISABLE_REAL_MODE;
  const restored = await checkRateLimit("203.0.113.201");
  console.log(`  after unsetting → ${restored.mode} (${restored.reason})`);
  assert("unsetting restores real mode with no redeploy", restored.mode === "real");

  // ── 7. Per-upload cap ─────────────────────────────────────────────────────
  header("7. One upload cannot burn the whole day");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "1000";
  let used = 0;
  const modes: string[] = [];
  for (let row = 0; row < 20; row += 1) {
    const d = await checkRateLimit("203.0.113.77", {
      callsThisRun: used,
      maxCallsPerRun: LIMITS.MAX_REAL_CALLS_PER_UPLOAD,
    });
    modes.push(d.mode);
    if (d.mode === "real") used += 1;
  }
  console.log(`  20-row upload, per-IP budget 1000 → ${used} live, ${modes.filter((m) => m === "mock").length} mock`);
  assert(`capped at ${LIMITS.MAX_REAL_CALLS_PER_UPLOAD}`, used === LIMITS.MAX_REAL_CALLS_PER_UPLOAD, `got ${used}`);
  assert("remainder routed to mock, not refused", modes.slice(10).every((m) => m === "mock"));
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";

  // ── 8. Key detection ──────────────────────────────────────────────────────
  header("8. Placeholder keys never enable live calls");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  const saved = process.env.GEMINI_API_KEY;
  for (const [label, key] of [
    ["unset", undefined],
    ["empty", ""],
    ["your-key-here", "your-key-here"],
    ["AIza-placeholder", "AIza-placeholder-not-a-real-key-000000"],
    ["contains xxx", "AIzaSyDxxx2b3c4d5e6f7g8h9i0j1k2l3m4n5o6"],
    ["too short", "AIzaShort"],
    ["realistic", "AIzaSyB9zQwErTyUiOpAsDfGhJkLzXcVbNm0123"],
  ] as const) {
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    const d = await checkRateLimit(`192.0.2.${Math.floor(Math.random() * 250)}`);
    console.log(`  key=${String(label).padEnd(18)} → ${d.mode} (${d.reason})`);
    if (label === "realistic") assert("a realistic key enables real mode", d.mode === "real");
    else assert(`${label} stays mock`, d.mode === "mock" && d.reason === "no-api-key");
  }
  process.env.GEMINI_API_KEY = saved;

  // ── 9. Sliding window + reset clock ───────────────────────────────────────
  header("9. The per-IP window slides, and reports a usable reset clock");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  const t0 = Date.now();
  for (let i = 0; i < perIpLimit(); i += 1) await checkRateLimit("203.0.113.9", { now: t0 });
  const blocked = await checkRateLimit("203.0.113.9", { now: t0 + 5 * 60_000 });
  const recovered = await checkRateLimit("203.0.113.9", { now: t0 + 3_600_001 });
  const mins = blocked.resetAt ? Math.round((blocked.resetAt - (t0 + 5 * 60_000)) / 60_000) : -1;
  console.log(`  t+5min → ${blocked.mode} (${blocked.reason}), resets in ${mins} min`);
  console.log(`  t+1h   → ${recovered.mode} (${recovered.reason})`);
  console.log(`  limits echoed to the UI: ${JSON.stringify(blocked.limits)}`);
  assert("still limited five minutes later", blocked.mode === "mock");
  assert("reset clock is inside the hour", mins > 0 && mins <= 60, `${mins} min`);
  assert("recovered after the hour", recovered.mode === "real");
  assert("free-tier figures are echoed for display", blocked.limits.freeTierRpd === FREE_TIER.rpd);

  header("10. Client IP extraction");
  assert(
    "uses the left-most forwarded address",
    clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })) === "203.0.113.7",
  );
  assert("falls back to x-real-ip", clientIp(new Headers({ "x-real-ip": "198.51.100.9" })) === "198.51.100.9");

  __setStoreForTests(null);
  await __resetRateLimit();
  void memoryStore;

  console.log("\n" + "=".repeat(94));
  console.log(failures === 0 ? "ALL GUARDRAIL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
  console.log("=".repeat(94));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("GUARDRAIL RUN FAILED:", e);
  process.exit(1);
});
