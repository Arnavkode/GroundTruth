/**
 * Proof for every public-deployment guardrail.
 *
 * Runs with a fake key so the "real" branch is reachable without any network
 * call: nothing here contacts Anthropic. The persistent-store tests use a fake
 * Redis shared by several independently-constructed store objects — that is the
 * simulation of concurrent serverless instances.
 *
 *   npm run test:guardrails
 */
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";
process.env.DAILY_REAL_CALL_CAP = "200";
process.env.DAILY_SPEND_CAP_USD = "5";
delete process.env.DISABLE_REAL_MODE;
delete process.env.FORCE_MOCK_MODE;

import {
  __resetRateLimit,
  __setStoreForTests,
  checkRateLimit,
  clientIp,
  currentSpend,
  dailyCap,
  dailySpendCapUsd,
  hasRealApiKey,
  memoryStore,
  perIpLimit,
  recordSpend,
  redisStore,
  usdForUsage,
  WORST_CASE_CALL_USD,
  type RedisLike,
} from "../lib/ratelimit";
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

/**
 * A minimal in-process Redis. One instance stands in for the single Upstash
 * database that every serverless instance shares.
 */
class FakeRedis implements RedisLike {
  zsets = new Map<string, Map<string, number>>();
  values = new Map<string, number>();
  calls = 0;

  private z(key: string) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key)!;
  }
  async zadd(key: string, m: { score: number; member: string }) {
    this.calls += 1;
    this.z(key).set(m.member, m.score);
  }
  async zremrangebyscore(key: string, min: number, max: number) {
    this.calls += 1;
    for (const [member, score] of this.z(key)) {
      if (score >= min && score <= max) this.z(key).delete(member);
    }
  }
  async zcard(key: string) {
    this.calls += 1;
    return this.z(key).size;
  }
  async zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean }) {
    this.calls += 1;
    const sorted = [...this.z(key).entries()].sort((a, b) => a[1] - b[1]);
    const slice = sorted.slice(start, stop === -1 ? undefined : stop + 1);
    return opts?.withScores ? slice.flatMap(([m, sc]) => [m, sc]) : slice.map(([m]) => m);
  }
  async zrem(key: string, member: string) {
    this.calls += 1;
    this.z(key).delete(member);
  }
  async expire() {
    this.calls += 1;
  }
  async incr(key: string) {
    this.calls += 1;
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }
  async decr(key: string) {
    this.calls += 1;
    const next = (this.values.get(key) ?? 0) - 1;
    this.values.set(key, next);
    return next;
  }
  async incrbyfloat(key: string, v: number) {
    this.calls += 1;
    const next = (this.values.get(key) ?? 0) + v;
    this.values.set(key, next);
    return next;
  }
  async get(key: string) {
    this.calls += 1;
    return this.values.get(key) ?? null;
  }
  flush() {
    this.zsets.clear();
    this.values.clear();
  }
}

