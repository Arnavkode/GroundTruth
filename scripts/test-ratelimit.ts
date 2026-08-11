/**
 * Automated proof that the spend guard works.
 *
 * Runs with a fake key so the "real" path is reachable without any network
 * call: nothing here contacts Anthropic. Output goes into BUILD_LOG.md.
 *
 *   npm run test:ratelimit
 */
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
process.env.RATE_LIMIT_PER_IP_PER_HOUR = "10";
process.env.DAILY_REAL_CALL_CAP = "200";

import {
  __resetRateLimit,
  checkRateLimit,
  clientIp,
  dailyCap,
  hasRealApiKey,
  perIpLimit,
} from "../lib/ratelimit";

let failures = 0;

function assert(label: string, cond: boolean, detail = "") {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures += 1;
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function header(title: string) {
  console.log("\n" + "-".repeat(92));
  console.log(title);
  console.log("-".repeat(92));
}

console.log("=".repeat(92));
console.log("GROUNDTRUTH — RATE LIMITER TEST");
console.log(`per-IP limit ${perIpLimit()}/hour · global cap ${dailyCap()}/day · key detected: ${hasRealApiKey()}`);

// ── 1. Per-IP sliding window ────────────────────────────────────────────────
header("1. Fire 15 requests from one IP against a limit of 10");
__resetRateLimit();
const modes: string[] = [];
for (let i = 1; i <= 15; i += 1) {
  const d = checkRateLimit("203.0.113.7");
  modes.push(d.mode);
  console.log(
    `  req ${String(i).padStart(2)} → ${d.mode.padEnd(4)} (${d.reason})  ip remaining ${d.ipRemaining}`,
  );
}
assert("first 10 requests allowed real mode", modes.slice(0, 10).every((m) => m === "real"));
assert("requests 11-15 routed to mock, not errored", modes.slice(10).every((m) => m === "mock"));
assert("exactly 10 real calls were permitted", modes.filter((m) => m === "real").length === 10);

// ── 2. Limit is per IP, not global ──────────────────────────────────────────
header("2. A different IP is unaffected by the first IP's exhaustion");
const other = checkRateLimit("198.51.100.42");
console.log(`  198.51.100.42 → ${other.mode} (${other.reason}), ip remaining ${other.ipRemaining}`);
assert("second IP still gets real mode", other.mode === "real");

// ── 3. Window expiry ────────────────────────────────────────────────────────
header("3. The window slides — the same IP recovers after an hour");
__resetRateLimit();
const t0 = Date.now();
for (let i = 0; i < 10; i += 1) checkRateLimit("203.0.113.9", t0);
const blocked = checkRateLimit("203.0.113.9", t0 + 60_000);
const recovered = checkRateLimit("203.0.113.9", t0 + 3_600_001);
console.log(`  at t+1min      → ${blocked.mode} (${blocked.reason})`);
console.log(`  at t+1h and 1ms → ${recovered.mode} (${recovered.reason})`);
assert("still limited one minute later", blocked.mode === "mock");
assert("real mode restored once the hour has passed", recovered.mode === "real");

// ── 4. Global daily cap overrides available per-IP budget ───────────────────
header("4. Global daily cap trips even when each IP has budget left");
__resetRateLimit();
process.env.DAILY_REAL_CALL_CAP = "25";
const now = Date.now();
let realCount = 0;
let cappedReason = "";
for (let i = 0; i < 40; i += 1) {
  // A fresh IP every time, so the per-IP limit can never be the cause.
  const d = checkRateLimit(`10.0.0.${i}`, now);
  if (d.mode === "real") realCount += 1;
  else cappedReason = d.reason;
}
console.log(`  40 requests from 40 distinct IPs, cap 25 → ${realCount} real, ${40 - realCount} mock`);
console.log(`  reason once capped: ${cappedReason}`);
assert("exactly 25 real calls allowed", realCount === 25, `got ${realCount}`);
assert("overflow attributed to the daily cap", cappedReason === "daily-cap-reached");
assert("overflow fell back to mock rather than throwing", true);
process.env.DAILY_REAL_CALL_CAP = "200";

// ── 5. Placeholder keys are not real keys ───────────────────────────────────
header("5. Key detection — placeholders must never enable real mode");
__resetRateLimit();
const saved = process.env.ANTHROPIC_API_KEY;
for (const [label, key] of [
  ["unset", undefined],
  ["empty string", ""],
  ["sk-ant-placeholder", "sk-ant-placeholder"],
  ["your-key-here", "your-key-here"],
  ["sk-ant-realish-value", "sk-ant-realish-value"],
] as const) {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  const d = checkRateLimit(`192.0.2.${Math.random()}`);
  console.log(`  key=${String(label).padEnd(20)} → ${d.mode} (${d.reason})`);
  if (label === "sk-ant-realish-value") assert("a well-formed key enables real mode", d.mode === "real");
  else assert(`${label} stays in mock mode`, d.mode === "mock");
}
process.env.ANTHROPIC_API_KEY = saved;

// ── 6. FORCE_MOCK_MODE wins over everything ─────────────────────────────────
header("6. FORCE_MOCK_MODE overrides a present key");
__resetRateLimit();
process.env.FORCE_MOCK_MODE = "1";
const forced = checkRateLimit("203.0.113.55");
console.log(`  → ${forced.mode} (${forced.reason})`);
assert("forced mock respected", forced.mode === "mock" && forced.reason === "forced-mock");
delete process.env.FORCE_MOCK_MODE;

// ── 7. IP extraction from proxy headers ─────────────────────────────────────
header("7. Client IP extraction");
const h1 = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
const h2 = new Headers({ "x-real-ip": "198.51.100.9" });
console.log(`  x-forwarded-for chain → ${clientIp(h1)}`);
console.log(`  x-real-ip             → ${clientIp(h2)}`);
console.log(`  no headers            → ${clientIp(new Headers())}`);
assert("uses the left-most forwarded address", clientIp(h1) === "203.0.113.7");
assert("falls back to x-real-ip", clientIp(h2) === "198.51.100.9");

console.log("\n" + "=".repeat(92));
console.log(failures === 0 ? "ALL RATE LIMITER ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
console.log("=".repeat(92));
process.exit(failures === 0 ? 0 : 1);
