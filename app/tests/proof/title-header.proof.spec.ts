import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

type CheckStatus = "pass" | "fail";

type CheckResult = {
  id: string;
  status: CheckStatus;
  details?: string;
};

const EXPECTED_TITLE = "Realtime Evidence Dashboard for IUCN Red List Assessments";
const route = process.env.PROOF_ROUTE ?? "/";
const featureId = process.env.PROOF_FEATURE_NAME ?? "adhoc-feature";
const phase = process.env.PROOF_PHASE ?? "adhoc";
const proofOutputDir = process.env.PROOF_OUTPUT_DIR ??
  path.join(process.cwd(), "test-results", "proof", featureId, phase);

async function runCheck(id: string, fn: () => Promise<void>, checks: CheckResult[]) {
  try {
    await fn();
    checks.push({ id, status: "pass" });
  } catch (error) {
    const raw = error instanceof Error ? error.message.split("\n")[0] : String(error);
    const details = raw.replace(/\u001b\[[0-9;]*m/g, "");
    checks.push({ id, status: "fail", details });
  }
}

test("captures title/header proof evidence", async ({ page }, testInfo) => {
  const checks: CheckResult[] = [];
  const screenshotDir = path.join(proofOutputDir, "screenshots", testInfo.project.name);
  const checksDir = path.join(proofOutputDir, "checks");

  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(checksDir, { recursive: true });

  await page.goto(route, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    `,
  });

  const mainContainer = page.locator("main").first();
  const headerContainer = page.locator("main > div > div").first();

  await runCheck(
    "main_visible",
    async () => {
      await expect(mainContainer).toBeVisible();
    },
    checks
  );

  await runCheck(
    "title_text",
    async () => {
      await expect(page).toHaveTitle(EXPECTED_TITLE);
    },
    checks
  );

  await runCheck(
    "h1_text",
    async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(EXPECTED_TITLE);
    },
    checks
  );

  await runCheck(
    "screenshot_full",
    async () => {
      await page.screenshot({
        path: path.join(screenshotDir, "full-page.png"),
        fullPage: true,
      });
    },
    checks
  );

  await runCheck(
    "screenshot_header",
    async () => {
      await expect(headerContainer).toBeVisible();
      await headerContainer.screenshot({
        path: path.join(screenshotDir, "header.png"),
      });
    },
    checks
  );

  await fs.writeFile(
    path.join(checksDir, `${testInfo.project.name}.json`),
    JSON.stringify(
      {
        project: testInfo.project.name,
        checks,
      },
      null,
      2
    )
  );

  const failed = checks.filter((check) => check.status === "fail");
  expect(
    failed,
    `Proof checks failed (${testInfo.project.name}): ${failed
      .map((check) => check.id)
      .join(", ")}`
  ).toEqual([]);
});
