# Sample evidence

A small merchant book — 32 rows across six files — built so both workflows have
something interesting to do. Upload all six on either page.

**Set the fee schedule to 2.90% + $0.30 in the upload form.** Fees are
per-merchant, so the resolver has no way to know yours; leave it wrong and every
row flags on the fee check.

## What Reconcile finds

3 matched · 2 explained differences · 2 flagged

| ref | outcome | why it is here |
|---|---|---|
| TXN-2001 | matched 90% | Everything agrees. The baseline. |
| TXN-2002 | explained 90% | Captured Friday, posted Monday — a 2.3-day calendar gap that is one business day. |
| TXN-2003 | matched 90% | Clean, with a signed delivery. |
| TXN-2004 | **flagged 52%** | Two captures against one order. Reconciles perfectly against the bank — visible only against the order total. |
| TXN-2005 | explained 93% | A $40 refund authorised but not yet drawn. The bank is right; the ledger is ahead. |
| TXN-2006 | matched 90% | Amounts agree, but AVS and CVV both failed and it is shipping to an address added after checkout. |
| BNK-2099 | **flagged 6%** | A $55 debit with no internal record of any kind. Nothing to match it to. |

## What Investigate finds

| dispute | outcome | why |
|---|---|---|
| DSP-2001 | **represent, 88%** | Non-receipt claim against a delivery signed for at the order address, AVS and CVV both matching. |
| DSP-2004 | **accept liability, 17%** | Duplicate-charge claim that our own settlement export proves. The evidence that defeats us is ours. |

That second one is the point of the whole project: the honest answer is
sometimes "do not fight this", and it is worth more than a confident wrong one.
