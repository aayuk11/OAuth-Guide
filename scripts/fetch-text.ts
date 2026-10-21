/**
 * Print a page as the text our verifier sees, optionally only lines containing a term.
 * Use it to copy excerpts verbatim so `npm run verify:sources` can match them.
 *
 * Usage: npx tsx scripts/fetch-text.ts <url> [term ...]
 */
import { fetchPageText } from "../src/lib/net/page-text";

async function main() {
  const [url, ...terms] = process.argv.slice(2);
  if (!url) {
    console.error("usage: npx tsx scripts/fetch-text.ts <url> [term ...]");
    process.exit(2);
  }
  const page = await fetchPageText(url);
  console.log(`# ${page.title ?? "(no title)"}  [HTTP ${page.status}, via ${page.via}, ${page.text.length} chars]`);
  console.log(`# ${page.url}\n`);
  if (terms.length === 0) {
    console.log(page.text.slice(0, 60000));
    return;
  }
  const lines = page.text.split("\n");
  const lower = terms.map((t) => t.toLowerCase());
  lines.forEach((line, i) => {
    const l = line.toLowerCase();
    if (lower.some((t) => l.includes(t))) console.log(`${String(i).padStart(5)}: ${line.slice(0, 1200)}`);
  });
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