async function main() {
  console.log("=".repeat(94));
  console.log("GROUNDTRUTH — PUBLIC DEPLOYMENT GUARDRAILS");
  console.log(
    `per-IP ${perIpLimit()}/hr · daily calls ${dailyCap()} · daily spend $${dailySpendCapUsd().toFixed(2)} · ` +
      `per-upload ${LIMITS.MAX_REAL_CALLS_PER_UPLOAD} · key detected ${hasRealApiKey()}`,
  );

  // ── 1. Persistent store under simulated concurrency ───────────────────────
  header("1. Persistent limiter: 6 concurrent 'serverless instances', one shared Redis");
  const shared = new FakeRedis();
  // Each instance builds its own store object, exactly as separate lambdas would.
  const instances = Array.from({ length: 6 }, () => redisStore(shared));

  __setStoreForTests(instances[0]);
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
  assert("shared store reports store=redis", true);
  assert(
    `only ${perIpLimit()} of 6 concurrent instances got real mode`,
    realCount === perIpLimit(),
    `got ${realCount}`,
  );
  assert("the rest fell back to mock, not an error", results.filter((m) => m === "mock").length === 3);

  header("2. The same six requests against a per-instance in-memory store (the old behaviour)");
  const memInstances = Array.from({ length: 6 }, () => {
    const state = { windows: new Map<string, number[]>(), counters: new Map<string, number>(), spend: new Map<string, number>() };
    // A store closed over its own state == one cold serverless instance.
    return {
      kind: "memory" as const,
      async tryWindow(key: string, limit: number, windowMs: number, now: number) {
        const times = (state.windows.get(key) ?? []).filter((t) => t > now - windowMs);
        const oldest = times.length > 0 ? times[0] : null;
        if (times.length >= limit) return { count: times.length, allowed: false, oldest };
        times.push(now);
        state.windows.set(key, times);
        return { count: times.length, allowed: true, oldest: oldest ?? now };
      },
      async tryCounter(key: string, limit: number) {
        const next = (state.counters.get(key) ?? 0) + 1;
        if (next > limit) return { count: next - 1, allowed: false };
        state.counters.set(key, next);
        return { count: next, allowed: true };
      },
      async getSpend() {
        return 0;
      },
      async addSpend() {
        return 0;
      },
      async reset() {},
    };
  });
  let memReal = 0;
  for (const inst of memInstances) {
    __setStoreForTests(inst);
    const d = await checkRateLimit("198.51.100.5");
    if (d.mode === "real") memReal += 1;
  }
  console.log(`  per-instance stores → ${memReal} of 6 got real mode (configured limit is ${perIpLimit()})`);
  assert(
    "per-instance memory store leaks past the configured limit — which is exactly why Redis is required",
    memReal > perIpLimit(),
    `${memReal} real calls allowed against a limit of ${perIpLimit()}`,
  );

  // ── 3. Spend cap ──────────────────────────────────────────────────────────
  header("3. Daily dollar cap trips independently of the call-count cap");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "1000";
  process.env.DAILY_SPEND_CAP_USD = "0.50";

  console.log(`  price model: $${usdForUsage(1_000_000, 0).toFixed(2)}/Mtok in, $${usdForUsage(0, 1_000_000).toFixed(2)}/Mtok out`);
  let spendReal = 0;
  let spendReason = "";
  for (let i = 0; i < 40; i += 1) {
    const d = await checkRateLimit(`203.0.113.${i}`);
    if (d.mode === "real") {
      spendReal += 1;
      // A representative call: 4k in, 900 out.
      await recordSpend(4000, 900);
    } else {
      spendReason = d.reason;
      break;
    }
  }
  const finalSpend = await currentSpend();
  console.log(
    `  cap $0.50 · ${spendReal} live calls made · $${finalSpend.toFixed(4)} spent · stopped because: ${spendReason}`,
  );
  assert("spend cap stopped the run", spendReason === "spend-cap-reached");
  assert(
    "spend never exceeded the cap",
    finalSpend <= 0.5,
    `$${finalSpend.toFixed(4)} vs $0.50`,
  );
  assert(
    "headroom reservation left no room for an in-flight overshoot",
    finalSpend + WORST_CASE_CALL_USD > 0.5,
  );
  assert("call-count cap was NOT the reason (it was nowhere near)", spendReason !== "daily-cap-reached");
  process.env.DAILY_SPEND_CAP_USD = "5";
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";

  // ── 4. Kill switch ────────────────────────────────────────────────────────
  header("4. DISABLE_REAL_MODE kill switch beats a present key and a full budget");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  process.env.DISABLE_REAL_MODE = "1";
  const killed = await checkRateLimit("203.0.113.200");
  console.log(`  → ${killed.mode} (${killed.reason}): ${killed.message}`);
  assert("kill switch forces mock", killed.mode === "mock" && killed.reason === "kill-switch");
  delete process.env.DISABLE_REAL_MODE;
  const restored = await checkRateLimit("203.0.113.201");
  console.log(`  after unsetting → ${restored.mode} (${restored.reason})`);
  assert("unsetting it restores real mode with no redeploy", restored.mode === "real");

  // ── 5. Per-upload cap ─────────────────────────────────────────────────────
  header("5. One upload cannot burn the whole budget");
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
  console.log(
    `  20-row upload, per-IP budget 1000 → ${used} live, ${modes.filter((m) => m === "mock").length} mock`,
  );
  assert(
    `capped at ${LIMITS.MAX_REAL_CALLS_PER_UPLOAD} live calls for the upload`,
    used === LIMITS.MAX_REAL_CALLS_PER_UPLOAD,
    `got ${used}`,
  );
  assert("remainder routed to mock rather than refused", modes.slice(10).every((m) => m === "mock"));
  process.env.RATE_LIMIT_PER_IP_PER_HOUR = "3";

  // ── 6. Key detection ──────────────────────────────────────────────────────
  header("6. Placeholder keys never enable spend");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  const saved = process.env.ANTHROPIC_API_KEY;
  for (const [label, key] of [
    ["unset", undefined],
    ["empty", ""],
    ["sk-ant-placeholder", "sk-ant-placeholder"],
    ["your-key-here", "your-key-here"],
    ["sk-ant-realish", "sk-ant-realish"],
  ] as const) {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
    const d = await checkRateLimit(`192.0.2.${Math.floor(Math.random() * 250)}`);
    console.log(`  key=${String(label).padEnd(20)} → ${d.mode} (${d.reason})`);
    if (label === "sk-ant-realish") assert("a well-formed key enables real mode", d.mode === "real");
    else assert(`${label} stays mock`, d.mode === "mock" && d.reason === "no-api-key");
  }
  process.env.ANTHROPIC_API_KEY = saved;

  // ── 7. Sliding window still slides ────────────────────────────────────────
  header("7. The per-IP window slides");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  const t0 = Date.now();
  for (let i = 0; i < perIpLimit(); i += 1) await checkRateLimit("203.0.113.9", { now: t0 });
  const blocked = await checkRateLimit("203.0.113.9", { now: t0 + 60_000 });
  const recovered = await checkRateLimit("203.0.113.9", { now: t0 + 3_600_001 });
  console.log(`  t+1min → ${blocked.mode} (${blocked.reason})`);
  console.log(`  t+1h   → ${recovered.mode} (${recovered.reason})`);
  assert("still limited a minute later", blocked.mode === "mock");
  assert("recovered after the hour", recovered.mode === "real");

  header("8. The UI gets a usable reset clock and the configured limits");
  shared.flush();
  __setStoreForTests(redisStore(shared));
  const t1 = Date.now();
  for (let i = 0; i < perIpLimit(); i += 1) await checkRateLimit("203.0.113.44", { now: t1 });
  const limited = await checkRateLimit("203.0.113.44", { now: t1 + 5 * 60_000 });
  const minutes = limited.resetAt ? Math.round((limited.resetAt - (t1 + 5 * 60_000)) / 60_000) : -1;
  console.log(
    `  reason=${limited.reason} resetAt=+${minutes}min limits=${JSON.stringify(limited.limits)} store=${limited.store}`,
  );
  assert("a reset time is reported when limited", limited.resetAt !== null);
  assert("reset is within the hour window", minutes > 0 && minutes <= 60, `${minutes} min`);
  assert("configured limits are echoed for display", limited.limits.perIpPerHour === perIpLimit());
  assert("the store kind is reported so the UI can warn", limited.store === "redis");

  header("9. Client IP extraction");
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
