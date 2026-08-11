import { usd } from "../fixtures";
import type { Check, EvidenceBundle, LlmJudgement } from "./types";

/**
 * Canned reasoning, one entry per fixture case.
 *
 * These are not templates. Each one is the argument a careful analyst would
 * make about that specific transaction, citing the specific records involved.
 * In real mode the same slot is filled by the Anthropic call in llm.ts; the
 * shape and the pacing are identical so the demo is the same either way.
 */
const CANNED: Record<string, (b: EvidenceBundle) => Omit<LlmJudgement, "provenance">> = {
  "TXN-1001": () => ({
    question: "Does any unstructured evidence contradict a clean match?",
    verdict: "corroborates",
    rationale:
      "Nothing in the order or shipment record cuts against the ledger. The order was placed at 15:58 and captured six minutes later, USPS delivered to the order address on 6 March, and no support contact was ever opened. There is no narrative here to weigh against the numbers.",
    citations: [
      { source: "order", ref: "ORD-1001", detail: "Placed 15:58, captured 16:04 — six-minute gap" },
      { source: "shipment", ref: "9400 1112 0200 8891 4477", detail: "Delivered 2026-03-06 to order ZIP 02906" },
    ],
    weight: 0.2,
    headline: "Clean match — bank credit equals settled net to the cent.",
    explanation:
      "The bank credited $120.59 on 3 March and the settlement ledger shows a single capture of $124.50 less a $3.91 fee, netting exactly $120.59. The bank descriptor carries TXN-1001 directly, so identity is not inferred. Fee, timing and capture amount all check out, and no support contact or delivery exception exists to complicate the picture. Nothing here needs explaining.",
  }),

  "TXN-1002": () => ({
    question: "Is the amount-and-date inference safe, given the descriptor carries no reference?",
    verdict: "corroborates",
    rationale:
      "The inference is safe here for a reason worth stating: $86.12 is not a round number, it is the exact net of a $89.00 capture under the published fee schedule, and no other settled record in the period produces that figure. A collision would require a second transaction with an $89.00 gross on the same day, and there isn't one.",
    citations: [
      { source: "bank", ref: "BNK-003", detail: '"NORTHWIND SUPPLY STLMT BATCH 0304" — batch label, no reference' },
      { source: "settlement", ref: "SET-1002", detail: "gross $89.00, fee $2.88, net $86.12 — the only record producing this net" },
    ],
    weight: 0.3,
    headline: "Matched by inference — no reference in the descriptor; the $2.88 gap to the order total is the processing fee.",
    explanation:
      "The bank line for this payment is labelled only 'BATCH 0304' with no transaction reference, so it had to be matched on amount and date rather than read off the descriptor. That match is unambiguous: $86.12 is exactly $89.00 less the 2.9% + $0.30 fee, and no other settled record in the period nets to that figure. Anyone comparing the storefront order ($89.00) against the deposit ($86.12) will see a $2.88 shortfall — that is the processing fee, not a discrepancy. Flagging the descriptor gap is worthwhile as a data-quality note; flagging the money is not.",
  }),

  "TXN-1003": () => ({
    question: "Is the three-day gap between capture and posting a delay or a calendar artefact?",
    verdict: "corroborates",
    rationale:
      "The capture landed at 21:40 UTC on Friday 6 March — after the Friday cut-off — and posted at 09:12 on Monday 9 March. Everything between those points is a weekend. Measured in business days the payout took one, which is the fast end of normal. A monitor that alerts on calendar age would have paged someone for this; it should not have.",
    citations: [
      { source: "settlement", ref: "SET-1003", detail: "Captured 2026-03-06T21:40Z (Friday, post cut-off)" },
      { source: "bank", ref: "BNK-008", detail: "Posted 2026-03-09T09:12Z (Monday morning)" },
    ],
    weight: 0.4,
    headline: "Timing lag across a weekend — one business day, not three calendar days.",
    explanation:
      "The amounts reconcile exactly: $61.00 captured, $2.07 fee, $58.93 net, and the bank credited $58.93 with TXN-1003 in the descriptor. The only thing that looks wrong is the age — 2.5 calendar days between capture and posting. It resolves cleanly once you count business days instead: the capture came in after Friday's cut-off, so the payout ran on Monday. One business day elapsed. This is the normal payout window presented badly by a calendar-day clock, and no action is needed.",
  }),

  "TXN-1004": () => ({
    question: "Is the two-cent gap FX rounding or a genuine shortfall?",
    verdict: "corroborates",
    rationale:
      "Two independent conversions happen on a cross-border settlement and they round separately. The processor converted EUR 249.00 at 1.0842 to $269.97, took $8.13 in fees, and reported a $261.84 net. The bank re-derived its own figure on the settled leg and landed two cents lower. Two cents on $261.84 is 0.008 basis points — well inside the tolerance, and the sign and size are exactly what independent rounding produces. A genuine shortfall does not arrive in two-cent units.",
    citations: [
      { source: "settlement", ref: "SET-1004", detail: "EUR 249.00 @ 1.0842 → $269.97 gross, $261.84 net" },
      { source: "bank", ref: "BNK-010", detail: "Credited $261.82 — two cents below the reported net" },
      { source: "order", ref: "ORD-1004", detail: "Presented to the customer in EUR; customer in Lyon, FR" },
    ],
    weight: 0.5,
    headline: "Currency rounding — $0.02 gap on a EUR→USD settlement, inside tolerance.",
    explanation:
      "The customer paid EUR 249.00; the processor converted at 1.0842 to $269.97, deducted $8.13, and reported a net of $261.84. The bank credited $261.82. The two-cent difference comes from the bank rounding its own conversion of the settled leg independently of the processor — both are correct to their own books. The tolerance for an amount this size is thirteen cents, and this is two. Worth reconciling to zero at month end against the processor's FX statement; not worth an investigation.",
  }),

  "TXN-1005": () => ({
    question: "Does the missing refund debit mean the refund failed, or simply that it has not settled?",
    verdict: "corroborates",
    rationale:
      "The refund exists and its status says so plainly: SET-1005R is marked pending_settlement, not settled. The chat log gives it a cause — the serving platter arrived broken on 8 March and the agent committed on 9 March to refunding just that line, quoting 3-5 business days. The refund was raised on 10 March for exactly $40.00, matching the platter's line price. Two days later the money has not moved, which is what 'pending' means. Nothing failed.",
    citations: [
      { source: "settlement", ref: "SET-1005R", detail: "$40.00 partial refund, status pending_settlement, raised 2026-03-10" },
      { source: "chat", ref: "CHT-1005", detail: '"The platter was $40 — I\'ll refund just that line… 3-5 business days"' },
      { source: "shipment", ref: "1Z884Y2R0398220016", detail: "Delivered 2026-03-08; platter arrived cracked" },
      { source: "order", ref: "ORD-1005", detail: "SKU-23 Serving platter, $40.00 — matches the refund exactly" },
    ],
    weight: 0.5,
    headline: "Partial refund authorised but not yet drawn — the account will fall $40.00 next cycle.",
    explanation:
      "The bank shows $174.48 credited on 5 March, which matches the settled capture exactly. What it does not yet show is the $40.00 partial refund raised on 10 March, so anyone comparing the internal ledger's current position against the bank will see a $40.00 overstatement. That is timing, not error: the refund is marked pending_settlement and is two days into a 3-5 business day window. It traces to a real, documented cause — the serving platter arrived cracked, and the agent refunded that line rather than requiring a return. Expect the debit next cycle; re-check if it has not landed by 17 March.",
  }),

  "TXN-1006": () => ({
    question: "Is the second capture a duplicate, or a legitimate second purchase?",
    verdict: "contradicts",
    rationale:
      "Every available source says duplicate, and the support agent's reassurance was wrong. There is one order record for one kettle at $75.00, one shipment with one kettle in it, and two settled captures of $75.00 forty-seven seconds apart. A genuine second purchase would have produced a second order record; none exists. The customer told us on the day that the checkout button appeared to hang and they clicked twice, which is the exact failure mode this pattern describes. The agent replied that the bank was showing a temporary authorisation that would drop off — that was incorrect, both captures are settled, and five days later the customer said so.",
    citations: [
      { source: "settlement", ref: "SET-1006A", detail: "$75.00 captured 14:22:05Z, settled" },
      { source: "settlement", ref: "SET-1006B", detail: "$75.00 captured 14:22:52Z, settled — 47 seconds later" },
      { source: "order", ref: "ORD-1006", detail: "One order, total $75.00. No second order exists." },
      { source: "shipment", ref: "9400 1112 0200 8891 6620", detail: "One kettle shipped against the single order" },
      { source: "chat", ref: "CHT-1006", detail: '"The page hung when I clicked pay so I clicked again" (2026-03-04, day of capture)' },
    ],
    weight: -0.6,
    headline: "Duplicate capture — the cardholder was charged $75.00 twice for one kettle.",
    explanation:
      "Two captures of $75.00 settled 47 seconds apart against a single order for a single kettle, and both reached the bank. The order system has one record, the warehouse shipped one item, and the customer reported the double charge the same afternoon — they described the checkout button hanging and clicking again, which is precisely what the timestamps show. Support told them one charge was a temporary authorisation that would drop off; that was wrong, and the customer returned five days later to say it had not. The bank reconciles internally ($145.04 credited against $145.04 settled), which is why an amount-only reconciliation would pass this straight through. The error is upstream of the bank: we captured money we were not owed. Reverse SET-1006B for $75.00 immediately — see also the duplicate-processing chargeback DSP-1006, which we should not contest.",
  }),

  "TXN-1007A": () => ({
    question: "Can this bank credit be attributed to Renee Duval's order or Owen Marsh's?",
    verdict: "inconclusive",
    rationale:
      "It cannot, and the honest output is to say so. Two unrelated customers ordered the same $154.95 oak bench thirteen minutes apart on 10 March. Both captures settled to an identical net of $150.16. Exactly one credit of $150.16 arrived on 11 March, under a batch label with no reference field. Every distinguishing attribute is either identical (amount, product, settlement date, descriptor) or absent from the bank line (customer, address, order ID). There is no tiebreaker available: no partial payment, no differing fee, no second credit to pair off. Forcing a match here would be a coin flip presented as an answer, and the wrong half of that coin flip means one customer's payment is recorded as received when it was not.",
    citations: [
      { source: "settlement", ref: "SET-1007A", detail: "Renee Duval, captured 19:31Z, net $150.16" },
      { source: "settlement", ref: "SET-1007B", detail: "Owen Marsh, captured 19:44Z, net $150.16 — identical" },
      { source: "bank", ref: "BNK-011", detail: '"NORTHWIND SUPPLY STLMT BATCH 0311" — $150.16, no reference field' },
      { source: "order", ref: "ORD-1007A", detail: "Oak bench SKU-61, Indianapolis IN" },
      { source: "order", ref: "ORD-1007B", detail: "Oak bench SKU-61, Charlotte NC — same SKU, same price" },
    ],
    weight: -0.5,
    headline: "Cannot be attributed — one credit, two identical claimants, no distinguishing evidence.",
    explanation:
      "Two customers bought the same $154.95 bench thirteen minutes apart, and both captures net to $150.16. Only one $150.16 credit posted, under a batch label carrying no reference. Nothing in any source separates the two: same amount, same SKU, same settlement date, same descriptor, and the bank line names no customer. One of these two payments has funded and the other has not, and the evidence does not say which. This is flagged rather than resolved on purpose — a forced match would record one customer as paid when they may not be, which is worse than an open item. Resolving it needs something outside the bundled data: the processor's per-transaction payout detail, which carries the settlement ID the bank descriptor drops.",
  }),

  "TXN-1007B": (b) => CANNED["TXN-1007A"](b),

  "TXN-1009": () => ({
    question: "Does the support conversation corroborate or contradict the cardholder's claim of non-receipt?",
    verdict: "contradicts",
    rationale:
      "It contradicts it directly and in the cardholder's own words. On 23 February they wrote 'got the rug yesterday but the colour is not what I expected' — an explicit acknowledgement of receipt, timed one day after the carrier's delivery scan. The dispute filed on 5 March claims the rug never arrived. Both statements cannot be true, and the earlier one was made spontaneously, against interest, before any dispute existed. The complaint was about colour, the agent offered a return, and the customer said they would live with it for a week and then stopped replying. The chargeback looks like a return the customer decided not to complete.",
    citations: [
      { source: "chat", ref: "CHT-1009", detail: '"got the rug yesterday but the colour is not what I expected" — 2026-02-23' },
      { source: "shipment", ref: "7712 8841 0093", detail: "Delivered 2026-02-22 15:41, signed M. ODUYA, ZIP 60201 matches order" },
      { source: "dispute", ref: "DSP-1009", detail: 'Filed 2026-03-05 claiming "never received"' },
      { source: "order", ref: "ORD-1009", detail: "AVS Y, CVV M, device dev_4f18 seen on three prior fulfilled orders" },
    ],
    weight: 0.6,
    headline: "Delivered, signed for, and acknowledged in writing — the non-receipt claim is contradicted.",
    explanation:
      "This transaction reconciles cleanly ($349.00 captured, $10.42 fee, $338.58 credited on 20 February with the reference in the descriptor), so the financial side is not in question. The dispute is. FedEx delivered to the order address on 22 February with a signature reading M. ODUYA, matching the cardholder's name and the billing ZIP. AVS returned a full match, CVV matched, and the device fingerprint has appeared on three prior fulfilled orders for this customer. Most decisively, the cardholder wrote in the next day to say the rug had arrived and they were unhappy with the colour — an acknowledgement of receipt made in writing, before any dispute existed, and inconsistent with the claim now being made.",
  }),

  "TXN-1010": () => ({
    question: "Does the evidence support the merchant's position that the lamp was delivered?",
    verdict: "corroborates",
    rationale:
      "It supports the cardholder, not us. The carrier scan says delivered, but to ZIP 78745 when the order address is 78702 — roughly eight miles apart. There is no signature; the scan reads 'left at front door', and it was not our customer's front door. The cardholder reported non-receipt twice, four days apart, and on the second contact our own agent conceded the trace was inconclusive and promised a replacement lamp that day. No reshipment record exists. So the merchant's file contains a mis-delivery, no proof of receipt, an admission that the trace failed, and an unkept promise — with AVS returning only a partial (ZIP-only) match on top. Representing this would be presenting a delivery scan that names the wrong postcode.",
    citations: [
      { source: "shipment", ref: "1Z884Y2R0398117402", detail: "Delivered to ZIP 78745; order ZIP is 78702. No signature — 'left at front door'." },
      { source: "chat", ref: "CHT-1010", detail: '"The trace came back inconclusive. I\'m going to send a replacement lamp out today" — 2026-03-06' },
      { source: "chat", ref: "CHT-1010", detail: "No reshipment record exists for the replacement promised on 2026-03-06" },
      { source: "order", ref: "ORD-1010", detail: "AVS Z — ZIP matched, street address did not" },
    ],
    weight: -0.4,
    headline: "Delivery scan points to the wrong postcode and a promised reship never happened.",
    explanation:
      "The money reconciles — $129.00 captured, $124.96 credited on 26 February with the reference in the descriptor — but the delivery does not. UPS marked the lamp delivered on 27 February to ZIP 78745, while the order ships to 78702, about eight miles away. There is no signature, only a 'left at front door' scan at an address that is not the customer's. The cardholder reported non-receipt on 2 March and again on 6 March; on the second contact our agent said the carrier trace was inconclusive and promised a replacement that day. No reshipment was ever created. The cardholder's account is consistent with every record we hold, and ours is not.",
  }),

  "TXN-1011": () => ({
    question: "Was this renewal authorised, given a valid signup but three bounced notices and a dormant account?",
    verdict: "inconclusive",
    rationale:
      "The evidence genuinely splits, and the split is not a matter of weak proof on one side — it is two well-supported accounts of the same facts. For authorisation: a consent record from 14 August 2025 with IP and timestamp, six prior renewals on the same card that were never disputed, and this renewal arriving from the same device fingerprint (dev_9f31) and the same IP as the signup. Against: renewal notice emails hard-bounced for the last three cycles, so the cardholder plausibly stopped seeing any reminder that this was recurring; the account has not been logged into for 118 days; and no CVV was collected, as is normal for recurring but unhelpful in a card-absent fraud dispute. In the chat the cardholder confirms the email address is theirs and does not deny it could have happened — they say they do not remember it, which is a different claim from 'this was not me'. That reading favours a forgotten subscription over fraud, but 'forgotten' is not the same as 'authorised' once notices have stopped arriving, and a 10.4 fraud dispute is not decided on the merchant's device logs alone.",
    citations: [
      { source: "order", ref: "ORD-1011", detail: "Signup consent 2025-08-14T17:02Z from IP 50.79.14.88, device dev_9f31" },
      { source: "settlement", ref: "SET-1011", detail: "Renewal 7 of 7; renewals 1-6 undisputed" },
      { source: "order", ref: "ORD-1011", detail: "Renewal notices hard-bounced for cycles 5, 6, 7. Last login 118 days ago. CVV not collected." },
      { source: "chat", ref: "CHT-1011", detail: '"That is my email but I don\'t remember any subscription"' },
      { source: "dispute", ref: "DSP-1011", detail: "Reason 10.4 — Other Fraud, Card Absent Environment" },
    ],
    weight: -0.5,
    headline: "Genuinely contested — strong signup and device evidence against three bounced notices and a dormant account.",
    explanation:
      "The $24.00 renewal reconciles cleanly against the bank. Whether it was authorised does not resolve. In favour: a consent record from August 2025 with IP and timestamp, six undisputed prior renewals, and this charge originating from the same device and IP as the original signup. Against: renewal notices hard-bounced for the last three cycles, the account has been dormant for 118 days, and no CVV was collected. The cardholder's own words point at a forgotten subscription rather than fraud — they confirm the email is theirs and say they do not remember signing up, which is not the same as denying it. But a cardholder who stopped receiving notices has a real argument that consent lapsed in practice, and the dispute is filed under a fraud code where our device logs carry less weight than they would under a 13.x reason. This is flagged rather than called either way.",
  }),

  "TXN-1012": () => ({
    question: "Can the $12.40 shortfall be attributed to any known deduction?",
    verdict: "inconclusive",
    rationale:
      "No, and each candidate explanation can be ruled out rather than merely doubted. It is not the processing fee: the fee is $6.68 and is already deducted inside the $213.32 net figure the bank is being compared against. It is not FX: the order, the capture and the payout are all USD, with no presentment currency on the record. It is not a refund: no refund or partial refund exists against ORD-1012, settled or pending. It is not timing: the full capture posted as a single credit one business day after capture. The shortfall is 5.8% of the net, which is far too large to be rounding and does not correspond to any published rate. Something took $12.40 that no source in this bundle records.",
    citations: [
      { source: "settlement", ref: "SET-1012", detail: "gross $220.00, fee $6.68, net $213.32 — fee is within the published schedule" },
      { source: "bank", ref: "BNK-012", detail: "Credited $200.92 on 2026-03-11 — $12.40 short of the reported net" },
      { source: "order", ref: "ORD-1012", detail: "USD order, no cross-currency leg, no refund raised" },
    ],
    weight: -0.4,
    headline: "Unexplained $12.40 shortfall — not fee, not FX, not refund, not timing.",
    explanation:
      "The processor reports a $220.00 capture with a correct $6.68 fee, netting $213.32. The bank credited $200.92 — $12.40 less, with the reference right there in the descriptor, so this is not a matching problem. Every ordinary explanation is ruled out by the records rather than merely unlikely: the fee is already inside the net figure, there is no cross-currency leg, no refund exists against this order, and the credit posted on time and in full as a single line. At 5.8% of the net the gap is far too large to be rounding. This needs the processor's payout detail for 11 March to see what was withheld — a chargeback reserve, an interchange adjustment and a prior-period clawback would all look like this from here, and the bundled data cannot distinguish them.",
  }),

  "TXN-1013": () => ({
    question: "Does the support log explain why the capture is $20.00 below the order total?",
    verdict: "corroborates",
    rationale:
      "It explains it completely and the numbers agree with the words. On 2 March the agent told the customer the walnut serving tray (SKU-88, $20.00) was backordered until May; the customer asked for the other two items to be sent without it; the agent replied that the tray had been removed and the charge would be $180 rather than $200. The capture is $180.00 exactly, the shortfall is $20.00 exactly, that is precisely SKU-88's line price, and the shipment manifest confirms SKU-88 is not in the box. Four independent records tell the same story, and the customer agreed to it in writing.",
    citations: [
      { source: "chat", ref: "CHT-1013", detail: '"I\'ve removed the tray from the order, so you\'ll only be charged $180" — agent, 2026-03-02' },
      { source: "chat", ref: "CHT-1013", detail: '"Perfect, thanks." — customer confirms' },
      { source: "order", ref: "ORD-1013", detail: "SKU-88 Walnut serving tray, $20.00 — exactly the shortfall" },
      { source: "settlement", ref: "SET-1013", detail: "Captured $180.00 against a $200.00 order" },
      { source: "shipment", ref: "7712 8841 5510", detail: "Two of three line items shipped; SKU-88 not included" },
    ],
    weight: 0.6,
    headline: "Partial capture — the $20.00 gap is a backordered line item the customer agreed to drop.",
    explanation:
      "The order totals $200.00 but only $180.00 was captured, and the bank credited the matching net of $174.48. The $20.00 difference is the walnut serving tray: backordered until May, removed from the order by an agent on 2 March, agreed to by the customer in the same conversation, and absent from the shipment manifest. The line price of SKU-88 is $20.00, matching the shortfall to the cent. This is a correctly handled partial capture, not a discrepancy — the only thing worth noting is that the order record still carries the original $200.00 total, which is what makes it look wrong to an automated comparison.",
  }),

  "TXN-1014": () => ({
    question: "Does any unstructured evidence contradict a clean match?",
    verdict: "not-applicable",
    rationale:
      "There is no unstructured evidence to weigh: no shipment record has been created yet and no support contact exists. For a $42.00 order captured, settled and posted without incident, that absence is unremarkable rather than suspicious — nothing in the ledger is waiting on the missing sources.",
    citations: [
      { source: "settlement", ref: "SET-1014", detail: "gross $42.00, fee $1.52, net $40.48" },
      { source: "bank", ref: "BNK-001", detail: "Credited $40.48 on 2026-03-02 with the reference in the descriptor" },
    ],
    weight: 0.1,
    headline: "Clean match — small order, reference present, no exceptions.",
    explanation:
      "A $42.00 order captured on 1 March, settled at $40.48 after the standard $1.52 fee, and credited to the bank the next business day with TXN-1014 in the descriptor. Amount, fee, timing and identity all agree. No shipment or support record exists yet, which for an order of this age is expected and does not affect the financial resolution.",
  }),

  "TXN-1015": () => ({
    question: "Is the refund fully reconciled, including the treatment of the original fee?",
    verdict: "corroborates",
    rationale:
      "Yes, and the fee treatment is the part worth confirming. The refund of $50.00 was raised on 4 March and the bank debited exactly $50.00 on 6 March, two business days later. The processing fee from the original February capture is not returned, which matches the published schedule — so the merchant is out the fee on a returned item. That is expected, not an error, but it is the kind of thing that looks like a discrepancy to anyone reconciling refunds against original captures rather than against the refund record.",
    citations: [
      { source: "settlement", ref: "SET-1015R", detail: "$50.00 refund, settled, fee $0.00 returned" },
      { source: "bank", ref: "BNK-007", detail: "Debited $50.00 on 2026-03-06 with the reference in the descriptor" },
      { source: "shipment", ref: "9400 1112 0200 8890 1180", detail: "Return received at warehouse 2026-03-02" },
    ],
    weight: 0.3,
    headline: "Refund reconciled — $50.00 debited against a $50.00 settled refund.",
    explanation:
      "A wool throw returned on 2 March was refunded in full on 4 March, and the bank debited $50.00 on 6 March with the reference in the descriptor. The refund record and the bank agree exactly. The original capture's processing fee is not returned by the processor, which is per the published schedule — the merchant absorbs it. Fully resolved.",
  }),

  "BNK-009": () => ({
    question: "What is this $31.20 debit, and can it be attributed to anything?",
    verdict: "inconclusive",
    rationale:
      "It cannot be attributed from the bundled data. The descriptor reads 'ADJ Q1-TRUEUP', which reads like a quarterly reconciliation adjustment from the processor rather than anything transaction-level, and it is a debit against the payout account on 9 March. No settlement record, order, refund or chargeback in the export corresponds to it — the internal ledger simply has nothing on 9 March at that amount or in that shape. What can be said with confidence is narrower than an explanation: money left the account and no internal system recorded why.",
    citations: [
      { source: "bank", ref: "BNK-009", detail: '"NORTHWIND SUPPLY ADJ Q1-TRUEUP" — $31.20 debit, 2026-03-09, no reference field' },
      { source: "settlement", ref: "SET-*", detail: "No record of any type in the export matches this amount or date" },
    ],
    weight: -0.4,
    headline: "Bank-only debit — no internal record of any kind exists for this $31.20.",
    explanation:
      "A $31.20 debit posted on 9 March under the descriptor 'ADJ Q1-TRUEUP'. Nothing in the settlement export, the order system, or the refund ledger corresponds to it. The label suggests a quarterly true-up posted by the processor outside the per-transaction feed, which would be routine — but that is an inference from six words in a descriptor, not something any record here confirms. It is left unattributed deliberately. Confirming it takes the processor's monthly billing statement, which is not part of the transaction feed this reconciliation reads.",
  }),
};

