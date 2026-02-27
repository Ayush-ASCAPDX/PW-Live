const { test, expect } = require("@playwright/test");

test("login OTP phase persists after hard refresh", async ({ page }) => {
  await page.route("http://localhost:5000/api/auth/login/request-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "OTP sent to your email" })
    });
  });

  await page.goto("/login.html");

  await page.fill("#email", "user@example.com");
  await page.fill("#password", "Password123!");
  await page.click("#loginBtn");

  await expect(page.locator("#otp")).toBeVisible();
  await expect(page.locator("#loginBtn")).toHaveText("Verify OTP & Login");

  await page.reload();

  await expect(page.locator("#otp")).toBeVisible();
  await expect(page.locator("#loginBtn")).toHaveText("Verify OTP & Login");
  await expect(page.locator("#email")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#password")).toHaveJSProperty("readOnly", true);
});
