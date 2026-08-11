# DESIGN NOTES

The brief asks for core logic over surface polish, and says restrained must not mean generic. The
rule I worked to: **spend the design budget on the evidence trail, and nowhere else.** The score, the
checks and the timeline are the product made legible — everything around them is a quiet frame.

## Typeface

**Geist Sans + Geist Mono**, two variable fonts, self-hosted via the `geist` package — zero external
requests and two files instead of six.

| Role | Face | Why |
|---|---|---|
| Display | **Geist Sans**, 500, `-0.028em` tracking | A grotesque, not a serif, so headlines need negative tracking and a touch of weight to read as display type rather than large body text. That tuning lives in one rule on `.font-display`. |
| Body | **Geist Sans** 400 | Built for interface text: open counters, unambiguous at 13–15px, neutral without being characterless. |
| Numeric / identifiers | **Geist Mono** | Every amount, confidence figure, timestamp and record ID. Same family as the body face, so mono blocks sit in the page rather than on it. |

*The first build paired Instrument Serif with IBM Plex Sans/Mono — six font files across three
families. It looked good and loaded slower than it should have. Geist is the faster, more coherent
call: one type family, two variable files, and the display tuning does the work the serif used to.*

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

## Decorative geometry

The first pass was too sparse — correct restraint, wrong amount of it. The fix was not ornament for
its own sake but *data geometry*: shapes drawn from the vocabulary the product already uses, so the
decoration still reads as belonging to a reconciliation tool.

All of it lives in `components/decor.tsx`. Every piece is `aria-hidden`, `pointer-events-none`,
absolutely positioned inside a clipped `.decor-host`, and never contributes to layout width — the
responsive suite asserts that at all four breakpoints.

| Element | Where | What it is |
|---|---|---|
| `ResolverDiagram` | Landing hero | Five evidence sources converging through the resolver node and fanning into three outcome buckets, with confidence ticks. Literally the product architecture, drawn. Strokes draw themselves in on mount. |
| `BackdropField` | Fixed, whole app | Three soft colour washes (signal / explained / flagged at 5–7% behind a heavy blur), concentric dashed rings, and measurement ticks down the left edge. |
| `ArcCluster` | Section corners, mode cards | Concentric quarter-arcs tinted to the section status colour. Brightens on card hover. |
| `ScatterField` | Page headers | Plotted marks with a dashed trend line — transactions scattered against a period. |
| `ConfidenceDial` | Explainer panels | A half-dial with the 60% flag threshold ticked, echoing the real confidence meter. |
| `.grid-paper` | Hero, empty states | A 34px measurement grid at 4.5% opacity, masked so it fades rather than ending on a seam. |

The wordmark is a small glyph of the same idea: three coloured strands resolving to one point.

## Filling the empty states

Both mode pages used to be one sentence of grey text before you pressed anything. They now show what
is *about* to happen:

- **Reconcile** — a queued ledger of skeleton rows with a sweeping shimmer, plus the six sources it
  will read and the three buckets it sorts into.
- **Investigate** — the four-stage pipeline a dispute goes through (assemble → resolve → weigh →
  draft), a win-likelihood dial with the recommendation bands, and why the score caps at 88%.

## Motion

Motion is used in four places, each reporting a state change:

1. `pageIn` (420ms) — route transitions. The subtree is keyed on `usePathname`, so moving between
   Reconcile and Investigate lifts and fades the new view in rather than hard-swapping it. The
   header active-route underline scales in from the left over 300ms.
2. `riseIn` (520ms, staggered 60–80ms) — cards and list items arriving in a grid.
3. `settle` (220ms) — rows landing as they arrive on the SSE stream.
4. `drawIn` / `popIn` — the hero diagram assembling itself: strands draw, then nodes pop, then the
   confidence ticks appear.

Plus two ambient loops that are deliberately near-imperceptible: the backdrop washes drift 14px over
22–28 seconds, and skeleton rows shimmer while queued.

Nothing bounces, nothing slides in from off-screen, and no motion runs longer than ~520ms except the
ambient drift. `prefers-reduced-motion: reduce` drops every animation and transition to 0.01ms.

## Performance

The first build was noticeably laggy. Four causes, all fixed:

| Cause | Fix |
|---|---|
| Three `blur-3xl` layers (64px blur over ~900px boxes) with infinite transform animations | Replaced with soft radial gradients painted once. Same look, no filter, no compositing, no per-frame rasterisation. This was the big one. |
| `backdrop-blur-md` on the sticky header, repainting over those blurs every scroll frame | Solid `bg-paper`. |
| Six font files across three families, fetched from Google | Two self-hosted variable fonts (`geist`). Zero external font requests. |
| A full reconcile run paced at ~28 seconds | Split pacing: batch runs at 14/22/90ms per step, single Investigate cases keep the slower 70/100/320ms cadence because there the trace is the thing you read. **Reconcile now completes in ~6.0s, Investigate in ~1.9s.** |

Row components that re-render on every streamed event (`CheckRow`, `CitationTag`, `SourcePip`,
`Timeline`) are memoised, so a 217-event reconcile run does not re-render every row on every tick.

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
