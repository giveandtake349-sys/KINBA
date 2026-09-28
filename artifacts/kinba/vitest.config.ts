import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  // The app builds through @vitejs/plugin-react, so the test transform has to
  // compile JSX the same way instead of inheriting tsconfig's `jsx: preserve`.
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "server/**/*.{test,spec}.{ts,tsx}",
      "client/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules", "dist", "client/dist"],
    setupFiles: ["client/src/test/setup.ts"],
    // Server suites stay on the default node environment; every client suite
    // runs in jsdom so the shared components can render against a DOM.
    environmentMatchGlobs: [["client/**", "jsdom"]],
  },
});
