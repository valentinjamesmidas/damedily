import path from "node:path";
import { defineConfig } from "vitest/config";

/** Jednorázový živý dotaz. Není součást `npm test` ani CI. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/live-search-probe.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
});
