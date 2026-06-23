import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Scope the metric to the application logic layer. React UI components
      // (*.tsx) and the data-pipeline scripts are not unit-tested, so they are
      // excluded to keep the number actionable. `all: true` still reports
      // logic files that no test imports (as 0%) so gaps stay visible.
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/__tests__/**",
        "**/*.d.ts",
        // React UI components are not unit-tested; some get imported
        // transitively by tested code, so drop them explicitly.
        "**/*.tsx",
        "src/instrumentation*.ts",
        "**/*.config.{ts,mts,mjs}",
      ],
    },
  },
});