/**
 * Fallback for any transaction without a hand-written entry — every uploaded
 * transaction, in practice. Derived strictly from the deterministic checks, and
 * careful to describe what was actually found: a unit whose checks are all
 * "missing" has not been cleared, it is unresolved, and the headline must say so.
 */
function derive(bundle: EvidenceBundle, checks: Check[]): Omit<LlmJudgement, "provenance"> {
  const conflicts = checks.filter((c) => c.outcome === "conflict");
  const explained = checks.filter((c) => c.outcome === "explained");
  const missing = checks.filter((c) => c.outcome === "missing");
  const agree = checks.filter((c) => c.outcome === "agree");

  const verdict: LlmJudgement["verdict"] =
    conflicts.length > 0 ? "contradicts" : missing.length > 0 ? "inconclusive" : "corroborates";

  let headline: string;
  if (conflicts.length > 0) {
    headline = `${conflicts[0].label}: ${firstClause(conflicts[0].detail)}`;
  } else if (missing.length > 0 && agree.length === 0) {
    headline = bundle.bankOnly
      ? `Bank-only movement — no internal record exists for ${bundle.transactionRef}.`
      : `Insufficient evidence — ${missing.length} source check(s) had nothing to read.`;
  } else if (missing.length > 0) {
    headline = `Partially evidenced — ${agree.length} check(s) agree, ${missing.length} could not be run.`;
  } else if (explained.length > 0) {
    headline = `${explained[0].label}: ${firstClause(explained[0].detail)}`;
  } else {
    headline = `All ${agree.length} checks agree across the available sources.`;
  }

  const rationale =
    "No hand-written analysis exists for this transaction, so this reading is derived from the " +
    "deterministic checks alone. The narrative evidence has not been interpreted — with a live " +
    "model configured, that step would add what only a reader of the transcripts can add.";

  const explanation = [
    conflicts.length > 0
      ? `${conflicts.length} check(s) conflict: ${conflicts.map((c) => c.label).join(", ")}.`
      : null,
    explained.length > 0
      ? `${explained.length} difference(s) have a named cause: ${explained.map((c) => c.label).join(", ")}.`
      : null,
    missing.length > 0
      ? `${missing.length} check(s) had no evidence to read: ${missing.map((c) => c.label).join(", ")}.`
      : null,
    agree.length > 0 ? `${agree.length} check(s) agree.` : null,
    checks.map((c) => `${c.label}: ${c.detail}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    question: "What do the deterministic checks establish about this transaction?",
    verdict,
    rationale,
    citations: (conflicts[0] ?? explained[0] ?? missing[0] ?? agree[0])?.citations ?? [],
    weight: 0,
    headline,
    explanation: explanation || `No checks produced output for ${bundle.transactionRef}.`,
  };
}

/** First sentence, without breaking on the decimal point in "$3.00". */
function firstClause(text: string): string {
  const m = text.match(/^(.*?[^0-9])\.(?:\s|$)/);
  const clause = (m ? m[1] : text).trim();
  return clause.length > 110 ? clause.slice(0, 107) + "…" : clause + ".";
}

export function mockJudgement(bundle: EvidenceBundle, checks: Check[]): LlmJudgement {
  const canned = CANNED[bundle.transactionRef];
  const body = canned ? canned(bundle) : derive(bundle, checks);
  return { ...body, provenance: "mock" };
}

export function hasCannedReasoning(ref: string): boolean {
  return ref in CANNED;
}

export { usd };
