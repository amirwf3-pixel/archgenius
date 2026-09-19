/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // The translation dictionaries contain no class names; excluding them keeps
    // English words in comments/strings (e.g. "table", "fixed") from generating
    // dead utility selectors in the production CSS.
    '!./src/i18n.ts',
    '!./src/i18n.test.tsx',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0b1220',
          800: '#0f172a',
          700: '#1e293b',
          600: '#334155',
          500: '#64748b',
          400: '#94a3b8',
        },
        accent: {
          500: '#2563eb',
          600: '#1d4ed8',
        },
        ok: '#10b981',
        warn: '#f59e0b',
        bad: '#ef4444',
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Segoe UI', 'Tahoma', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
