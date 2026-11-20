/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Le Bouquiniste — the green boxes along the Seine: bottle green, cream paper,
        // vermilion price stickers, mustard highlights.
        bg: token("bg"),
        surface: token("surface"),
        ink: token("ink"),
        soft: token("soft"),
        line: token("line"),
        stall: token("stall"),
        "stall-deep": token("stall-deep"),
        tomato: token("tomato"),
        mustard: token("mustard"),
        seine: token("seine"),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
        sans: ['"Figtree"', "system-ui", "sans-serif"],
        read: ['"Literata"', "Georgia", "serif"],
      },
      boxShadow: {
        stamp: "3px 3px 0 0 rgb(var(--ink) / 0.9)",
        "stamp-sm": "2px 2px 0 0 rgb(var(--ink) / 0.85)",
        "stamp-lg": "6px 6px 0 0 rgb(var(--ink) / 0.9)",
        lift: "0 14px 30px -12px rgb(0 0 0 / 0.35)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pop: {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        rise: "rise 0.45s cubic-bezier(.2,.8,.2,1) both",
        shimmer: "shimmer 1.6s linear infinite",
        pop: "pop 0.18s ease-out both",
      },
    },
  },
  plugins: [],
};
