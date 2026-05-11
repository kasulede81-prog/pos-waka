import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        waka: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
          950: "#431407",
        },
      },
      boxShadow: {
        waka: "0 1px 2px rgb(28 25 23 / 0.06), 0 8px 24px rgb(234 88 12 / 0.08)",
        "waka-sm": "0 1px 2px rgb(28 25 23 / 0.05), 0 4px 12px rgb(234 88 12 / 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
