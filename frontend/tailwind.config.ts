import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutral scale used throughout the app. Deliberately warm-free and
        // near-achromatic so nothing competes with the document content.
        gray: {
          50: "#f9f9f9",
          100: "#ececec",
          200: "#e3e3e3",
          300: "#cdcdcd",
          400: "#b4b4b4",
          500: "#9b9b9b",
          600: "#676767",
          700: "#4e4e4e",
          800: "#333333",
          850: "#262626",
          900: "#171717",
          950: "#0d0d0d",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        chat: "48rem",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-left": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "fade-up": "fade-up 0.2s ease-out",
        "slide-left": "slide-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
