import { usd } from "../fixtures";
import { sigmoid } from "./checks";
import type { Citation, DisputeRecord, Rebuttal, Resolution } from "./types";

/**
 * Second-stage agent: turns a resolved transaction into a representment
 * decision. Win likelihood is computed from weighted evidence factors, not
 * asserted — the letter is written from the same factors, so every claim in it
 * traces back to a record the resolver actually read.
 */

const MIN_WIN = 0.05;
const MAX_WIN = 0.88;

/** Network-published merchant win rates by reason code, as starting odds. */
const REASON_BASELINE: Record<string, number> = {
  "13.1": 0.35, // not received — winnable with delivery proof
  "10.4": 0.25, // card-absent fraud — hostile to merchants
  "12.6.1": 0.1, // duplicate processing — near-unwinnable if true
};

interface Factor {
  label: string;
  weight: number;
  citation: Citation;
}

interface CannedRebuttal {
  factors: Factor[];
  letter: (winPct: number) => string;
  note: (winPct: number) => string;
}

const REBUTTALS: Record<string, CannedRebuttal> = {
  "DSP-1009": {
    factors: [
      {
        label: "Cardholder acknowledged receipt in writing, one day after delivery",
        weight: 1.7,
        citation: {
          source: "chat",
          ref: "CHT-1009",
          detail: '"got the rug yesterday but the colour is not what I expected" — 2026-02-23',
        },
      },
      {
        label: "Carrier delivered to the order address",
        weight: 1.2,
        citation: {
          source: "shipment",
          ref: "7712 8841 0093",
          detail: "FedEx delivered 2026-02-22 15:41 to ZIP 60201, matching the order",
        },
      },
      {
        label: "Delivery signature matches the cardholder name",
        weight: 0.9,
        citation: { source: "shipment", ref: "7712 8841 0093", detail: 'Signature captured: "M. ODUYA"' },
      },
      {
        label: "AVS full match on street and postcode",
        weight: 0.4,
        citation: { source: "order", ref: "ORD-1009", detail: "AVS result Y" },
      },
      {
        label: "CVV match",
        weight: 0.3,
        citation: { source: "order", ref: "ORD-1009", detail: "CVV result M" },
      },
      {
        label: "Device seen on three prior fulfilled orders",
        weight: 0.4,
        citation: {
          source: "order",
          ref: "ORD-1009",
          detail: "device dev_4f18 on orders in 2025-06, 2025-09, 2025-12",
        },
      },
    ],
    note: (w) =>
      `Represent. At ${w}% this is as strong as a 13.1 file gets: the cardholder's own written acknowledgement of receipt is dated three days before the dispute and made against interest.`,
    letter: (w) => `Re: Chargeback DSP-1009 — Visa reason 13.1, Merchandise/Services Not Received
Transaction TXN-1009, $349.00, 18 February 2026
Estimated likelihood of a successful representment: ${w}%

We are contesting this chargeback. The cardholder acknowledged receiving the merchandise in writing before the dispute was filed.

1. The order was delivered to the cardholder's address on file.
   FedEx tracking 7712 8841 0093 records delivery on 22 February 2026 at 15:41 to postcode 60201. That is the shipping address on order ORD-1009 and it matches the billing postcode on the card.

2. Delivery was signed for in the cardholder's name.
   The carrier captured the signature "M. ODUYA" at the point of delivery. The cardholder of record is Michael Oduya.

3. The cardholder confirmed receipt in writing on 23 February 2026.
   In support conversation CHT-1009, one day after delivery, the cardholder wrote: "got the rug yesterday but the colour is not what I expected. The listing looked much more red." Our agent offered a return within the 30-day window. The cardholder replied: "Let me live with it for a week and see. I'll come back to you," and did not respond to our follow-up on 1 March. This dispute, claiming non-receipt, was filed on 5 March — ten days after the cardholder told us the item had arrived.

4. The transaction carries full authentication indicators.
   Order ORD-1009 returned AVS result Y (street address and postcode both matched) and CVV result M (match). The device fingerprint dev_4f18 used for this purchase appears on three previous fulfilled orders from this cardholder in June, September and December 2025.

The cardholder's stated reason for the dispute — that the item never arrived — is directly contradicted by their own message to us. The record is consistent with a customer who received the merchandise, was dissatisfied with its colour, was offered a return, and pursued a chargeback instead. We ask that the chargeback be reversed in full.

Enclosures: FedEx delivery confirmation with signature (7712 8841 0093); support transcript CHT-1009 dated 23 February 2026; order record ORD-1009 with AVS/CVV results; settlement record SET-1009.`,
  },

  "DSP-1010": {
    factors: [
      {
        label: "Carrier delivered to a different postcode than the order",
        weight: -0.8,
        citation: {
          source: "shipment",
          ref: "1Z884Y2R0398117402",
          detail: "Delivered to ZIP 78745; order ships to 78702 — about eight miles apart",
        },
      },
      {
        label: "No signature obtained — 'left at front door'",
        weight: -0.3,
        citation: { source: "shipment", ref: "1Z884Y2R0398117402", detail: "signature: none" },
      },
      {
        label: "Support promised a replacement and never sent one",
        weight: -0.7,
        citation: {
          source: "chat",
          ref: "CHT-1010",
          detail: '"I\'m going to send a replacement lamp out today at no charge" — 2026-03-06; no reshipment record exists',
        },
      },
      {
        label: "AVS partial match only (postcode matched, street did not)",
        weight: -0.15,
        citation: { source: "order", ref: "ORD-1010", detail: "AVS result Z" },
      },
      {
        label: "CVV match",
        weight: 0.3,
        citation: { source: "order", ref: "ORD-1010", detail: "CVV result M" },
      },
    ],
    note: (w) =>
      `Do not represent. At ${w}% the file argues the cardholder's case: our own delivery scan names the wrong postcode and our own transcript contains an unkept promise. Accept liability, refund, and open a carrier claim against UPS instead.`,
    letter: (w) => `INTERNAL RECOMMENDATION — DO NOT SUBMIT AS A REPRESENTMENT
Re: Chargeback DSP-1010 — Visa reason 13.1, Merchandise/Services Not Received
Transaction TXN-1010, $129.00, 24 February 2026
Estimated likelihood of a successful representment: ${w}%

Recommendation: accept liability and refund. Do not contest.

We have drafted no rebuttal letter for this dispute because the evidence does not support one. Submitting a representment here would mean presenting a delivery confirmation that names the wrong postcode, and would likely produce a second loss plus the representment fee.

What the record shows:

1. The delivery scan does not place the item at the cardholder's address.
   UPS tracking 1Z884Y2R0398117402 records delivery on 27 February 2026 to postcode 78745. Order ORD-1010 ships to 1442 Willow Run, Austin TX 78702 — roughly eight miles away. The scan reads "left at front door" and no signature was obtained. We cannot show the package reached the cardholder.

2. Our own support record concedes the point.
   The cardholder reported non-receipt on 2 March and again on 6 March. On the second contact our agent wrote that the carrier trace "came back inconclusive" and committed to sending a replacement lamp that day at no charge. No reshipment was created. The cardholder wrote again on 10 March — "No replacement, no tracking, no reply" — and filed this dispute the following day.

3. Authentication is only partial.
   AVS returned Z (postcode matched, street address did not). CVV matched.

Actions:
  - Refund $129.00 to the cardholder and accept the chargeback.
  - Open a lost-in-transit claim with UPS against tracking 1Z884Y2R0398117402, citing the postcode discrepancy. That is where this loss should land.
  - Review why the reshipment promised on 6 March was never created; this is the second failure in the same case and it is the one that turned a carrier problem into a chargeback.`,
  },

  "DSP-1011": {
    factors: [
      {
        label: "Signup consent record with IP and timestamp",
        weight: 0.9,
        citation: {
          source: "order",
          ref: "ORD-1011",
          detail: "Consent recorded 2025-08-14T17:02Z from IP 50.79.14.88, device dev_9f31",
        },
      },
      {
        label: "Six prior renewals on the same card, none disputed",
        weight: 0.7,
        citation: { source: "settlement", ref: "SET-1011", detail: "Renewal 7 of 7; renewals 1-6 undisputed" },
      },
      {
        label: "Same device fingerprint and IP as the original signup",
        weight: 0.6,
        citation: { source: "order", ref: "ORD-1011", detail: "device dev_9f31, IP 50.79.14.88 — identical to signup" },
      },
      {
        label: "AVS full match",
        weight: 0.3,
        citation: { source: "order", ref: "ORD-1011", detail: "AVS result Y" },
      },
      {
        label: "Renewal notices hard-bounced for three consecutive cycles",
        weight: -0.9,
        citation: { source: "order", ref: "ORD-1011", detail: "Notice emails bounced for renewals 5, 6 and 7" },
      },
      {
        label: "Account dormant for 118 days before the renewal",
        weight: -0.4,
        citation: { source: "order", ref: "ORD-1011", detail: "Last login 2025-11-03" },
      },
      {
        label: "No CVV collected (normal for recurring, unhelpful under a fraud code)",
        weight: -0.35,
        citation: { source: "order", ref: "ORD-1011", detail: "CVV result U — not collected" },
      },
    ],
    note: (w) =>
      `Represent, but treat ${w}% as a coin flip and price it accordingly. The device and consent evidence is genuinely strong; the bounced notices are a genuine weakness that the issuer will weigh. Consider whether a $24.00 recovery justifies the representment fee and the effort.`,
    letter: (w) => `Re: Chargeback DSP-1011 — Visa reason 10.4, Other Fraud (Card Absent Environment)
Transaction TXN-1011, $24.00, 1 March 2026
Estimated likelihood of a successful representment: ${w}%

We are contesting this chargeback, while noting openly that the evidence is mixed.

1. The subscription was affirmatively established by the cardholder.
   Order record ORD-1011 holds a signup consent event dated 14 August 2025 at 17:02 UTC, captured from IP 50.79.14.88 on device dev_9f31, under the email address hpinsky@example.com. In support conversation CHT-1011 the cardholder confirmed that email address is theirs.

2. This renewal originated from the same device and network as the signup.
   The 1 March 2026 renewal carries device fingerprint dev_9f31 and IP 50.79.14.88 — the same values recorded at signup seven months earlier. AVS returned Y (full match).

3. Six prior renewals on this card were accepted without dispute.
   Renewals one through six, from September 2025 to February 2026, settled on the same card with no chargeback. This is the seventh.

4. The cardholder's own account is one of non-recollection, not non-authorisation.
   In CHT-1011 the cardholder wrote: "That is my email but I don't remember any subscription." That is a statement about memory rather than about authorisation, and it is consistent with the pattern above.

We disclose two facts that weigh against us, because the issuer will find them regardless: our renewal notification emails hard-bounced for the last three cycles, so the cardholder may not have received a reminder that the subscription was active; and the account had not been logged into for 118 days before this renewal. CVV was not collected, as is standard for stored-credential recurring transactions.

We have cancelled the subscription with effect from 7 March 2026. We ask that this renewal be upheld on the strength of the consent record and matching device evidence.

Enclosures: signup consent record with IP and timestamp (ORD-1011); device and IP match for the disputed renewal; settlement history for renewals 1-6; support transcript CHT-1011.`,
  },

  "DSP-1006": {
    factors: [
      {
        label: "Our own ledger records two settled captures against one order",
        weight: -2.2,
        citation: {
          source: "settlement",
          ref: "SET-1006A / SET-1006B",
          detail: "Two $75.00 captures 47 seconds apart against order ORD-1006 (total $75.00)",
        },
      },
      {
        label: "One shipment for one item — no second order exists",
        weight: -0.6,
        citation: {
          source: "shipment",
          ref: "9400 1112 0200 8891 6620",
          detail: "One kettle shipped against the single order record",
        },
      },
      {
        label: "Support incorrectly told the customer a charge would drop off",
        weight: -0.5,
        citation: {
          source: "chat",
          ref: "CHT-1006",
          detail: '"Your bank may be showing a temporary authorisation that will drop off" — 2026-03-04; both captures had settled',
        },
      },
    ],
    note: (w) =>
      `Do not represent. At ${w}% the dispute is simply correct — our own settlement export is the cardholder's best evidence. Refund SET-1006B now rather than waiting for the chargeback to complete.`,
    letter: (w) => `INTERNAL RECOMMENDATION — DO NOT SUBMIT AS A REPRESENTMENT
Re: Chargeback DSP-1006 — Visa reason 12.6.1, Duplicate Processing
Transaction TXN-1006, $75.00, 4 March 2026
Estimated likelihood of a successful representment: ${w}%

Recommendation: accept liability immediately and refund. The cardholder is right.

There is no defensible position here, and the evidence that defeats us is our own:

1. We captured the same payment twice.
   Settlement records SET-1006A (14:22:05Z) and SET-1006B (14:22:52Z) are two separate settled captures of $75.00, 47 seconds apart, both against order ORD-1006. That order totals $75.00. There is no second order record.

2. We shipped one item.
   USPS tracking 9400 1112 0200 8891 6620 covers a single kettle against the single order. The cardholder received one kettle and paid for two.

3. The customer told us on the day, and we told them the wrong thing.
   In CHT-1006 on 4 March the customer reported the double charge and explained that the checkout page appeared to hang, so they clicked pay twice — which is exactly what the 47-second capture gap shows. Our agent replied that the bank was likely showing a temporary authorisation that would drop off. Both captures had already settled. On 9 March the customer wrote back to say it had not dropped off. The chargeback followed on 10 March.

Actions:
  - Refund $75.00 against SET-1006B today. Do not wait for the chargeback cycle.
  - Note that this transaction also reconciles cleanly against the bank ($145.04 credited against $145.04 settled), so an amount-only reconciliation will not surface it. The duplicate is only visible by comparing captures against the order total.
  - Fix the checkout double-submit path, and correct the support macro that describes settled captures as temporary authorisations.`,
  },
};

