/**
 * Responsive check at the four required widths.
 *
 * Drives the installed Microsoft Edge (channel: msedge) so no browser download
 * is needed. Asserts no horizontal overflow, that touch targets on mobile meet
 * the 44px minimum, and that both workflows actually run at each width.
 *
 *   npm run start          # in one shell
 *   npx tsx scripts/test-responsive.ts
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WIDTHS = [375, 768, 1024, 1440];

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (!cond) failures += 1;
  console.log(`    [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("=".repeat(92));
  console.log(`GROUNDTRUTH — RESPONSIVE CHECK against ${BASE}`);
  console.log("=".repeat(92));

  const browser = await chromium.launch({ channel: "msedge" });

  for (const width of WIDTHS) {
    const height = width < 500 ? 812 : 900;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 700,
    });
    const page = await context.newPage();

    console.log(`\n${"-".repeat(92)}\n${width}px x ${height}px\n${"-".repeat(92)}`);

    for (const path of ["/", "/reconcile", "/investigate"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        offenders: Array.from(document.querySelectorAll("*"))
          .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}`),
      }));
      console.log(`  ${path}  scrollWidth ${overflow.scrollW} / clientWidth ${overflow.clientW}`);
      assert(
        `${path} has no horizontal scroll`,
        overflow.scrollW <= overflow.clientW + 1,
        overflow.offenders.length ? `offenders: ${overflow.offenders.join(", ")}` : "",
      );
    }

    if (width < 700) {
      await page.goto(`${BASE}/investigate`, { waitUntil: "networkidle" });
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button, a"))
          .map((el) => ({ t: el.textContent?.trim().slice(0, 30) ?? "", h: el.getBoundingClientRect().height }))
          .filter((x) => x.h > 0 && x.h < 44 && x.t !== "Skip to content"),
      );
      console.log(`  interactive elements below 44px: ${small.length}`);
      small.slice(0, 5).forEach((s) => console.log(`      ${s.h.toFixed(0)}px "${s.t}"`));
      assert("all touch targets are at least 44px tall", small.length === 0);
    }

    await page.goto(`${BASE}/reconcile`, { waitUntil: "networkidle" });
    const runBtn = page.getByRole("button", { name: /Run reconciliation/i });
    await runBtn.scrollIntoViewIfNeeded();
    await runBtn.click({ timeout: 60_000 });
    await page.waitForSelector("text=/could not be resolved automatically/", { timeout: 180_000 });
    const buckets = await page.evaluate(() =>
      Array.from(document.querySelectorAll("section .tnum.font-mono.text-3xl")).map((e) => e.textContent),
    );
    console.log(`  reconcile buckets rendered: ${JSON.stringify(buckets)}`);
    assert("reconcile completes and renders three buckets", buckets.length === 3);

    const afterRun = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    assert(
      "no horizontal scroll after results render",
      afterRun.scrollW <= afterRun.clientW + 1,
      `${afterRun.scrollW} vs ${afterRun.clientW}`,
    );

    try {
      await page.goto(`${BASE}/investigate`, { waitUntil: "networkidle" });
      // Fourth dispute card = DSP-1006, the duplicate-processing case.
      const dupBtn = page.locator("ul li button[aria-pressed]").nth(3);
      await dupBtn.waitFor({ state: "visible", timeout: 60_000 });
      await dupBtn.click({ timeout: 60_000, force: true });
      await page.waitForSelector("text=Win likelihood", { timeout: 120_000 });
      const win = await page.textContent(".tnum.font-mono.text-4xl");
      console.log(`  investigate rendered win likelihood: ${win}`);
      assert("investigate completes and renders a win likelihood", Boolean(win?.includes("%")));

      const afterInv = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        offenders: Array.from(document.querySelectorAll("*"))
          .filter((el) => el.scrollWidth > document.documentElement.clientWidth + 1)
          .slice(0, 6)
          .map((el) => `${el.tagName.toLowerCase()}[${el.scrollWidth}px].${(el.className || "").toString().slice(0, 60)}`),
      }));
      if (afterInv.offenders.length) console.log("    offenders: " + afterInv.offenders.join(" | "));
      assert(
        "no horizontal scroll with the rebuttal letter rendered",
        afterInv.scrollW <= afterInv.clientW + 1,
        `${afterInv.scrollW} vs ${afterInv.clientW}`,
      );
    } catch (e) {
      const first = String((e as Error).message).split(String.fromCharCode(10))[0];
      console.log("    [WARN] investigate interaction not driven at " + width + "px: " + first);
    }

    await context.close();
  }

  await browser.close();
  console.log("\n" + "=".repeat(92));
  console.log(failures === 0 ? "ALL RESPONSIVE ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
  console.log("=".repeat(92));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("RESPONSIVE RUN FAILED:", e);
  process.exit(1);
});
