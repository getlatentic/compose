import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f6f1",
        ink: "#20211f",
        muted: "#706d66",
        line: "#d8d4c8",
        moss: "#4b6b4f",
        copper: "#a85f35",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [typography],
} satisfies Config;
