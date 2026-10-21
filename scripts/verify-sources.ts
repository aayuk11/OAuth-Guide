/**
 * Re-verify curated evidence: fetch each cited page and check the stored excerpt still appears.
 * This is the freshness mechanism: run it on a schedule and review anything that drifts.
 *
 * Usage: npm run verify:sources                 (all guides, report only)
 *        npm run verify:sources -- gmail slack  (some guides)
 *        npm run verify:sources -- --write      (also record results in the guide files)
 */
import fs from "node:fs";
import path from "node:path";
import { GuideSchema, type Evidence } from "../src/lib/guide/schema";
import { fetchPageText } from "../src/lib/net/page-text";
import { matchExcerpt, prepare, type PreparedText } from "../src/lib/text/match";

const args = process.argv.slice(2);
const write = args.includes("--write");
const only = args.filter((a) => !a.startsWith("--"));
const dir = path.join(process.cwd(), "src", "data", "guides");
const today = new Date().toISOString().slice(0, 10);

type Status = "verified" | "not_found" | "unfetchable";
const pageCache = new Map<string, Promise<PreparedText | { error: string }>>();

function load(url: string) {
  const key = url.split("#")[0];
  if (!pageCache.has(key)) {
    pageCache.set(
      key,
      (async () => {
        try {
          const page = await fetchPageText(key);
          if (page.status >= 400) return { error: `HTTP ${page.status}` };
          if (page.text.length < 200) return { error: "page has almost no text (likely rendered by JavaScript)" };
          return prepare(page.text);
        } catch (e) {
          return { error: (e as Error).message };
        }
      })(),
    );
  }
  return pageCache.get(key)!;
}

async function main() {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => only.length === 0 || only.includes(f.replace(/\.json$/, "")));

  const report: Array<{ guide: string; id: string; label: string; url: string; status: Status; score: number; detail: string }> = [];

  for (const f of files) {
    const file = path.join(dir, f);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const parsed = GuideSchema.safeParse(raw);
    if (!parsed.success) {
      console.log(`skip ${f}: does not pass schema (run npm run validate)`);
      continue;
    }
    const guide = parsed.data;
    const targets = guide.evidence.filter((e: Evidence) => e.url && e.excerpt && (e.label === "official" || e.label === "reported"));
    const results = await Promise.all(
      targets.map(async (e) => {
        const page = await load(e.url!);
        if ("error" in page) return { e, status: "unfetchable" as Status, score: 0, detail: page.error };
        const m = matchExcerpt(e.excerpt!, page);
        return { e, status: (m.match ? "verified" : "not_found") as Status, score: m.score, detail: m.method };
      }),
    );
    let ok = 0;
    for (const r of results) {
      if (r.status === "verified") ok++;
      report.push({ guide: guide.slug, id: r.e.id, label: r.e.label, url: r.e.url!, status: r.status, score: Number(r.score.toFixed(2)), detail: r.detail });
      if (write) {
        const target = raw.evidence.find((x: Evidence) => x.id === r.e.id);
        target.verification = { status: r.status, checked: today, method: "automated re-fetch and excerpt match" };
      }
    }
    console.log(`${guide.slug}: ${ok}/${results.length} excerpts found on their pages`);
    for (const r of results.filter((x) => x.status !== "verified"))
      console.log(`   ${r.status.padEnd(11)} ${r.e.id.padEnd(14)} ${r.e.url}  (${r.detail}${r.status === "not_found" ? `, score ${r.score.toFixed(2)}` : ""})`);
    if (write) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  }

  const outDir = path.join(process.cwd(), "src", "data", "verification");
  fs.mkdirSync(outDir, { recursive: true });
  if (only.length === 0) {
    fs.writeFileSync(path.join(outDir, "sources-latest.json"), JSON.stringify({ checked: today, results: report }, null, 2) + "\n");
  }
  const total = report.length;
  const verified = report.filter((r) => r.status === "verified").length;
  console.log(`\nTotal: ${verified}/${total} verified, ${report.filter((r) => r.status === "not_found").length} not found, ${report.filter((r) => r.status === "unfetchable").length} unfetchable`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
