/**
 * Screenshots of the states that are hard to reach by hand: the rate-limit
 * notice, and both themes. Assumes a server is already running.
 */
import { chromium } from "playwright";

const B = process.env.BASE_URL ?? "http://localhost:3000";

(async () => {
  const br = await chromium.launch({ channel: "msedge" });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();

  const setTheme = async (theme: "light" | "dark") => {
    await p.evaluate((t) => {
      localStorage.setItem("gt-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
  };

  for (const theme of ["light", "dark"] as const) {
    await p.goto(`${B}/`, { waitUntil: "networkidle" });
    await setTheme(theme);
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForTimeout(1600);
    await p.screenshot({ path: `shots/home-${theme}.png`, fullPage: true });

    await p.goto(`${B}/reconcile`, { waitUntil: "networkidle" });
    await setTheme(theme);
    await p.reload({ waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Run reconciliation/i }).click();
    await p.waitForSelector("text=/could not be resolved automatically/", { timeout: 180_000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `shots/reconcile-${theme}.png`, fullPage: false });
    await p.screenshot({ path: `shots/reconcile-${theme}-full.png`, fullPage: true });
  }

  await br.close();
  console.log("state shots done");
})();
