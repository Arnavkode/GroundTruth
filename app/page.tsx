import Link from "next/link";
import { ArcCluster, ConfidenceDial, ResolverDiagram, ScatterField } from "@/components/decor";

const HARD_CASES = [
  {
    ref: "TXN-1006",
    tone: "flagged",
    title: "Duplicate capture",
    body: "Reconciles perfectly against the bank — $145.04 in, $145.04 settled. Only visible by comparing captures to the order total.",
    score: "92%",
  },
  {
    ref: "TXN-1007A/B",
    tone: "flagged",
    title: "Two identical claimants",
    body: "One unlabelled credit, two customers who bought the same bench 13 minutes apart. Refused rather than coin-flipped.",
    score: "40%",
  },
  {
    ref: "TXN-1003",
    tone: "explained",
    title: "Weekend posting lag",
    body: "A 2.5-day calendar gap that is one business day. Looks late to a calendar-day monitor; isn't.",
    score: "92%",
  },
  {
    ref: "TXN-1004",
    tone: "explained",
    title: "Currency rounding",
    body: "Two cents on a EUR→USD settlement. Inside a 13-cent tolerance, and exactly what independent rounding produces.",
    score: "92%",
  },
  {
    ref: "TXN-1012",
    tone: "flagged",
    title: "Unexplained shortfall",
    body: "$12.40 gone. Not the fee, not FX, not a refund, not timing — each ruled out by a record rather than merely doubted.",
    score: "84%",
  },
  {
    ref: "BNK-009",
    tone: "flagged",
    title: "Orphan bank debit",
    body: "$31.20 left the account and no internal system recorded why. Left unattributed on purpose.",
    score: "20%",
  },
];

const TONE: Record<string, string> = {
  matched: "text-matched border-matched/30 bg-matched/[0.05]",
  explained: "text-explained border-explained/30 bg-explained/[0.06]",
  flagged: "text-flagged border-flagged/30 bg-flagged/[0.05]",
};

