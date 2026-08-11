import type { Metadata } from "next";
import { Instrument_Serif, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Groundtruth — transaction resolution",
  description:
    "Resolve what actually happened to a transaction across conflicting records, with an explicit confidence score and evidence-cited reasoning.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-shell px-5 pb-24 sm:px-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-shell flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
        <Link href="/" className="flex min-h-[44px] items-center gap-2">
          <span className="font-display text-2xl leading-none">Groundtruth</span>
          <span className="hidden text-micro uppercase tracking-widest text-muted sm:inline">
            transaction resolver
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Primary">
          <Link
            href="/reconcile"
            className="flex min-h-[44px] items-center rounded px-3 text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Reconcile
          </Link>
          <Link
            href="/investigate"
            className="flex min-h-[44px] items-center rounded px-3 text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Investigate
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex w-full max-w-shell flex-col gap-1 px-5 py-6 text-xs text-muted sm:px-8">
        <p>
          Synthetic fixture data only. No payment processor is integrated; Groundtruth
          resolves evidence about transactions and never moves money.
        </p>
        <p>
          Reasoning runs in mock mode unless a real <code className="font-mono">ANTHROPIC_API_KEY</code>{" "}
          is present, and real calls are rate-limited per IP with a global daily cap.
        </p>
      </div>
    </footer>
  );
}
