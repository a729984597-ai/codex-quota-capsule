import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/windows/test/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
    ],
  },
});
