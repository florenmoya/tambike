import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/server/server-only-stub.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["tests/prisma-integration/**/*.integration.test.ts"],
    setupFiles: ["./tests/prisma-integration/setup.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
