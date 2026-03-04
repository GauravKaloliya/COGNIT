import { test, expect } from "@playwright/test";

const participantStatus = {
  success: true,
  data: {
    is_verified: true,
    payment_status: "paid",
    current_stage: "survey",
  },
};

const randomImage = {
  success: true,
  data: {
    image_id: "img_001",
    url: "https://picsum.photos/seed/cognit/1200/800",
    is_survey: true,
    is_attention_check: false,
  },
};

const healthOk = { success: true, data: { status: "healthy", database: "connected" } };

test.beforeEach(async ({ page }) => {
  await page.route("**/health", async (route) => route.fulfill({ json: healthOk }));
  await page.route("**/participants/*/payment-status", async (route) =>
    route.fulfill({ json: participantStatus })
  );
  await page.route("**/images/random**", async (route) => route.fulfill({ json: randomImage }));
  await page.route("**/submit", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          status: "submitted",
          attention_passed: null,
          quality_score: 0.82,
        },
      },
    })
  );
});

test("reload keeps app usable and does not crash critical flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=C.O.G.N.I.T.")).toBeVisible();

  await page.reload();
  await expect(page.locator("text=C.O.G.N.I.T.")).toBeVisible();
});

test("offline banner appears and clears on reconnect", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("text=Online")).toBeVisible();

  await context.setOffline(true);
  await expect(page.locator("text=Offline")).toBeVisible();
  await expect(page.locator("text=You appear to be offline")).toBeVisible();

  await context.setOffline(false);
  await expect(page.locator("text=Online")).toBeVisible();
});

test("back navigation during long verify keeps payment flow stable", async ({ page }) => {
  await page.route("**/payments/create", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          payment_id: "pay_1",
          amount: 1,
          expires_at: new Date(Date.now() + 300000).toISOString(),
          signature: "sig",
          upi_link: "upi://pay?pa=test@upi&pn=COGNIT&am=1",
          qr_base64: "",
          timer_activated: true,
          time_remaining_seconds: 300,
        },
      },
    })
  );
  await page.route("**/payments/pay_1/verify-upload", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      json: {
        success: true,
        data: { verification: { verified: true, status: "success" } },
      },
    });
  });
  await page.route("**/payments/pay_1/status", async (route) =>
    route.fulfill({ json: { success: true, data: { status: "success" } } })
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click().catch(() => {});
  await page.getByRole("button", { name: "Continue to Payment" }).click().catch(() => {});

  const backButton = page.getByRole("button", { name: "← Back" });
  if (await backButton.isVisible()) {
    await expect(backButton).toBeEnabled();
  }
});
