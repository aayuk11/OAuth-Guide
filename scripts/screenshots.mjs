// Usage: node scripts/screenshots.mjs <baseUrl> <outDir> [path ...]
import { chromium } from "@playwright/test";
const args = process.argv.slice(2);
const dark = args.includes("--dark");
const [base, out, ...paths] = args.filter((a) => a !== "--dark");
const list = paths.length ? paths : ["/", "/apps/gmail", "/apps/pipedrive", "/go?q=Meta", "/evidence", "/method", "/apps"];
const browser = await chromium.launch();
for (const [name, vp] of [["desktop", { width: 1366, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console ${m.text().slice(0, 200)}`); });
  for (const p of list) {
    await page.goto(base + p, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(700);
    const file = `${out}/${dark ? "dark-" : ""}${name}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`;
    await page.screenshot({ path: file, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`${name} ${p} -> ${file}${overflow > 1 ? `  HORIZONTAL OVERFLOW ${overflow}px` : ""}`);
  }
  if (errors.length) console.log(`${name} errors:\n  ` + [...new Set(errors)].join("\n  "));
  await ctx.close();
}
await browser.close();
