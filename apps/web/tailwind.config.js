/**
 * Valeur design system — ported from the valeurcredit.com token set.
 * Colours are oklch, matching the marketing site's shadcn variables exactly
 * where a token exists there (marked ★); intermediate steps are interpolated
 * so the existing utility classes across the app re-skin coherently.
 */

/** oklch colour that still supports Tailwind's `/opacity` modifiers. */
const ok = (l, c, h) => ({ opacityValue }) =>
  opacityValue === undefined ? `oklch(${l}% ${c} ${h})` : `oklch(${l}% ${c} ${h} / ${opacityValue})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm paper, not cold white. ★ --card
        white: ok(99.5, 0.008, 95),

        // Neutrals run warm (sand → brown) and resolve to a green-black ink,
        // exactly as the site does: ★ --muted-foreground is brown, ★ --foreground is green.
        slate: {
          50: ok(96.8, 0.018, 90), // ★ --background
          100: ok(94.5, 0.02, 88), // ★ --muted
          200: ok(89.5, 0.025, 82), // ★ --border
          300: ok(82, 0.028, 78),
          400: ok(66, 0.03, 70),
          500: ok(50, 0.03, 62), // ★ --muted-foreground
          600: ok(42, 0.035, 60),
          700: ok(34, 0.04, 58),
          800: ok(30, 0.045, 60), // ★ --card-foreground
          900: ok(27, 0.045, 145), // ★ --foreground
          950: ok(20, 0.055, 145), // ★ --forest-deep
        },

        // Brand = forest green.
        brand: {
          50: ok(96, 0.015, 145),
          100: ok(92, 0.03, 145),
          200: ok(85, 0.05, 145),
          300: ok(75, 0.08, 145),
          400: ok(62, 0.12, 145), // ★ --forest-light
          500: ok(55, 0.11, 145), // ★ --ring
          600: ok(48, 0.105, 145),
          700: ok(42, 0.1, 145), // ★ --forest
          800: ok(34, 0.085, 145), // ★ --primary
          900: ok(26, 0.065, 145),
          950: ok(20, 0.055, 145), // ★ --forest-deep
        },

        // Accent = gold.
        accent: {
          300: ok(86, 0.15, 90), // ★ --gold-bright
          400: ok(82, 0.14, 87),
          500: ok(79, 0.13, 85), // ★ --gold / --accent
          600: ok(72, 0.13, 82),
          700: ok(62, 0.12, 78),
        },
        amber: {
          50: ok(96, 0.03, 90),
          200: ok(89, 0.07, 88),
          300: ok(86, 0.15, 90), // ★ --gold-bright
          700: ok(58, 0.11, 76),
          800: ok(45, 0.09, 70),
          900: ok(30, 0.06, 62),
        },

        // Destructive = warm terracotta, ★ --destructive.
        red: {
          50: ok(96, 0.015, 40),
          200: ok(88, 0.05, 40),
          400: ok(68, 0.12, 40),
          500: ok(62, 0.15, 40),
          600: ok(56, 0.15, 40), // ★ --destructive
          700: ok(48, 0.14, 40),
          800: ok(38, 0.11, 40),
          900: ok(28, 0.08, 40),
        },

        // Success, ★ --success.
        emerald: {
          50: ok(95, 0.02, 155),
          200: ok(86, 0.05, 155),
          500: ok(68, 0.09, 155),
          600: ok(62, 0.09, 155), // ★ --success
          700: ok(52, 0.085, 155),
          800: ok(40, 0.07, 155),
          900: ok(30, 0.055, 155),
        },

        // The one remaining cold hue in the app (purple badge tone) — warmed
        // to the site's ★ --brown-deep family so nothing reads as off-palette.
        violet: {
          50: ok(95, 0.02, 60),
          800: ok(32, 0.055, 55),
        },

        // Named tokens for new work.
        gold: { DEFAULT: ok(79, 0.13, 85), bright: ok(86, 0.15, 90) },
        forest: { DEFAULT: ok(42, 0.1, 145), light: ok(62, 0.12, 145), deep: ok(20, 0.055, 145) },
        brown: { deep: ok(22, 0.045, 55) },
        sidebar: {
          DEFAULT: ok(22, 0.055, 145),
          foreground: ok(93, 0.02, 88),
          accent: ok(30, 0.065, 145),
          border: ok(36, 0.065, 145),
        },
      },
      fontFamily: {
        sans: ['Karla', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px oklch(27% .05 60 / .06), 0 1px 3px oklch(27% .05 60 / .08)',
        panel: '0 1px 2px oklch(27% .05 60 / .06), 0 12px 32px -18px oklch(27% .05 60 / .35)',
        gold: '0 0 42px oklch(79% .13 85 / .4)',
      },
      keyframes: {
        'halo-spin': { to: { transform: 'rotate(360deg)' } },
        'halo-spin-reverse': { to: { transform: 'rotate(-360deg)' } },
      },
      animation: {
        'halo-spin': 'halo-spin 24s linear infinite',
        'halo-spin-reverse': 'halo-spin-reverse 17s linear infinite',
      },
    },
  },
  plugins: [],
};
