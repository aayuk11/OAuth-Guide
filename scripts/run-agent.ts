/**
 * Run the live agent from the command line.
 *
 *   npm run generate -- "Jobber"                 one run, events printed as they happen
 *   npm run rehearse                             10 unfamiliar apps: time, cost, outcome → docs/REHEARSAL.md
 *   npm run rehearse -- Clio "Canva" Zoom        your own list
 *   npm run eval:agent                           run cold on every curated app and score against the curated
 *   npm run eval:agent -- gmail slack            guides (the answer key) → src/data/verification/agent-eval.json
 *
 * Needs one provider key in the environment: ANTHROPIC_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY
 * (LLM_PROVIDER and LLM_MODEL choose when several are set). AGENT_MOCK=1 runs without a model.
 */
import fs from "node:fs";
import path from "node:path";
import { agentConfig } from "../src/lib/agent/config";
import { guideKeyFor, runPipeline } from "../src/lib/agent/pipeline";
import { createRun, getRun } from "../src/lib/agent/runs";
import type { RunEvent } from "../src/lib/agent/events";
import { getToolkit, resolveToolkit } from "../src/lib/catalog";
import { curatedGuides } from "../src/lib/guides";
import { CORE_QUESTIONS, GATE_LEVELS, type Guide } from "../src/lib/guide/schema";
import { computeLevel } from "../src/lib/guide/scoring";
import { envCredentials, providerLabel } from "../src/lib/llm";
import type { Credentials } from "../src/lib/llm/types";

// Same files Next.js reads, so a key in .env.local works for both the site and this script.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    /* file is optional */
  }
}

const REHEARSAL_SET = ["Jobber", "Clio", "Pipedrive", "DocuSign", "Canva", "Calendly", "Zoom", "HubSpot", "https://www.getjobber.com", "Notion MCP"];

function print(e: RunEvent) {
  const t = `${(e.t / 1000).toFixed(1).padStart(6)}s`;
  if (e.type === "step") console.log(`${t}  [${e.stage}] ${e.status}${e.detail ? ` — ${e.detail}` : ""}`);
  else if (e.type === "search") console.log(`${t}    search: ${e.query}`);
  else if (e.type === "read") console.log(`${t}    read: ${e.ok ? "" : "FAILED "}${e.title ?? ""} ${e.url}`);
  else if (e.type === "finding") console.log(`${t}    tested: ${e.text}`);
  else if (e.type === "error") console.log(`${t}  ERROR ${e.message}`);
  else if (e.type === "guide") console.log(`${t}  guide saved at ${e.url}${e.partial ? " (partial)" : ""}`);
}

let creds: Credentials | null = null;
const usd = (v: number | null | undefined) => (v == null ? "cost n/a" : `$${v.toFixed(3)}`);

async function runOne(query: string, toolkitSlug?: string | null, quiet = false) {
  const toolkit = toolkitSlug ? getToolkit(toolkitSlug) : (() => { const r = resolveToolkit(query); return r.kind === "toolkit" ? r.toolkit : null; })();
  const key = guideKeyFor(query, toolkit);
  const run = await createRun(query, key);
  const seen = new Set<number>();
  const timer = quiet ? null : setInterval(() => run.record.events.forEach((e, i) => { if (!seen.has(i)) { seen.add(i); print(e); } }), 200);
  const started = Date.now();
  const guide = await runPipeline(run, { query, toolkitSlug: toolkit?.slug ?? null, creds }).catch((e) => {
    console.error(e);
    return null;
  });
  await run.flush();
  if (timer) {
    clearInterval(timer);
    run.record.events.forEach((e, i) => { if (!seen.has(i)) print(e); });
  }
  const rec = await getRun(run.record.id);
  return { query, key, guide, seconds: (Date.now() - started) / 1000, status: rec?.status ?? "unknown", usage: rec?.usage };
}

function levelRange(g: Guide) {
  const ls = g.paths.map((p) => computeLevel(g, p).value);
  return [Math.min(...ls), Math.max(...ls)] as const;
}

/** Compare a generated guide with the curated answer key on the facts that decide difficulty. */
function score(curated: Guide, generated: Guide) {
  const facts: { what: string; ok: boolean }[] = [];
  const [cMin, cMax] = levelRange(curated);
  const [gMin, gMax] = levelRange(generated);
  facts.push({ what: `lowest level L${cMin}`, ok: gMin === cMin });
  facts.push({ what: `highest level L${cMax}`, ok: gMax === cMax });
  const deciding = CORE_QUESTIONS.filter((q) => q.levelDeciding).map((q) => q.id);
  for (const q of deciding) {
    const a = curated.checks.find((c) => c.q === q)?.answer;
    const b = generated.checks.find((c) => c.q === q)?.answer;
    if (!a || a === "unknown") continue;
    const norm = (x?: string) => (x === "partly" ? "yes" : x);
    facts.push({ what: `${q} = ${a}`, ok: norm(a) === norm(b) });
  }
  const cGates = new Set(curated.paths.flatMap((p) => p.gates.map((g) => g.type)));
  const gGates = new Set(generated.paths.flatMap((p) => p.gates.map((g) => g.type)));
  for (const t of cGates) facts.push({ what: `finds gate ${t} (L${GATE_LEVELS[t]})`, ok: gGates.has(t) });
  const extra = [...gGates].filter((t) => !cGates.has(t));
  const missed = facts.filter((f) => !f.ok).map((f) => f.what);
  return {
    score: facts.filter((f) => f.ok).length,
    total: facts.length,
    level_match: gMin === cMin && gMax === cMax,
    notes: [missed.length ? `missed: ${missed.join("; ")}` : "all key facts matched", extra.length ? `extra gates: ${extra.join(", ")}` : ""].filter(Boolean).join(". "),
    unverified: generated.evidence.filter((e) => e.label === "unverified").length,
    downgraded: generated.meta?.critic?.downgraded ?? 0,
  };
}

