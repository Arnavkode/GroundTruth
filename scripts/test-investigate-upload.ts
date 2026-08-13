/**
 * Investigate on uploaded evidence, driven through the actual UI.
 *
 * The API path was already there — `POST /api/investigate` has always accepted
 * a dataset — but the page only ever read the bundled fixtures, so "bring your
 * own data" was quietly true of Reconcile and not of Investigate. This drives
 * the browser the way a person would: upload files, pick the dispute that came
 * out of them, and check that the rebuttal is built from the uploaded records
 * rather than from anything bundled.
 *
 *   npx tsx scripts/test-investigate-upload.ts     (needs `npm run start`)
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;

function assert(label: string, cond: boolean, detail = "") {
  if (!cond) failures += 1;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const BANK = `id,postedAt,descriptor,amountCents,direction,memoRef
BNK-U1,2026-06-03,ACME STLMT TXN-U1,9700,credit,TXN-U1`;

const SETTLE = `settlementId,transactionRef,orderId,type,occurredAt,grossCents,feeCents,currency,status
SET-U1,TXN-U1,ORD-U1,payment,2026-06-01T10:00:00Z,10000,300,USD,settled`;

const ORDERS = `orderId,placedAt,customerName,customerEmail,totalCents,currency,shippingAddress,billingAddress,avsResult,cvvResult,ip,deviceId
ORD-U1,2026-06-01T09:55:00Z,Dana Whitfield,dana@example.test,10000,USD,14 Alder Row Bristol,14 Alder Row Bristol,Y,M,10.0.0.5,dev-u1`;

const SHIP = `trackingNumber,orderId,carrier,shippedAt,deliveredAt,deliveryAddress,signature,status
9400111202008891ABCD,ORD-U1,USPS,2026-06-02T12:00:00Z,2026-06-05T15:22:00Z,14 Alder Row Bristol,D.WHITFIELD,delivered`;

const DISPUTES = `disputeId,transactionRef,orderId,reasonCode,reasonText,network,amountCents,filedAt,respondBy,cardholderStatement,label,blurb
DSP-U1,TXN-U1,ORD-U1,13.1,Merchandise not received,Visa,10000,2026-06-20T09:00:00Z,2026-07-04T09:00:00Z,I never received the parcel,Uploaded non-receipt claim,Filed three weeks after a signed delivery`;

(async () => {
  console.log("=".repeat(92));
  console.log("INVESTIGATE ON UPLOADED EVIDENCE — driven through the UI");
  console.log("=".repeat(92));

  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/investigate`, { waitUntil: "networkidle" });

  // Baseline: the fixture disputes are what an untouched page offers.
  const fixtureCards = await page.locator("button[aria-pressed]").count();
  console.log(`  fixture disputes on load: ${fixtureCards}`);
  assert("the page still opens on the bundled disputes", fixtureCards === 4, `${fixtureCards}`);

  const file = (name: string, body: string) => ({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(body, "utf8"),
  });

  for (const [field, name, body] of [
    ["bank", "bank.csv", BANK],
    ["settlement", "settlement.csv", SETTLE],
    ["orders", "orders.csv", ORDERS],
    ["shipments", "shipments.csv", SHIP],
    ["disputes", "disputes.csv", DISPUTES],
  ] as const) {
    await page.locator(`input[name="${field}"]`).setInputFiles(file(name, body));
  }

  await page.getByRole("button", { name: /validate|upload|load/i }).first().click();
  await page.waitForSelector("text=/Disputes in your upload/i", { timeout: 20_000 });

  const heading = (await page.locator("text=/Disputes in your upload/i").first().textContent()) ?? "";
  console.log(`  heading after upload: "${heading.trim()}"`);
  assert("the dispute list switches to the upload", /—\s*1/.test(heading), heading.trim());

  const uploadedCard = page.locator("button[aria-pressed]", {
    hasText: "DSP-U1",
  });
  assert("the uploaded dispute is listed", (await uploadedCard.count()) === 1);
  assert(
    "the bundled disputes are no longer offered",
    (await page.locator("button[aria-pressed]", { hasText: "DSP-1009" }).count()) === 0,
  );

  await uploadedCard.first().click();
  // Wait for the *rebuttal*, not the resolution — the stream is paced, and an
  // earlier version of this test asserted mid-run and reported failures that
  // were really just impatience.
  await page.waitForSelector("text=/Win likelihood/i", { timeout: 90_000 });

  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  console.log(`  resolved page mentions TXN-U1: ${body.includes("TXN-U1")}`);
  assert("the uploaded transaction is what got resolved", body.includes("TXN-U1"));
  assert("no bundled transaction leaked into the run", !body.includes("TXN-1009"));
  assert(
    "a rebuttal was drafted from the uploaded records",
    /D\.?WHITFIELD|Alder Row|delivered/i.test(body),
    "letter cites the uploaded shipment",
  );
  assert("a win likelihood is shown", /%/.test(body));

  mkdirSync("shots", { recursive: true });
  writeFileSync("shots/investigate-upload.png", await page.screenshot({ fullPage: true }));
  console.log("  screenshot: shots/investigate-upload.png");

  // Horizontal overflow is the failure mode this layout has had before.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert("no horizontal scroll after the uploaded run", overflow <= 1, `${overflow}px`);

  await browser.close();
  console.log("\n" + "=".repeat(92));
  console.log(failures === 0 ? "ALL INVESTIGATE-UPLOAD ASSERTIONS PASSED" : `${failures} FAILED`);
  console.log("=".repeat(92));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("RUN FAILED:", e?.message ?? e);
  process.exit(1);
});