export function buildRebuttal(dispute: DisputeRecord, resolution: Resolution): Rebuttal {
  const canned = REBUTTALS[dispute.disputeId];
  const baseline = REASON_BASELINE[dispute.reasonCode] ?? 0.25;
  const baseLogit = Math.log(baseline / (1 - baseline));

  const factors = canned?.factors ?? [];
  const logit = baseLogit + factors.reduce((s, f) => s + f.weight, 0);
  const winLikelihood = Math.round(
    Math.max(MIN_WIN, Math.min(MAX_WIN, sigmoid(logit))) * 100,
  );

  const recommendation =
    winLikelihood >= 60 ? "represent" : winLikelihood >= 35 ? "represent-with-caution" : "accept-liability";

  return {
    disputeId: dispute.disputeId,
    transactionRef: dispute.transactionRef,
    winLikelihood: winLikelihood / 100,
    recommendation,
    recommendationNote:
      canned?.note(winLikelihood) ??
      `No hand-authored rebuttal exists for ${dispute.disputeId}; likelihood is the ${dispute.reasonCode} baseline only.`,
    letter:
      canned?.letter(winLikelihood) ??
      `No draft available for ${dispute.disputeId}. Resolver verdict: ${resolution.headline}`,
    evidenceCited: factors.map((f) => f.citation),
    provenance: "mock",
  };
}

/** The weighted factors behind the score, for display. */
export function rebuttalFactors(disputeId: string): Factor[] {
  return REBUTTALS[disputeId]?.factors ?? [];
}

export { usd };
