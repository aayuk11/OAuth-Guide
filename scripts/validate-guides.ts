/**
 * Validate curated guides: schema (zod) + cross-references.
 * Usage: npm run validate            (all guides)
 *        npm run validate -- gmail   (one guide)
 */
import fs from "node:fs";
import path from "node:path";
import { GuideSchema, crossCheckGuide } from "../src/lib/guide/schema";

const dir = path.join(process.cwd(), "src", "data", "guides");
const only = process.argv.slice(2);
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => only.length === 0 || only.includes(f.replace(/\.json$/, "")));

let failed = 0;
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const parsed = GuideSchema.safeParse(raw);
  if (!parsed.success) {
    failed++;
    console.log(`✗ ${f}: schema errors`);
    for (const issue of parsed.error.issues.slice(0, 40)) console.log(`   - ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  const problems = crossCheckGuide(parsed.data);
  if (parsed.data.slug !== f.replace(/\.json$/, "")) problems.push(`slug "${parsed.data.slug}" does not match file name`);
  if (problems.length) {
    failed++;
    console.log(`✗ ${f}: ${problems.length} cross-reference problems`);
    for (const p of problems.slice(0, 40)) console.log(`   - ${p}`);
    continue;
  }
  const g = parsed.data;
  console.log(
    `✓ ${f}: ${g.paths.length} paths, ${g.paths.reduce((n, p) => n + p.gates.length, 0)} gates, ${g.steps.length} steps, ${g.blockers.length} blockers, ${g.evidence.length} sources`,
  );
}
if (files.length === 0) console.log("No guides found.");
process.exit(failed ? 1 : 0);
