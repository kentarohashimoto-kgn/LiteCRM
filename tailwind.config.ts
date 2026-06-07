import type { Config } from "tailwindcss";

/**
 * CATORCE 提案書デザインガイドに基づくカラーパレット。
 * 配色比率の目安: 白・グレー 70% / ティール 20% / オレンジ 10%
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: "#008C8C", // Primary Teal
          primary: "#008C8C",
          deep: "#006C6A", // Deep Teal
          light: "#DDF3F0", // Light Teal
        },
        accent: {
          DEFAULT: "#F59A2A", // Accent Orange
          orange: "#F59A2A",
        },
        ink: {
          DEFAULT: "#273A3A", // Dark Gray
          dark: "#273A3A",
        },
        mist: {
          DEFAULT: "#F4F6F6", // Soft Gray
          soft: "#F4F6F6",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "Meiryo",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(39, 58, 58, 0.04), 0 4px 16px rgba(39, 58, 58, 0.06)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
    },
  },
  plugins: [],
};

export default config;
