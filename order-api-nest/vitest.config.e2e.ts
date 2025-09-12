import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

process.loadEnvFile();

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
