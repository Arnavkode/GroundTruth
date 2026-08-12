import type { Config } from "tailwindcss";

/**
 * Six deliberate colour tokens + three status hues, in light and dark.
 * See DESIGN_NOTES.md. Values live in app/globals.css.
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Every token is an RGB triplet in a CSS variable, so the opacity
      // modifiers used throughout (bg-matched/[0.06]) keep working and a theme
      // change is a variable swap rather than a class rewrite.
      colors: {
        paper: "rgb(var(--c-paper) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        rule: "rgb(var(--c-rule) / <alpha-value>)",
        signal: "rgb(var(--c-signal) / <alpha-value>)",
        matched: "rgb(var(--c-matched) / <alpha-value>)",
        explained: "rgb(var(--c-explained) / <alpha-value>)",
        flagged: "rgb(var(--c-flagged) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em" }],
      },
      maxWidth: {
        shell: "76rem",
      },
      keyframes: {
        settle: {
          "0%": { opacity: "0", transform: "translateY(3px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
        // Route change: content lifts in as the previous view clears.
        pageIn: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Staggered reveal for lists and card grids.
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Decorative geometry: very slow, very small, never distracting.
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) rotate(0deg)" },
          "50%": { transform: "translate3d(0,-14px,0) rotate(3deg)" },
        },
        driftAlt: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(10px,10px,0) scale(1.035)" },
        },
        // SVG stroke reveal for the hero diagram.
        drawIn: {
          "0%": { strokeDashoffset: "var(--dash, 400)" },
          "100%": { strokeDashoffset: "0" },
        },
        popIn: {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "70%": { transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        sweep: {
          "0%": { transform: "translateX(-110%)" },
          "100%": { transform: "translateX(110%)" },
        },
      },
      animation: {
        settle: "settle 220ms cubic-bezier(0.2, 0.7, 0.3, 1) both",
        pulseDot: "pulseDot 1.1s ease-in-out infinite",
        pageIn: "pageIn 420ms cubic-bezier(0.16, 0.84, 0.30, 1) both",
        riseIn: "riseIn 520ms cubic-bezier(0.16, 0.84, 0.30, 1) both",
        drawIn: "drawIn 1.5s cubic-bezier(0.16, 0.84, 0.30, 1) forwards",
        popIn: "popIn 520ms cubic-bezier(0.2, 1.2, 0.4, 1) both",
        sweep: "sweep 2.4s ease-in-out infinite",
        drift: "none",
        driftAlt: "none",
      },
    },
  },
  plugins: [],
};

export default config;
