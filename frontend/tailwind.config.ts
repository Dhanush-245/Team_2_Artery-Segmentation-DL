import type { Config } from "tailwindcss";

// Adapted from Codehagen/Prismui tailwind.config.ts (AGPL-3.0).
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // CoroVision semantic tokens (styles/theme.css). They follow the selected design and light/dark mode.
        cv: {
          ink: "var(--theme-ink)",
          muted: "var(--theme-muted)",
          accent: "var(--theme-accent)",
          "on-accent": "var(--theme-on-accent)",
          surface: "var(--theme-surface)",
          canvas: "var(--theme-canvas)",
          line: "var(--theme-line)",
          selected: "var(--theme-selected)",
        },
      },
      fontFamily: {
        cv: "var(--theme-font)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
