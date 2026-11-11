import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.git/**", "lib/**/*.live.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
});
