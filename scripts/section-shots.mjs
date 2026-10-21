// Usage: node scripts/section-shots.mjs <url> <outDir> <prefix> <width> [#id ...]
import { chromium } from "@playwright/test";
const [url, out, prefix, width, ...ids] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
for (const id of ids) {
  const el = page.locator(id).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const file = `${out}/${prefix}-${id.replace(/[^a-z0-9]+/gi, "")}.png`;
  try { await el.screenshot({ path: file, timeout: 15000 }); console.log(file); } catch (e) { console.log("missing", id, e.message.slice(0, 80)); }
}
// Report elements wider than the viewport (phone overflow hunting).
const wide = await page.evaluate(() => {
  const vw = window.innerWidth; const out = [];
  for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`); }
  return out.slice(0, 12);
});
if (wide.length) console.log("WIDE:\n " + wide.join("\n "));
await browser.close();