export default function Home() {
  return (
    <div className="pb-8">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="decor-host grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20">
        <div
          className="decor inset-y-0 right-0 hidden w-1/2 grid-paper opacity-60 lg:block"
          style={{
            WebkitMaskImage: "linear-gradient(to right, transparent, black 45%)",
            maskImage: "linear-gradient(to right, transparent, black 45%)",
          }}
        />
        <div className="above">
          <p className="text-micro uppercase tracking-widest text-signal">
            Reconciliation under uncertainty
          </p>
          <h1 className="mt-3 font-display text-5xl leading-[1.03] sm:text-6xl xl:text-7xl">
            What actually happened
            <br />
            to this transaction?
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Groundtruth resolves what really occurred across messy, conflicting records of a
            payment — a settlement feed, an order record, a shipment tracker, a support chat log —
            and says so with an explicit confidence score and a plain-English explanation. When the
            evidence genuinely conflicts, it says that too, rather than forcing an answer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/reconcile" className="btn-primary">
              Run a reconciliation
            </Link>
            <Link href="/investigate" className="btn-quiet">
              Investigate a dispute
            </Link>
          </div>
        </div>

        <div className="above animate-riseIn" style={{ animationDelay: "120ms" }}>
          <ResolverDiagram className="h-auto w-full max-w-[36rem]" />
        </div>
      </section>

      {/* ── Figures strip ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-4">
        {[
          ["16", "reconciliation units"],
          ["6", "evidence sources"],
          ["3", "outcome buckets"],
          ["4", "open disputes"],
        ].map(([n, label], i) => (
          <div
            key={label}
            className="animate-riseIn bg-surface px-5 py-6"
            style={{ animationDelay: `${180 + i * 70}ms` }}
          >
            <p className="tnum font-mono text-4xl text-signal">{n}</p>
            <p className="mt-1 text-xs uppercase tracking-widest text-muted">{label}</p>
          </div>
        ))}
      </section>

      {/* ── Two modes ────────────────────────────────────────────────────── */}
      <section className="mt-6 grid gap-5 md:grid-cols-2">
        <ModeCard
          href="/reconcile"
          eyebrow="Reconcile"
          title="Bank statement against settlement report"
          body="Sixteen units run through the resolver and land in three buckets. Fee deductions, weekend posting lags, currency rounding and in-flight refunds resolve themselves; a duplicate capture and an unattributable credit do not."
          stat="16 units · 3 buckets"
          accent="matched"
        />
        <ModeCard
          href="/investigate"
          eyebrow="Investigate"
          title="One chargeback, all the evidence"
          body="Every fragment — order, shipment scan, support transcript, settlement record — assembles into one timeline marked for and against the cardholder, then a second-stage agent drafts the representment with a win-likelihood score."
          stat="4 disputes · 2 worth fighting"
          accent="flagged"
        />
      </section>

      {/* ── How the score is built ───────────────────────────────────────── */}
      <section className="decor-host mt-20 border-t border-rule pt-12">
        <ArcCluster className="decor -left-16 top-4 h-64 w-64 opacity-70" />
        <div className="above grid gap-10 lg:grid-cols-[1fr_18rem]">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl">How the confidence score is built</h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              Not a vibe. Every check contributes a signed log-odds weight, and the number you see is
              the arithmetic those weights produce — then capped by what the evidence can actually
              support.
            </p>
            <div className="mt-8 grid gap-8 sm:grid-cols-3">
              <Step
                n="01"
                title="Deterministic checks first"
                body="Amounts against the published fee schedule, posting windows in business days rather than calendar days, FX rounding tolerance, ID linkage, capture totals against order totals."
              />
              <Step
                n="02"
                title="Then the evidence nobody can parse"
                body="A reasoning step reads the support transcripts and carrier notes — does this chat log corroborate the claim or contradict it? It can move the score, not override it."
              />
              <Step
                n="03"
                title="Capped by what's available"
                body="Capped by how many sources exist, and hard-capped at 40% when a transaction is not uniquely identifiable. Below 60% it flags. It never claims more than 97%."
              />
            </div>
          </div>

          <aside className="card flex flex-col justify-center px-6 py-7">
            <ConfidenceDial className="mx-auto h-auto w-40" value={0.84} />
            <p className="mt-3 text-center text-micro uppercase tracking-widest text-muted">
              tick marks the 60% flag threshold
            </p>
            <dl className="mt-6 space-y-2 border-t border-rule pt-5 text-sm">
              {[
                ["Ceiling", "97%"],
                ["Flag below", "60%"],
                ["Ambiguity cap", "40%"],
                ["Floor", "5%"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="tnum font-mono">{v}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      {/* ── Hard cases ───────────────────────────────────────────────────── */}
      <section className="mt-20 border-t border-rule pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl">The cases that are actually hard</h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              The fixtures are built so each difficult case is difficult for a{" "}
              <em>different</em> reason. Two of them the resolver refuses to answer.
            </p>
          </div>
          <ScatterField className="hidden h-24 w-[21rem] opacity-90 lg:block" />
        </div>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HARD_CASES.map((c, i) => (
            <li
              key={c.ref}
              className="card animate-riseIn flex flex-col px-5 py-5"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-muted">{c.ref}</span>
                <span className={`chip ${TONE[c.tone]}`}>{c.score}</span>
              </div>
              <h3 className="mt-3 text-base font-medium">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-rule bg-surface px-5 py-4">
          <span className="text-sm text-muted">Resolved live from the fixtures, every run:</span>
          <span className="flex flex-wrap gap-2">
            <span className={`chip ${TONE.matched}`}>6 matched</span>
            <span className={`chip ${TONE.explained}`}>5 explained</span>
            <span className={`chip ${TONE.flagged}`}>5 flagged</span>
          </span>
        </div>
      </section>

      {/* ── Mock mode ────────────────────────────────────────────────────── */}
      <section className="decor-host mt-20 rounded-lg border border-rule bg-surface px-6 py-8 sm:px-8">
        <ArcCluster
          className="decor -right-12 -top-10 h-56 w-56 rotate-180 opacity-60"
          tone="#9A6511"
        />
        <div className="above max-w-3xl">
          <span className="chip border-rule bg-paper text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-muted/50" aria-hidden />
            mock reasoning
          </span>
          <h2 className="mt-4 font-display text-2xl sm:text-3xl">Running in mock mode</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            No Anthropic API key is present, so the reasoning step is served from hand-written
            per-case analysis rather than a live model, streamed with the same pacing and structure
            real mode uses. Every deterministic check, confidence score and bucket assignment you see
            is computed live from the fixture data either way. Adding a real key flips the reasoning
            step over with no code change, behind a per-IP rate limit and a global daily cap that
            both fail back to mock rather than erroring.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Every resolution shows its provenance in the UI, so live and canned reasoning are never
            confused for one another.
          </p>
        </div>
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
  accent,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  stat: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="card decor-host group flex flex-col px-6 py-7 transition-all duration-300 hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-[0_12px_30px_-24px_rgba(20,22,26,0.5)]"
    >
      <ArcCluster
        className={`decor -bottom-10 -right-10 h-40 w-40 rotate-180 opacity-50 transition-opacity duration-300 group-hover:opacity-100 ${
          accent === "flagged" ? "" : ""
        }`}
        tone={accent === "flagged" ? "#A8362C" : "#2E6F4E"}
      />
      <span className="above text-micro uppercase tracking-widest text-signal">{eyebrow}</span>
      <h2 className="above mt-2 font-display text-3xl leading-tight">{title}</h2>
      <p className="above mt-3 text-sm leading-relaxed text-muted">{body}</p>
      <span className="above mt-6 flex items-baseline justify-between border-t border-rule pt-4">
        <span className="tnum font-mono text-xs text-muted">{stat}</span>
        <span className="text-sm text-signal transition-transform duration-300 group-hover:translate-x-1">
          Open →
        </span>
      </span>
    </Link>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="border-l-2 border-rule pl-4">
      <span className="tnum font-mono text-xs text-signal">{n}</span>
      <h3 className="mt-2 text-base font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
