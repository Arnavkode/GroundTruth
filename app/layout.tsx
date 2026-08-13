import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import { BackdropField } from "@/components/decor";
import { NavLinkIndicator, PageTransition } from "@/components/PageTransition";
import { ThemeToggle, themeBootScript } from "@/components/theme";
import { dailyCap, FREE_TIER, perIpLimit, perRunLimit } from "@/lib/ratelimit";
import "./globals.css";

export const metadata: Metadata = {
  title: "Groundtruth — transaction resolution",
  description:
    "Resolve what actually happened to a transaction across conflicting records, with an explicit confidence score and evidence-cited reasoning.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applied before first paint so the theme never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <BackdropField />
        <SiteHeader />
        <main id="main" className="relative mx-auto w-full max-w-shell px-5 pb-24 sm:px-8">
          <PageTransition>{children}</PageTransition>
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper">
      <div className="mx-auto flex w-full max-w-shell flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
        <Link href="/" className="group flex min-h-[44px] items-center gap-2.5">
          <Mark />
          <span className="font-display text-2xl leading-none">Groundtruth</span>
          <span className="hidden text-micro uppercase tracking-widest text-muted sm:inline">
            transaction resolver
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Primary">
          {[
            { href: "/reconcile", label: "Reconcile" },
            { href: "/investigate", label: "Investigate" },
            { href: "/how-it-works", label: "How it works" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative flex min-h-[44px] items-center rounded px-3 text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              {l.label}
              <NavLinkIndicator href={l.href} />
            </Link>
          ))}
          <span className="mx-1 h-5 w-px bg-rule" aria-hidden />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

/** Wordmark glyph: three evidence strands resolving to one point. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" stroke="rgb(var(--c-signal))" strokeOpacity="0.3" />
      <path d="M3 6 C 10 6 10 12 12 12" stroke="rgb(var(--c-matched))" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 12 H 12" stroke="rgb(var(--c-explained))" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 18 C 10 18 10 12 12 12" stroke="rgb(var(--c-flagged))" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.5" fill="rgb(var(--c-signal))" />
    </svg>
  );
}

function SiteFooter() {
  return (
    <footer className="relative mt-8 border-t border-rule bg-surface/60">
      <div className="mx-auto grid w-full max-w-shell gap-6 px-5 py-10 sm:px-8 md:grid-cols-3">
        <div>
          <p className="font-display text-xl">Groundtruth</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            One resolver, two workflows. Reconciliation and dispute defence treated as the same
            problem: establishing what happened from incomplete, conflicting sources.
          </p>
        </div>
        <div>
          <p className="text-micro uppercase tracking-widest text-muted">Guardrails</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
            <li>Synthetic fixture data only.</li>
            <li>
              No payment processor is integrated — Groundtruth resolves evidence and never moves
              money.
            </li>
            <li>
              Reasoning runs in mock mode unless a real{" "}
              <code className="font-mono">GEMINI_API_KEY</code> is present. The free tier has no
              billing account behind it, so there is no spend to run away with.
            </li>
          </ul>
        </div>
        <div>
          <p className="text-micro uppercase tracking-widest text-muted">Spend limits</p>
          <dl className="mt-2 space-y-1.5 text-xs text-muted">
            {[
              ["Per IP, per hour", `${perIpLimit()} live calls`],
              ["Global daily cap", `${dailyCap()} live calls`],
              ["Provider free tier", `${FREE_TIER.rpd} calls/day`],
              ["Live calls per run", `${perRunLimit()} max`],
              ["Tokens per call", "1,200 max"],
              ["On exhaustion", "falls back to mock"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-rule/70 pb-1.5">
                <dt>{k}</dt>
                <dd className="tnum font-mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </footer>
  );
}
