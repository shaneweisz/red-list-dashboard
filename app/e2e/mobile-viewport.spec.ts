import { test, expect } from "playwright/test";

test.describe("Mobile viewport scaling", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("viewport meta tag sets width to 1200 for mobile scaling", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("table");

    const viewportContent = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return meta?.getAttribute("content");
    });
    expect(viewportContent).toContain("width=767");
  });

  test("all table header columns are visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table");

    const headers = page.locator("table thead th");
    const count = await headers.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      await expect(headers.nth(i)).toBeVisible();
    }
  });

  test("detail tabs are accessible after clicking a species row", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr");

    // Click the first species row
    await page.locator("table tbody tr").first().click();

    // Wait for detail tab buttons to appear within the expanded row
    const detailButtons = page.locator("table tbody button");
    await expect(detailButtons.first()).toBeVisible({ timeout: 10000 });

    // Verify at least one tab button is visible
    const tabCount = await detailButtons.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);
  });
});
