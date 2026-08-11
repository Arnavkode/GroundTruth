"use client";

import { usePathname } from "next/navigation";

/**
 * Route transition.
 *
 * Keying on the pathname remounts the subtree on every navigation, replaying
 * the `pageIn` animation — a short lift-and-fade so moving between Reconcile
 * and Investigate reads as a change of view rather than a hard swap.
 * `prefers-reduced-motion` collapses it to ~0ms via the global rule.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-pageIn">
      {children}
    </div>
  );
}

/** Active-route indicator for the header nav. */
export function NavLinkIndicator({ href }: { href: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <span
      className={`absolute inset-x-3 -bottom-px h-px origin-left bg-signal transition-transform duration-300 ${
        active ? "scale-x-100" : "scale-x-0"
      }`}
      aria-hidden
    />
  );
}