async function main() {
  const [mode = "one", ...rest] = process.argv.slice(2);
  creds = envCredentials();
  if (!creds && !agentConfig().mock) {
    console.error("Set ANTHROPIC_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY in .env.local (or AGENT_MOCK=1).");
    process.exit(2);
  }
  const model = creds ? providerLabel(creds.provider, creds.model) : "mock";
  console.log(`Using ${model}`);
  const today = new Date().toISOString().slice(0, 10);

  if (mode === "one") {
    const q = rest.join(" ").trim();
    if (!q) throw new Error('usage: npm run generate -- "App name or URL"');
    const r = await runOne(q);
    console.log(`\n${r.status} in ${r.seconds.toFixed(0)} s · ${r.usage ? `${usd(r.usage.cost_usd)}, ${r.usage.searches} searches, ${r.usage.fetches} fetches` : ""}`);
    if (r.guide) {
      const [a, b] = levelRange(r.guide);
      console.log(`Level ${a}${b !== a ? `–${b}` : ""} · ${r.guide.headline}`);
      const c = r.guide.meta?.coverage;
      if (c) console.log(`Coverage: ${c.answered}/${c.total} questions answered, ${c.confirmed}/${c.total} with a confirmed source`);
      console.log(`Open: http://localhost:3000/apps/gen/${r.key}`);
    }
    return;
  }

  if (mode === "rehearse") {
    const list = rest.length ? rest : REHEARSAL_SET;
    const rows: string[] = [];
    for (const q of list) {
      console.log(`\n=== ${q}`);
      const r = await runOne(q, null, true);
      const [a, b] = r.guide ? levelRange(r.guide) : [0, 0];
      const line = `| ${q} | ${r.status} | ${r.seconds.toFixed(0)} s | ${r.usage ? usd(r.usage.cost_usd) : "–"} | ${r.usage?.searches ?? "–"} / ${r.usage?.fetches ?? "–"} | ${r.guide ? `L${a}${b !== a ? `–${b}` : ""}` : "–"} | ${r.guide?.meta?.critic ? `${r.guide.meta.critic.downgraded}/${r.guide.meta.critic.checked}` : "–"} | ${r.guide?.meta?.coverage ? `${r.guide.meta.coverage.confirmed}/${r.guide.meta.coverage.total}` : "–"} |`;
      console.log(line);
      rows.push(line);
    }
    const secs = rows.map((r) => Number(r.split("|")[3].replace(/[^\d.]/g, ""))).sort((x, y) => x - y);
    const p90 = secs[Math.min(secs.length - 1, Math.floor(secs.length * 0.9))];
    const md = [
      `# Rehearsal ${today}`,
      "",
      `${model}. ${rows.length} runs; median ${secs[Math.floor(secs.length / 2)]} s, 90th percentile ${p90} s.`,
      "",
      "| App | Outcome | Time | Cost | Searches / fetches | Levels | Critic downgrades | Confirmed answers |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(process.cwd(), "docs", "REHEARSAL.md"), md);
    console.log(`\nWrote docs/REHEARSAL.md`);
    return;
  }

  if (mode === "eval") {
    const targets = curatedGuides().filter((g) => rest.length === 0 || rest.includes(g.slug));
    const results = [];
    for (const g of targets) {
      console.log(`\n=== ${g.app.name} (cold run)`);
      const r = await runOne(g.app.name, g.composio_slug, true);
      if (!r.guide || r.guide.meta?.partial) {
        results.push({ app: g.app.name, score: 0, total: 1, level_match: false, notes: `run ${r.status}`, seconds: r.seconds, cost_usd: r.usage?.cost_usd ?? null });
        continue;
      }
      const s = score(g, r.guide);
      console.log(`${s.score}/${s.total} · ${s.notes}`);
      results.push({ app: g.app.name, ...s, seconds: Math.round(r.seconds), cost_usd: r.usage?.cost_usd ?? null, coverage: r.guide.meta?.coverage });
    }
    const out = { ran: true, date: today, model, results };
    fs.writeFileSync(path.join(process.cwd(), "src", "data", "verification", "agent-eval.json"), JSON.stringify(out, null, 2) + "\n");
    const tot = results.reduce((a, r) => [a[0] + r.score, a[1] + r.total], [0, 0]);
    console.log(`\nAgent got ${tot[0]} of ${tot[1]} key facts right across ${results.length} apps. Wrote src/data/verification/agent-eval.json`);
    return;
  }
  throw new Error(`unknown mode "${mode}" (use one, rehearse or eval)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
