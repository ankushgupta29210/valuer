/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6f6', 100: '#d5eae9', 200: '#aed6d4', 300: '#7dbcbb', 400: '#4f9d9f',
          500: '#357f85', 600: '#2a666f', 700: '#25525c', 800: '#1f3f4c', 900: '#182c40', 950: '#0f1c2b',
        },
        accent: { 400: '#5fb58c', 500: '#3f9a75', 600: '#2f7d60' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06)' },
    },
  },
  plugins: [],
};
