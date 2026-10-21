// Find what makes a page wider than a phone screen. Usage: node scripts/overflow.mjs <baseUrl> <path ...>
import { chromium } from "@playwright/test";
const [base, ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const p of paths) {
  await page.goto(base + p, { waitUntil: "networkidle", timeout: 90000 });
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const leaves = [];
    const walk = (el) => {
      let deeper = false;
      for (const c of el.children) {
        if (c.scrollWidth > vw + 1 && getComputedStyle(c).overflowX === "visible") { deeper = true; walk(c); }
      }
      if (!deeper) leaves.push(`${el.tagName.toLowerCase()} [${String(el.className).slice(0, 60)}] sw=${el.scrollWidth} text="${(el.textContent || "").trim().slice(0, 90)}"`);
    };
    walk(document.querySelector("main"));
    return { sw: document.documentElement.scrollWidth, vw, leaves: leaves.slice(0, 4) };
  });
  console.log(`== ${p}: scrollWidth ${res.sw} / ${res.vw}`);
  if (res.sw > res.vw + 1) console.log("  " + res.leaves.join("\n  "));
}
await browser.close();
