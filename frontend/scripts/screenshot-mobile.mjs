import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://127.0.0.1:5173/";
const outPathArg = process.argv[3] || "playwright-artifacts/mobile.png";
const deviceName = process.argv[4] || "iPhone 13";
const stage = process.argv[5] || "";

const outPath = path.resolve(outPathArg);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const device = devices[deviceName];
if (!device) {
  // eslint-disable-next-line no-console
  console.error(`Unknown device "${deviceName}". Try one of: ${Object.keys(devices).slice(0, 10).join(", ")} ...`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoWithRetry(page, targetUrl, attempts = 30) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
      return;
    } catch (err) {
      lastErr = err;
      // Common when Vite is still booting.
      await sleep(250);
    }
  }
  throw lastErr;
}

async function waitForAppReady(page, desiredStage) {
  // Wait out the global "Loading C.O.G.N.I.T." skeleton.
  const skeleton = page.locator(".skeleton-page-frame").first();
  try {
    if (await skeleton.count()) {
      await skeleton.waitFor({ state: "hidden", timeout: 30_000 });
    }
  } catch {
    // Skeleton can flap; continue to content-based waits.
  }

  // Ensure the main app panel is visible.
  await page.locator(".panel").first().waitFor({ state: "visible", timeout: 30_000 });

  // Extra guard: if skeleton still exists in DOM, ensure it's not visible.
  await page.waitForFunction(() => {
    const el = document.querySelector(".skeleton-page-frame");
    if (!el) return true;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
    const rect = el.getBoundingClientRect();
    return rect.width === 0 || rect.height === 0;
  }, { timeout: 30_000 });

  if (desiredStage === "consent") {
    await page.locator(".consent-title").first().waitFor({ state: "visible", timeout: 30_000 });
    return;
  }

  if (desiredStage === "user-details") {
    await page.locator(".form-grid").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 30_000 });
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ ...device });

if (stage) {
  // The app stores UI flow state in sessionStorage using an expiring envelope.
  // Setting it via init script makes screenshots deterministic (e.g. consent vs user-details).
  context.addInitScript(({ desiredStage }) => {
    const SCHEMA_VERSION = 1;
    const TTL_MS = 15 * 60 * 1000;
    const FIELDS = {
      schemaVersion: "__schema_version",
      savedAt: "saved_at",
      expiresAt: "expires_at",
      data: "data",
    };

    const writeExpiring = (key, value) => {
      const now = Date.now();
      sessionStorage.setItem(key, JSON.stringify({
        [FIELDS.schemaVersion]: SCHEMA_VERSION,
        [FIELDS.savedAt]: now,
        [FIELDS.expiresAt]: now + TTL_MS,
        [FIELDS.data]: value,
      }));
    };

    writeExpiring("stage", desiredStage);

    if (desiredStage === "consent") {
      writeExpiring("consentGiven", false);
      writeExpiring("userDetailsSubmitted", false);
      writeExpiring("emailVerified", false);
      writeExpiring("paymentVerified", false);
      return;
    }

    if (desiredStage === "user-details") {
      writeExpiring("consentGiven", true);
      writeExpiring("userDetailsSubmitted", false);
      writeExpiring("emailVerified", false);
      writeExpiring("paymentVerified", false);
      return;
    }
  }, { desiredStage: stage });
}

const page = await context.newPage();

await gotoWithRetry(page, url);
await waitForAppReady(page, stage);
await page.screenshot({ path: outPath, fullPage: false });

await context.close();
await browser.close();

// eslint-disable-next-line no-console
console.log(outPath);
