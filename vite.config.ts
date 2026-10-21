import { defineConfig } from 'vitest/config';

const buildId = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/<repo>/ without hardcoding the repo name.
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
