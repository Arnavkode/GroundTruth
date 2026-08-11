/**
 * End-to-end exercise of both workflows over real HTTP against a running
 * server, consuming the SSE streams exactly as the browser does.
 *
 *   npm run build && npm run start   # in one shell
 *   npm run test:e2e                 # in another
 *
 * Override the target with BASE_URL. Output goes into BUILD_LOG.md.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;

function assert(label: string, cond: boolean, detail = "") {
  if (!cond) failures += 1;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function header(t: string) {
  console.log("\n" + "-".repeat(92));
  console.log(t);
  console.log("-".repeat(92));
}

/** Consume an SSE endpoint to completion and return every parsed event. */
async function consume(path: string): Promise<{ status: number; events: any[] }> {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-forwarded-for": "203.0.113.200" } });
  if (!res.body) return { status: res.status, events: [] };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: any[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return { status: res.status, events };
}

async function main() {
  console.log("=".repeat(92));
  console.log(`GROUNDTRUTH — END-TO-END TEST against ${BASE}`);

  // ── Page loads ────────────────────────────────────────────────────────────
  header("0. Pages return 200 and render");
  for (const [path, needle] of [
    ["/", "What actually happened"],
    ["/reconcile", "Bank statement against settlement report"],
    ["/investigate", "One disputed transaction"],
  ] as const) {
    const res = await fetch(`${BASE}${path}`);
    const html = await res.text();
    console.log(`  GET ${path.padEnd(14)} → ${res.status}, ${html.length} bytes`);
    assert(`${path} returns 200`, res.status === 200);
    assert(`${path} renders its heading`, html.includes(needle));
  }

  // ── Reconcile ─────────────────────────────────────────────────────────────
  header("1. Reconcile mode — GET /api/reconcile (SSE)");
  const rec = await consume("/api/reconcile?paced=0");
  assert("stream returns 200", rec.status === 200);

  const meta = rec.events.find((e) => e.type === "meta");
  const resolutions = rec.events.filter((e) => e.type === "resolution").map((e) => e.resolution);
  const summary = rec.events.find((e) => e.type === "summary");
  const done = rec.events.some((e) => e.type === "done");

  console.log(`  events received: ${rec.events.length}`);
  console.log(`  mode: ${meta?.mode} (${meta?.message})`);
  console.log(`  resolutions: ${resolutions.length}`);
  console.log(
    `  buckets: matched ${summary?.matched}, explained ${summary?.explained}, flagged ${summary?.flagged}, total ${summary?.total}`,
  );

  assert("meta announces mock mode (no real key present)", meta?.mode === "mock");
  assert("stream terminated cleanly", done);
  assert("no error events", !rec.events.some((e) => e.type === "error"));
  assert("16 units resolved", resolutions.length === 16, `got ${resolutions.length}`);
  assert("bucket counts sum to the total", summary && summary.matched + summary.explained + summary.flagged === summary.total);
  assert("all three buckets are populated", summary?.matched > 0 && summary?.explained > 0 && summary?.flagged > 0);
  assert(
    "source-by-source trace was streamed, not just the answer",
    rec.events.filter((e) => e.type === "source").length === 16 * 5,
  );
  assert("every resolution carries at least one citation", resolutions.every((r) => r.citations.length > 0));
  assert("every resolution carries a non-empty explanation", resolutions.every((r) => r.explanation.length > 80));
  assert(
    "no resolution claims more than 97% confidence",
    resolutions.every((r) => r.confidence <= 0.97),
  );

  console.log("\n  Per-unit verdicts:");
  for (const r of resolutions) {
    console.log(
      `    ${r.transactionRef.padEnd(10)} ${r.status.padEnd(21)} ${String(Math.round(r.confidence * 100)).padStart(3)}%   ${r.headline.slice(0, 74)}`,
    );
  }

  // The honest cases must be flagged, not force-resolved.
  header("2. The genuinely ambiguous cases are flagged, not forced");
  for (const ref of ["TXN-1007A", "TXN-1007B", "BNK-009"]) {
    const r = resolutions.find((x) => x.transactionRef === ref);
    console.log(`  ${ref}: ${r?.status} @ ${Math.round((r?.confidence ?? 0) * 100)}%`);
    assert(`${ref} is flagged`, r?.status === "flagged");
    assert(`${ref} confidence is below the 60% resolve threshold`, (r?.confidence ?? 1) < 0.6);
  }
  const dup = resolutions.find((r) => r.transactionRef === "TXN-1006");
  console.log(`  TXN-1006 (duplicate): ${dup?.status} @ ${Math.round((dup?.confidence ?? 0) * 100)}%`);
  assert("duplicate capture is flagged", dup?.status === "flagged");
  assert("duplicate finding is high-confidence", (dup?.confidence ?? 0) > 0.85);
  assert(
    "duplicate is caught despite the bank reconciling to zero",
    dup?.amounts.deltaCents === 0,
  );

  // ── Investigate ───────────────────────────────────────────────────────────
  header("3. Investigate mode — GET /api/investigate (SSE), all four disputes");
  for (const id of ["DSP-1009", "DSP-1010", "DSP-1011", "DSP-1006"]) {
    const inv = await consume(`/api/investigate?dispute=${id}&paced=0`);
    const res = inv.events.find((e) => e.type === "resolution")?.resolution;
    const reb = inv.events.find((e) => e.type === "rebuttal");
    const ok = inv.events.some((e) => e.type === "done");

    console.log(
      `\n  ${id} → ${res?.status} @ ${Math.round((res?.confidence ?? 0) * 100)}%  |  win ${Math.round((reb?.rebuttal.winLikelihood ?? 0) * 100)}%  |  ${reb?.rebuttal.recommendation}`,
    );
    console.log(`    timeline events: ${res?.timeline.length}, checks: ${res?.checks.length}`);
    console.log(`    letter: ${reb?.rebuttal.letter.length} chars, factors: ${reb?.factors.length}`);
    console.log(`    ${reb?.rebuttal.recommendationNote.slice(0, 150)}`);

    assert(`${id} stream completed`, ok);
    assert(`${id} produced a resolution`, Boolean(res));
    assert(`${id} produced a rebuttal`, Boolean(reb));
    assert(`${id} timeline is assembled from multiple sources`, (res?.timeline.length ?? 0) >= 4);
    assert(`${id} letter is substantive`, (reb?.rebuttal.letter.length ?? 0) > 600);
    assert(`${id} every rebuttal factor cites a record`, reb?.factors.every((f: any) => f.citation?.ref));
    assert(
      `${id} win likelihood is within the honest band`,
      (reb?.rebuttal.winLikelihood ?? 0) >= 0.05 && (reb?.rebuttal.winLikelihood ?? 1) <= 0.88,
    );
  }

  header("4. The resolver recommends against fighting the disputes it should lose");
  const weak = await consume("/api/investigate?dispute=DSP-1010&paced=0");
  const dupCase = await consume("/api/investigate?dispute=DSP-1006&paced=0");
  const weakReb = weak.events.find((e) => e.type === "rebuttal")?.rebuttal;
  const dupReb = dupCase.events.find((e) => e.type === "rebuttal")?.rebuttal;
  console.log(`  DSP-1010 → ${weakReb?.recommendation} at ${Math.round(weakReb.winLikelihood * 100)}%`);
  console.log(`  DSP-1006 → ${dupReb?.recommendation} at ${Math.round(dupReb.winLikelihood * 100)}%`);
  assert("wrong-ZIP delivery case recommends accepting liability", weakReb?.recommendation === "accept-liability");
  assert("duplicate-charge case recommends accepting liability", dupReb?.recommendation === "accept-liability");
  const strong = await consume("/api/investigate?dispute=DSP-1009&paced=0");
  const strongReb = strong.events.find((e) => e.type === "rebuttal")?.rebuttal;
  console.log(`  DSP-1009 → ${strongReb?.recommendation} at ${Math.round(strongReb.winLikelihood * 100)}%`);
  assert("strong-evidence case recommends representing", strongReb?.recommendation === "represent");

  header("5. Unknown dispute IDs fail cleanly");
  const bad = await consume("/api/investigate?dispute=DSP-NOPE&paced=0");
  const err = bad.events.find((e) => e.type === "error");
  console.log(`  → ${err?.message}`);
  assert("returns a structured error event", Boolean(err));
  assert("still terminates the stream", bad.events.some((e) => e.type === "done"));

  console.log("\n" + "=".repeat(92));
  console.log(failures === 0 ? "ALL END-TO-END ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
  console.log("=".repeat(92));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nE2E RUN FAILED:", e);
  process.exit(1);
});
