import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "http://localhost:3000";
(async () => {
  const br = await chromium.launch({ channel: "msedge" });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  await p.goto(`${B}/how-it-works`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: "shots/how-it-works.png", fullPage: true });
  await p.goto(`${B}/reconcile`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /Run reconciliation/i }).click();
  await p.waitForSelector("text=/could not be resolved automatically/", { timeout: 180000 });
  await p.getByRole("button", { name: /TXN-1012/ }).first().click();
  await p.waitForTimeout(900);
  await p.screenshot({ path: "shots/scoring-detail.png", fullPage: true });
  await br.close();
  console.log("math shots done");
})();
