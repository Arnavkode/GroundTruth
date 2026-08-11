import Link from "next/link";

export default function Home() {
  return (
    <div className="py-16 sm:py-24">
      <section className="max-w-3xl">
        <p className="text-micro uppercase tracking-widest text-signal">
          Reconciliation under uncertainty
        </p>
        <h1 className="mt-3 font-display text-5xl leading-[1.05] sm:text-7xl">
          What actually happened
          <br />
          to this transaction?
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          Groundtruth resolves what really occurred across messy, conflicting records of a
          payment — a settlement feed, an order record, a shipment tracker, a support chat log —
          and says so with an explicit confidence score and a plain-English explanation. When the
          evidence genuinely conflicts, it says that too, rather than forcing an answer.
        </p>
      </section>

      <section className="mt-14 grid gap-5 md:grid-cols-2">
        <ModeCard
          href="/reconcile"
          eyebrow="Reconcile"
          title="Bank statement against settlement report"
          body="Sixteen units run through the resolver and land in three buckets: cleanly matched, matched with a named cause for the difference, or flagged for a person. Fee deductions, weekend posting lags, currency rounding and in-flight refunds resolve themselves; a duplicate capture and an unattributable credit do not."
          stat="16 units · 3 buckets"
        />
        <ModeCard
          href="/investigate"
          eyebrow="Investigate"
          title="One chargeback, all the evidence"
          body="Pick a dispute. Every fragment — order, shipment scan, support transcript, settlement record — assembles into one timeline marked for and against the cardholder's claim, then a second-stage agent drafts the representment with a win-likelihood score built from the same weighted evidence."
          stat="4 disputes · 2 worth fighting"
        />
      </section>

      <section className="mt-20 border-t border-rule pt-10">
        <h2 className="font-display text-3xl">How the confidence score is built</h2>
        <div className="mt-6 grid gap-8 md:grid-cols-3">
          <Step
            n="01"
            title="Deterministic checks first"
            body="Amounts against the published fee schedule, posting windows in business days rather than calendar days, FX rounding tolerance, ID linkage, capture totals against order totals. Each check carries a log-odds weight rather than a pass/fail."
          />
          <Step
            n="02"
            title="Then the evidence nobody can parse"
            body="A reasoning step reads the support transcripts and carrier notes — does this chat log corroborate the claim or contradict it? It can move the score, but it cannot override the arithmetic that produced it."
          />
          <Step
            n="03"
            title="Capped by what the evidence supports"
            body="Confidence is capped by how many sources exist, and hard-capped at 40% when a transaction is not uniquely identifiable. Below 60% the resolver flags instead of resolving. It never claims more than 97%."
          />
        </div>
      </section>

      <section className="mt-16 rounded-lg border border-rule bg-surface px-6 py-6">
        <h2 className="font-display text-2xl">Running in mock mode</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          No Anthropic API key is present, so the reasoning step is served from hand-written
          per-case analysis rather than a live model, streamed with the same pacing and structure
          real mode uses. Every deterministic check, confidence score and bucket assignment you see
          is computed live from the fixture data either way. Adding a real key flips the reasoning
          step over with no code change, behind a per-IP rate limit and a global daily cap that both
          fail back to mock rather than erroring.
        </p>
      </section>
    </div>
  );
}

function ModeCard({
  href,
  eyebrow,
  title,
  body,
  stat,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  stat: string;
}) {
  return (
    <Link
      href={href}
      className="card group flex flex-col px-6 py-6 transition-colors hover:border-ink/25"
    >
      <span className="text-micro uppercase tracking-widest text-signal">{eyebrow}</span>
      <h2 className="mt-2 font-display text-3xl leading-tight">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
      <span className="mt-5 flex items-baseline justify-between border-t border-rule pt-4">
        <span className="tnum font-mono text-xs text-muted">{stat}</span>
        <span className="text-sm text-signal transition-transform group-hover:translate-x-0.5">
          Open →
        </span>
      </span>
    </Link>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <span className="tnum font-mono text-xs text-signal">{n}</span>
      <h3 className="mt-2 text-base font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
