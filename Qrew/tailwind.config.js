/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // HOI brand blue — primary interactive color across the app
        primary: {
          50:  '#eeeeff',
          100: '#dcdcff',
          200: '#b0b0ff',
          300: '#8080ff',
          400: '#5555ff',
          500: '#3c3cff',
          600: '#2929ff',
          700: '#1a1acc',
          800: '#0d0d99',
          900: '#070766',
        },
        // Destructive / warning actions
        accent: {
          50:  '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        // Surface palette
        dark: {
          base:     '#ffffff',  // page background
          surface:  '#353A40',  // card / panel background
          elevated: '#3F454C',  // raised elements, inputs, modals
          border:   '#4A5057',  // primary divider / border
          border2:  '#4A5057',  // secondary border (same scale)
        },
        // Dynamic accent — resolved at runtime via CSS custom property --accent.
        // Blue mode: #2323F1 | Green mode: #205620
        // Tailwind JIT emits: bg-accent { background-color: var(--accent); }
        accent: 'var(--accent)',
      },
      fontFamily: {
        sans:    ['Inter var', 'system-ui', 'sans-serif'],
        display: ['Lexend', 'Inter var', 'sans-serif'],
        mono:    ['Space Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
