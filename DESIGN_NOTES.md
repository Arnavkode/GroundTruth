# DESIGN NOTES

The brief asks for core logic over surface polish, and says restrained must not mean generic. The
rule I worked to: **spend the design budget on the evidence trail, and nowhere else.** The score, the
checks and the timeline are the product made legible — everything around them is a quiet frame.

## Typeface pairing

| Role | Face | Why |
|---|---|---|
| Display | **Instrument Serif** 400 | A serif with actual character in the headline sizes — it reads considered rather than defaulted, and it stops the app looking like a Tailwind template. Used only for page and section headings. |
| Body | **IBM Plex Sans** 400/500/600 | Designed for technical interfaces: open counters, unambiguous at 13–15px, humanist enough not to feel cold. |
| Numeric / identifiers | **IBM Plex Mono** 400/500 | Every amount, confidence figure, timestamp and record ID. Same family as the body face, so the mono blocks sit in the page rather than on it. |

Tabular numerals (`.tnum`) on every figure that appears in a column — amounts, deltas, percentages —
so digits align down the page.

## Colour — six tokens, three of them status

```
paper    #FBFAF6   page ground, warm off-white
surface  #FFFFFF   cards and raised rows
ink      #14161A   primary text
muted    #5D6570   secondary text
rule     #E4E0D6   hairlines — the main structural device
signal   #0F5F55   the one accent: source labels, links, primary action

matched   #2E6F4E  green
explained #9A6511  amber
flagged   #A8362C  red
```

The three status hues are the only saturated colour in the interface and they are never used
decoratively — a green in this app always means "sources agree". Backgrounds use them at 6–8% so a
bucket reads as tinted paper rather than a coloured block.

**Light only, deliberately.** One palette executed properly beats two half-done.

## Structure

- Hairline rules do the dividing. Almost no shadows, no nested cards.
- Spacing on a 4px base; vertical rhythm from a small set of steps (`mt-4 / 7 / 10 / 20`).
- Container caps at 76rem. Detail views split 1.35fr / 1fr — argument on the left, score and
  timeline on the right.
- `text-micro` (11px, uppercase, 0.06em tracking) is the label voice throughout: source names,
  section eyebrows, provenance tags. One consistent register for metadata.

## The evidence trail — where the effort went

**Check rows.** Each check gets a circular glyph carrying its outcome: `✓` agree, `≈` explained,
`✕` conflict, `○` missing. Four states, one shape, colour-coded to the status palette — so you can
scan a resolution's shape before reading a word. Colour is never the only signal; the glyph and the
`title` carry it too.

**Citation tags.** Every claim the resolver makes ends in a row of tags: source name in signal
colour, record ID in mono, the value or quote in muted text. This is the load-bearing detail — it is
what makes "the $2.88 gap is the processing fee" checkable rather than assertable.

**The confidence meter** draws the 60% flag threshold as a vertical tick inside the bar. A 62% and a
58% are different decisions, and a bare percentage hides how close the call was. The bar animates to
width over 700ms — a value settling into place, which is the one moment in the app where motion
tells you something.

**The timeline** colours its left border by stance in Investigate: green for records the rebuttal
engine weighed for the merchant, red for against, hairline for neutral. Same encoding as the buckets,
so it needs no second legend.

**The rebuttal factor bars** are diverging from a centre line, positive right and negative left,
scaled to the largest absolute weight. They are the derivation of the win-likelihood number, not an
illustration of it.

## Motion

Two things move, both because a state changed:

1. `settle` (220ms) — rows fading up 3px as they arrive on the stream.
2. `pulseDot` — a three-dot pulse while the reasoning step runs.

No page-load choreography. `prefers-reduced-motion: reduce` drops every animation and transition to
0.01ms.

## Accessibility

- Visible focus ring (2px signal, 2px offset) on everything focusable; never removed.
- Skip-to-content link, visually hidden until focused.
- All touch targets ≥ 44px — verified at 375px, and this caught a real 36px nav bug.
- The confidence meter is a `role="meter"` with proper `aria-value*`.
- Live regions on both streaming panels so the trace is announced.
- Status is never colour-alone: glyph, label text and colour together.

## Copy

Plain, specific, exact. "3 transactions flagged — insufficient evidence to resolve automatically",
never "Uh oh!". Buckets are labelled for what they mean operationally: *Sources agree. No action.* /
*Differs, and the difference has a named cause.* / *Not resolved. A person needs to look.*
