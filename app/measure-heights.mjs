import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1500 } });
await page.goto("http://localhost:3008/?taxa=mammals", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("text=Taxonomic Group", { timeout: 20000 });
await page.getByRole("button", { name: /More Filters/i }).click();
await page.waitForTimeout(1000);
await page.waitForSelector("text=Number of Assessments", { timeout: 10000 });
await page.waitForTimeout(500);

const result = await page.evaluate(() => {
  const habitatHeading = Array.from(document.querySelectorAll("span")).find(el => el.textContent === "Habitat");
  const habitatCard = habitatHeading.closest("div.bg-white");
  const naHeading = Array.from(document.querySelectorAll("span")).find(el => el.textContent === "Number of Assessments");
  const naCard = naHeading.closest("div.bg-white");
  const criteriaHeading = Array.from(document.querySelectorAll("span")).find(el => el.textContent === "Criteria");
  const criteriaCard = criteriaHeading.closest("div.rounded-lg");
  const rightColumn = naCard.parentElement;
  return {
    habitatCardRect: habitatCard.getBoundingClientRect().toJSON(),
    naCardRect: naCard.getBoundingClientRect().toJSON(),
    criteriaCardRect: criteriaCard.getBoundingClientRect().toJSON(),
    rightColumnRect: rightColumn.getBoundingClientRect().toJSON(),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
