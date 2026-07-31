import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/server/server-only-stub.ts", import.meta.url).pathname,
    },
  },
  test: {
    env: {
      TAMBIKE_BACKEND: "memory",
    },
    exclude: [
      ...configDefaults.exclude,
      ".codex/worktrees/**",
      "tests/prisma-integration/**",
    ],
  },
});
