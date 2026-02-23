import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const baseURL = process.env.PROOF_BASE_URL ?? "http://127.0.0.1:3000";
const proofOutputDir = process.env.PROOF_OUTPUT_DIR;
const skipWebServer = process.env.PROOF_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/proof",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: process.env.PLAYWRIGHT_HTML_REPORT ?? "playwright-report",
      },
    ],
  ],
  outputDir: proofOutputDir ? `${proofOutputDir}/artifacts` : "test-results/playwright",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "on",
    video: "on",
    screenshot: "off",
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium-light",
      use: {
        colorScheme: "light",
      },
    },
    {
      name: "chromium-dark",
      use: {
        colorScheme: "dark",
      },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        cwd: process.cwd(),
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});
