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
        // Dynamic accent — resolved at runtime via CSS custom property --accent.
        // Qrew green: #205620
        accent: 'var(--accent)',
        // Surface palette — light theme
        dark: {
          base:     '#ffffff',   // page background
          surface:  '#f9fafb',   // card / panel background
          elevated: '#f3f4f6',   // raised elements, inputs, modals
          border:   '#e5e7eb',   // primary divider / border
          border2:  '#d1d5db',   // secondary border
        },
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
