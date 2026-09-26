import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Project site: https://sharpninja.github.io/collatz-hailstone-plotter/
  base: '/collatz-hailstone-plotter/',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
