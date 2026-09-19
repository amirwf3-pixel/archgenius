import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Mirrors vite.config.ts: the web app resolves @archgenius/core from SOURCE,
// so tests must too (no prior core build required).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@archgenius/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    reporters: ['default'],
    testTimeout: 15_000,
  },
});
