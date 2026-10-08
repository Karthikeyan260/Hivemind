import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Same as tsconfig "paths": "@/*" → "./*".
      { find: /^@\//, replacement: `${root}/` },
      // "server-only" throws outside Next's server bundle; tests import server modules directly.
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
