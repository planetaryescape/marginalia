import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Newsreader", "Georgia", "Times New Roman", "serif"],
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        // Warm parchment palette — editorial, literary feel
        parchment: {
          50: "#faf8f5",
          100: "#f5f0e8",
          200: "#ebe0d0",
          300: "#dcc9ae",
          400: "#c9a986",
          500: "#b89068",
          600: "#a47a56",
          700: "#8a6347",
          800: "#71513d",
          900: "#5d4435",
          950: "#32231b",
        },
        ink: {
          50: "#f6f5f4",
          100: "#e7e5e3",
          200: "#cfcac6",
          300: "#b2aaa3",
          400: "#958a81",
          500: "#7a7068",
          600: "#635a53",
          700: "#514a44",
          800: "#443f3a",
          900: "#3b3733",
          950: "#201d1b",
        },
        // Accent colors for annotation types
        annotation: {
          crossref: "#5b7f95",   // Slate blue — connections
          context: "#7a8f6f",    // Sage green — enrichment
          tension: "#b07050",    // Terracotta — conflict
          question: "#8b7bb0",   // Muted purple — inquiry
        },
      },
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-body": "#3b3733",
            "--tw-prose-headings": "#201d1b",
            "--tw-prose-links": "#5b7f95",
            maxWidth: "65ch",
            lineHeight: "1.8",
            fontSize: "1.125rem",
          },
        },
        dark: {
          css: {
            "--tw-prose-body": "#e7e5e3",
            "--tw-prose-headings": "#f6f5f4",
            "--tw-prose-links": "#7da3b8",
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("tailwindcss-animate")],
};

export default config;
