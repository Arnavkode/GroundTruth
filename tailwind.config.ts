import type { Config } from "tailwindcss";

/**
 * Six deliberate color tokens + three status hues. See DESIGN_NOTES.md.
 * Committed light-only palette — this is an ops console, not a consumer app.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FBFAF6",
        surface: "#FFFFFF",
        ink: "#14161A",
        muted: "#5D6570",
        rule: "#E4E0D6",
        signal: "#0F5F55",
        matched: "#2E6F4E",
        explained: "#9A6511",
        flagged: "#A8362C",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
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
      },
      animation: {
        settle: "settle 220ms cubic-bezier(0.2, 0.7, 0.3, 1) both",
        pulseDot: "pulseDot 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
