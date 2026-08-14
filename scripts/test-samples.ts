/**
 * The sample data a visitor can actually get hold of.
 *
 * Two routes out of "I have no file in the right shape": download the six CSVs,
 * or load them in one click. Both must work, and the one-click path must go
 * through the real ingestion endpoint rather than a shortcut that skips
 * validation — otherwise it would demonstrate something the upload path does
 * not actually do.
 *
 *   npx tsx scripts/test-samples.ts     (needs `npm run start`)
 */
import { chromium } from "playwright";
import { readdirSync } from "fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const FILES = ["bank.csv", "settlement.csv", "orders.csv", "shipments.csv", "chats.csv", "disputes.csv"];

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (!cond) failures += 1;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  console.log("=".repeat(92));
  console.log("SAMPLE DATA — downloadable, and loadable in one click");
  console.log("=".repeat(92));

  // ── 1. Every file is actually served ──────────────────────────────────────
  for (const f of FILES) {
    const res = await fetch(`${BASE}/samples/${f}`);
    const body = await res.text();
    const rows = body.trim().split("\n").length - 1;
    console.log(`  GET /samples/${f.padEnd(16)} ${res.status}  ${rows} data rows`);
    assert(`${f} is served`, res.status === 200 && rows > 0, `${res.status}, ${rows} rows`);
  }

  // The repo copy and the served copy must be the same files, not two that drift.
  const onDisk = readdirSync("public/samples").filter((f) => f.endsWith(".csv")).sort();
  assert("the served files are the repo's only copy", onDisk.join() === [...FILES].sort().join(), onDisk.join());

  // ── 2. One click loads them through the real endpoint ─────────────────────
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  const ingestCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/ingest")) ingestCalls.push(r.method());
  });

  await page.goto(`${BASE}/reconcile`, { waitUntil: "networkidle" });

  const links = await page.locator('a[download][href^="/samples/"]').count();
  console.log(`  download links on the page: ${links}`);
  assert("all six files are offered as downloads", links === FILES.length, `${links}`);

  await page.getByRole("button", { name: "Use the sample data", exact: true }).click();
  await page.waitForSelector("text=/Resolve these \\d+ rows/i", { timeout: 30_000 });

  assert("it went through POST /api/ingest, not a bypass", ingestCalls.includes("POST"), ingestCalls.join(","));

  const cta = await page.getByRole("button", { name: /Resolve these \d+ rows/i }).textContent();
  console.log(`  after loading: "${cta?.trim()}"`);
  assert("the full 32 rows were accepted", /32/.test(cta ?? ""), cta ?? "");

  // ── 3. And the run itself is the interesting one ──────────────────────────
  await page.getByRole("button", { name: /Resolve these \d+ rows/i }).click();
  await page.waitForSelector("text=/Run again/", { timeout: 180_000 });
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");

  // The fee schedule must have been carried across, or every row flags on fees
  // and the samples look broken through no fault of the data.
  assert("no spurious fee flags — the schedule was applied", !/Fee schedule:.*published schedule/i.test(body));
  assert("the duplicate capture is found", /Duplicate capture/i.test(body));
  assert("the orphan bank debit is flagged", /BNK-2099/.test(body));
  assert("a refund in flight is explained", /Refund in flight/i.test(body));

  await browser.close();
  console.log("\n" + "=".repeat(92));
  console.log(failures === 0 ? "ALL SAMPLE-DATA ASSERTIONS PASSED" : `${failures} FAILED`);
  console.log("=".repeat(92));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("RUN FAILED:", e?.message ?? e);
  process.exit(1);
});
