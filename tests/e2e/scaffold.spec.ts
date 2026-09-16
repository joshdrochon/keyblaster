import { expect, test } from "@playwright/test";

/** Scaffold smoke test (FIRST TASK 1): the Vite app boots. */
test("app boots", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app")).toHaveAttribute("data-booted", "true");
  await expect(page).toHaveTitle(/KeyBlaster/);
});
