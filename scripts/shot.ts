import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "http://localhost:3000";
(async () => {
  const br = await chromium.launch({ channel: "msedge" });
  for (const [w, h, tag, full] of [[1440, 1000, "desktop", true], [375, 812, "mobile", false]] as const) {
    const ctx = await br.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    for (const [path, name] of [["/", "home"], ["/reconcile", "reconcile"], ["/investigate", "investigate"]] as const) {
      await p.goto(B + path, { waitUntil: "networkidle" });
      await p.waitForTimeout(2000);
      await p.screenshot({ path: `shots/${name}-${tag}.png`, fullPage: full });
    }
    await ctx.close();
  }
  await br.close();
  console.log("shots done");
})();
