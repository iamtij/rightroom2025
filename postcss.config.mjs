/** Tailwind v4 via PostCSS (avoids @tailwindcss/vite import hangs on some setups). */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
