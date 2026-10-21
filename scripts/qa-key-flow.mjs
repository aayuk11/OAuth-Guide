// Browser check of the AI key flow. Usage: node scripts/qa-key-flow.mjs <baseUrl> <outDir>
// Uses a fake key, so the provider rejects it; no real key is needed or sent anywhere else.
import { chromium } from "@playwright/test";

const [base = "http://localhost:3000", out = "test-results"] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];

for (const [name, vp, scheme] of [
  ["desktop", { width: 1366, height: 900 }, "light"],
  ["desktop-dark", { width: 1366, height: 900 }, "dark"],
  ["phone", { width: 390, height: 844 }, "light"],
]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name} pageerror ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && problems.push(`${name} console ${m.text().slice(0, 160)}`));

  // 1. Header button opens the dialog.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /AI key/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.screenshot({ path: `${out}/key-dialog-${name}.png` });

  // 2. A rejected key shows a plain error and sets no cookie.
  await dialog.getByText("Gemini", { exact: true }).click();
  await dialog.getByLabel(/API key/).fill("fake-gemini-key-for-qa-0000000000000");
  await dialog.getByRole("button", { name: "Save and test" }).click();
  const alert = dialog.getByRole("alert");
  await alert.waitFor({ timeout: 20000 });
  const msg = (await alert.textContent())?.trim();
  if (msg !== "The Gemini API key was rejected.") problems.push(`${name} unexpected error text: ${msg}`);
  const cookies = await ctx.cookies();
  if (cookies.some((c) => c.name === "or_llm")) problems.push(`${name} cookie set for a rejected key`);
  await page.screenshot({ path: `${out}/key-dialog-error-${name}.png` });
  await page.keyboard.press("Escape");
  if (await dialog.isVisible()) problems.push(`${name} Escape did not close the dialog`);

  // 3. Researching a new app without a key shows the key form in place.
  await page.goto(`${base}/generate?q=Zylophonic%20Widgets`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Add an AI key to research/ }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${out}/key-required-${name}.png`, fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${name} horizontal overflow ${overflow}px on /generate`);
  console.log(`${name}: ok`);
  await ctx.close();
}
await browser.close();
if (problems.length) {
  console.log("PROBLEMS:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("Key flow passed.");
