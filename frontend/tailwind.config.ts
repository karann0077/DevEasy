import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "slate-950": "#020617",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 3s linear infinite",
      },
      boxShadow: {
        "cyan-glow": "0 0 15px rgba(6,182,212,0.3)",
        "indigo-glow": "0 0 15px rgba(99,102,241,0.3)",
        "green-glow": "0 0 15px rgba(16,185,129,0.3)",
      },
    },
  },
  plugins: [],
};
export default config;