import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Status palette from the dataviz skill's validated reference
        // instance (references/palette.md) - fixed, never themed, same
        // hex in both light and dark since they're mode-invariant by
        // design. "gain"/"gain-dark" split because the skill calls out
        // #0ca30c as too low-contrast for small text on a light surface
        // (3.27:1, under the 4.5:1 text floor) and names #006300 as the
        // light-mode "success text" variant specifically for that case.
        gain: "#006300",
        "gain-dark": "#0ca30c",
        loss: "#d03b3b",
      },
    },
  },
  plugins: [],
};

export default config;
