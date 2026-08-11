/**
 * "The problem" section.
 *
 * Uses a real fixture case (TXN-1006) rather than an invented illustration:
 * five systems watched one $75 kettle purchase and wrote down five different
 * things, and the bank — the system everyone reconciles against — is the one
 * that says it is fine.
 */

const RECORDS = [
  {
    system: "Order system",
    says: "One order. One kettle. $75.00.",
    value: "$75.00",
    verdict: "ok" as const,
  },
  {
    system: "Settlement ledger",
    says: "Two captures, 47 seconds apart.",
    value: "$150.00",
    verdict: "bad" as const,
  },
  {
    system: "Bank statement",
    says: "Two credits totalling the settled net.",
    value: "$145.04",
    verdict: "trap" as const,
  },
  {
    system: "Warehouse",
    says: "One kettle shipped, delivered 9 March.",
    value: "1 unit",
    verdict: "ok" as const,
  },
  {
    system: "Support log",
    says: '"The page hung when I clicked pay so I clicked again."',
    value: "day of",
    verdict: "bad" as const,
  },
];

const MARK = {
  ok: { glyph: "✓", cls: "text-matched border-matched/40 bg-matched/[0.08]", label: "consistent" },
  bad: { glyph: "✕", cls: "text-flagged border-flagged/40 bg-flagged/[0.08]", label: "contradicts" },
  trap: {
    glyph: "≈",
    cls: "text-explained border-explained/40 bg-explained/[0.08]",
    label: "looks fine, isn't",
  },
};

export function ConflictBoard() {
  return (
    <figure className="card decor-host overflow-hidden">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-3">
        <span className="text-micro uppercase tracking-widest text-muted">
          One transaction, as five systems recorded it
        </span>
        <span className="font-mono text-xs text-muted">TXN-1006 · 4 March 2026</span>
      </figcaption>

      <ul className="divide-y divide-rule">
        {RECORDS.map((r, i) => {
          const m = MARK[r.verdict];
          return (
            <li
              key={r.system}
              className="animate-riseIn flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:flex-nowrap"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${m.cls}`}
                title={m.label}
              >
                <span aria-hidden>{m.glyph}</span>
                <span className="sr-only">{m.label}</span>
              </span>
              <span className="w-36 shrink-0 text-sm font-medium">{r.system}</span>
              <span className="min-w-0 flex-1 text-sm leading-relaxed text-muted">{r.says}</span>
              <span className="tnum ml-auto shrink-0 font-mono text-sm">{r.value}</span>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-rule bg-paper px-5 py-4">
        <p className="text-sm leading-relaxed">
          <span className="text-flagged">The cardholder was charged twice.</span>{" "}
          <span className="text-muted">
            And the bank statement — the system every reconciliation is run against — balances to the
            cent. $145.04 credited against $145.04 settled. An amount-only reconciliation passes this
            straight through.
          </span>
        </p>
      </div>
    </figure>
  );
}

const DIFFICULTIES = [
  {
    n: "01",
    title: "Most differences are legitimate",
    body:
      "Processing fees, currency rounding, weekend posting lags, partial captures, refunds still in flight. A naive diff flags all of them, so the exception queue fills with noise and people stop reading it.",
  },
  {
    n: "02",
    title: "The ones that matter hide inside the ones that don't",
    body:
      "A duplicate capture can reconcile to the cent. A delivery scan can say 'delivered' to the wrong postcode. The signal isn't a number that doesn't match — it's a story that doesn't hold together.",
  },
  {
    n: "03",
    title: "Sometimes there is no answer",
    body:
      "Two customers, the same amount, thirteen minutes apart, one unlabelled bank credit. A tool that always returns a match will confidently record one of them as paid when they may not be. That is worse than an open item.",
  },
];

export function WhyItsHard() {
  return (
    <div className="grid gap-8 sm:grid-cols-3">
      {DIFFICULTIES.map((d, i) => (
        <div
          key={d.n}
          className="animate-riseIn border-t-2 border-rule pt-4"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <span className="tnum font-mono text-xs text-signal">{d.n}</span>
          <h3 className="mt-2 text-base font-medium leading-snug">{d.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{d.body}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The answer, stated as a contrast: what a rule engine does vs what resolving
 * from evidence does. Two columns, deliberately parallel.
 */
export function TheAnswer() {
  const rows: [string, string][] = [
    ["Compares two numbers", "Reconstructs what happened from every source that saw it"],
    ["Flags anything that differs", "Names the cause when a difference is legitimate"],
    ["Passes anything that matches", "Catches a duplicate that balances to the cent"],
    ["Returns a match or an exception", "Returns a confidence score, and refuses below 60%"],
    ["Tells you a row is wrong", "Tells you which record proves it, and what to do next"],
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-2">
      <div className="bg-paper px-5 py-4">
        <p className="text-micro uppercase tracking-widest text-muted">A rule engine</p>
      </div>
      <div className="bg-surface px-5 py-4">
        <p className="text-micro uppercase tracking-widest text-signal">Groundtruth</p>
      </div>
      {rows.map(([a, b], i) => (
        <div key={i} className="contents">
          <div className="flex items-start gap-3 bg-paper px-5 py-3.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted/40" aria-hidden />
            <span className="text-sm leading-relaxed text-muted">{a}</span>
          </div>
          <div className="flex items-start gap-3 bg-surface px-5 py-3.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-hidden />
            <span className="text-sm leading-relaxed">{b}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
