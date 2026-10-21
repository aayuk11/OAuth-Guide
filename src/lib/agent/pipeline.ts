import { COMPOSIO_REDIRECT_URI, getToolkit, hasOAuth, isManagedOAuth, resolveToolkit, toolkitKind, type Toolkit } from "@/lib/catalog";
import { CORE_QUESTION_IDS, GuideSchema, crossCheckGuide, type Evidence, type Guide } from "@/lib/guide/schema";
import { createProvider, describeProviderError, estimateCost, keyFormatHint, PROVIDERS } from "@/lib/llm";
import { EXTRACT_SYSTEM, REPAIR_SYSTEM, RESEARCH_SYSTEM, URLS_SCHEMA, URLS_SYSTEM, extractionInput, researchPrompt, urlsInText, urlsPrompt } from "@/lib/llm/prompts";
import { emptyUsage, errorText, redactKeys, SearchUnavailableError, type Credentials, type ExtractResult, type LlmProvider, type ResearchResult, type Source, type Usage } from "@/lib/llm/types";
import { fetchPageText } from "@/lib/net/page-text";
import { agentConfig } from "./config";
import { assembleGuide, partialGuide, slugify } from "./assemble";
import { runCritic } from "./critic";
import { DraftSchema, type Draft } from "./draft-schema";
import { toStructuredOutputSchema } from "./json-schema";
import { mockDraft, mockResearch } from "./mock";
import { probeDiscovery, probeEvidence, probeUrlLive, type DiscoveryResult } from "./probes";
import { getGeneratedGuide, saveGeneratedGuide, type RunHandle } from "./runs";

/**
 * Live generation, in a fixed order enforced by code:
 * resolve → Composio → probe → research (LLM) → read sources (code) → extract (LLM) → verify → critic + coverage → save.
 * The model is called in exactly two places; everything else is deterministic.
 */

const DRAFT_JSON_SCHEMA = toStructuredOutputSchema(DraftSchema);
const DRAFT_SCHEMA_TEXT = JSON.stringify(DRAFT_JSON_SCHEMA);

/**
 * "This schema is too complex for structured output" from any provider: Anthropic ("compiled grammar
 * is too large"), Gemini ("too many states"), OpenAI ("Invalid schema"). The guide is then written as
 * plain JSON with the schema in the prompt, and checked in code as always.
 */
function isSchemaRejected(e: unknown): boolean {
  return (e as { status?: number })?.status === 400 && /grammar|schema|too many states|constraint/i.test(errorText(e));
}

/** A JSON object from a reply that may be wrapped in a code fence or a sentence. */
function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("not JSON");
    return JSON.parse(t.slice(a, b + 1));
  }
}

/** The draft, or the schema problems to fix (at most 25, as "path: message"). */
function checkDraft(text: string): { draft: Draft } | { problems: string[] } {
  let json: unknown;
  try {
    json = parseJsonReply(text);
  } catch {
    return { problems: ["The reply is not valid JSON (it may have been cut off)."] };
  }
  const parsed = DraftSchema.safeParse(json);
  if (parsed.success) return { draft: parsed.data };
  return { problems: parsed.error.issues.slice(0, 25).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

export function looksLikeUrl(q: string): boolean {
  return /^https?:\/\//i.test(q) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(q.trim());
}

export function hostFromQuery(q: string): string | null {
  if (!looksLikeUrl(q)) return null;
  try {
    return new URL(q.includes("://") ? q : `https://${q}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The stable key a generated guide is saved under. */
export function guideKeyFor(query: string, toolkit: Toolkit | null): string {
  if (toolkit) return slugify(toolkit.slug.replace(/_/g, "-"));
  const host = hostFromQuery(query);
  return slugify(host ?? query);
}

function composioContext(t: Toolkit | null, query: string): string {
  if (!t) return `Composio context: "${query}" is not in Composio's toolkit catalogue, so there is no managed OAuth app.`;
  const kind = toolkitKind(t);
  const lines = [`Composio context: toolkit "${t.slug}" (${t.name}). Auth schemes: ${t.auth.join(", ") || "none"}. Composio-managed OAuth app: ${isManagedOAuth(t) ? "yes" : "no"} (${kind}).`];
  if (t.oauth?.scopes.length) lines.push(`Composio's default scopes: ${t.oauth.scopes.join(", ")}`);
  const req = t.oauth?.connection_fields.filter((f) => f.required) ?? [];
  if (req.length) lines.push(`Each connection also needs: ${req.map((f) => f.label).join(", ")}.`);
  lines.push(`Composio redirect URI for custom OAuth apps: ${COMPOSIO_REDIRECT_URI}`);
  return lines.join("\n");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

const REDIRECTORS = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;

/**
 * The whole run must finish inside the API route's 300 s limit, or the host stops it mid-way and
 * nothing is saved. Stage time limits are cut to fit what is left of this budget.
 */
const RUN_BUDGET_MS = 280_000;

/**
 * Read the pages the research relied on, with our own fetcher, so the guide is written from
 * and checked against real page text whichever provider ran the research. Pages the provider
 * already returned in full are skipped. URLs written in the notes come first.
 */
async function readSources(sources: Source[], notes: string, cap: number, emit: RunHandle["emit"]): Promise<Source[]> {
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const mentioned = urlsInText(notes).map((u) => u.split("#")[0]);
  for (const key of mentioned) {
    if (!byUrl.has(key)) byUrl.set(key, { id: `S${byUrl.size + 1}`, url: key, title: key, fetched: false, text: "", cited: [], pageAge: null });
  }
  const all = [...byUrl.values()];
  const wanted = new Set(mentioned);
  const queue = all.filter((s) => !s.text).sort((a, b) => Number(wanted.has(b.url)) - Number(wanted.has(a.url))).slice(0, cap);
  let i = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && i < queue.length) {
      const s = queue[i++];
      try {
        const page = await fetchPageText(s.url, 9000);
        // Past the time box the guide is already being written from these sources: leave them alone.
        if (stopped) return;
        if (page.status < 400 && page.text.length > 200) {
          s.text = page.text.slice(0, 400_000);
          s.fetched = true;
          if (page.title) s.title = page.title;
          try {
            if (REDIRECTORS.test(new URL(s.url).hostname) && page.url) s.url = page.url;
          } catch {
            /* keep the original URL */
          }
          emit({ type: "read", url: s.url, title: s.title, ok: true });
        } else emit({ type: "read", url: s.url, ok: false, error: page.status >= 400 ? `HTTP ${page.status}` : "no readable text" });
      } catch (e) {
        if (!stopped) emit({ type: "read", url: s.url, ok: false, error: (e as Error).message.slice(0, 80) });
      }
    }
  };
  await withTimeout(Promise.all([worker(), worker(), worker(), worker()]), 30_000, [] as void[]);
  stopped = true;
  return all;
}

const URL_ONLY = "url_only";

/** A failure the pipeline explains in its own words, rather than a provider SDK error. */
class StageError extends Error {}

/**
 * Research when the key has no web search: the model names the provider's official pages (no
 * tools, JSON output), our server reads them, and the guide is written from that text alone.
 */
async function researchByUrl(
  provider: LlmProvider,
  args: { query: string; context: string; urls: string[]; timeoutMs: number; emit: RunHandle["emit"] },
): Promise<ResearchResult> {
  // Providers report extract progress as "writing the guide"; this call only lists pages.
  const emit: RunHandle["emit"] = (e) => (e.type === "progress" ? args.emit({ type: "progress", stage: "research", detail: "Asking the model which official pages to read" }) : args.emit(e));
  const ex = await provider.extract({ system: URLS_SYSTEM, input: urlsPrompt(args), schema: URLS_SCHEMA, timeoutMs: Math.min(args.timeoutMs, 45_000), effort: "low", emit });
  if (!ex.text && !args.urls.length) throw new StageError(`Web search is not available on this key's plan, and the model did not name any pages to read. ${ex.error ?? ""}`.trim());
  let named: { url: string; covers: string }[] = [];
  try {
    named = (JSON.parse(ex.text ?? "{}") as { urls?: { url: string; covers: string }[] }).urls ?? [];
  } catch {
    /* no usable list: read the starting points only */
  }
  const seen = new Set<string>();
  const list = [...args.urls.map((url) => ({ url, covers: "Starting point" })), ...named]
    .map((u) => ({ ...u, url: String(u.url ?? "").trim().split("#")[0] }))
    .filter((u) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(u.url) && !seen.has(u.url) && seen.add(u.url))
    .slice(0, 12);
  for (const u of named.slice(0, 10)) if (u.url) args.emit({ type: "progress", stage: "research", detail: `Will read ${u.url}` });
  const sources: Source[] = list.map((u, i) => ({ id: `S${i + 1}`, url: u.url, title: u.url, fetched: false, text: "", cited: [], pageAge: null }));
  const read = await readSources(sources, "", 12, args.emit);
  const ok = read.filter((s) => s.fetched);
  const notes = [
    "Research ran without web search: this API key's plan does not include it. The model named the provider's official pages; our server read them. Only text on these pages is evidence.",
    ...ok.map((s) => `- ${s.title} (${s.url})`),
  ].join("\n");
  return { notes, sources: read, searches: [], usage: ex.usage, stopReason: URL_ONLY, timedOut: false, refused: false };
}

/** `provider` replaces the real model client; tests use it to run every stage without network calls to a model. */
export async function runPipeline(
  run: RunHandle,
  input: { query: string; toolkitSlug?: string | null; creds: Credentials | null; provider?: LlmProvider },
): Promise<Guide | null> {
  const cfg = agentConfig();
  const { emit } = run;
  const started = Date.now();
  const left = () => started + RUN_BUDGET_MS - Date.now();
  const query = input.query.trim();
  const usage: Usage = emptyUsage();
  const add = (u: Usage) => {
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.cache_read += u.cache_read;
    usage.cache_write += u.cache_write;
    usage.searches += u.searches;
    usage.fetches += u.fetches;
  };
  const creds = input.creds ?? (input.provider ? { provider: input.provider.id, apiKey: "", model: input.provider.model } : null);
  const providerId = cfg.mock || !creds ? null : creds.provider;
  const model = cfg.mock ? "mock" : (creds?.model ?? "unknown");
  const usageOut = () => ({
    input_tokens: usage.input_tokens + usage.cache_read + usage.cache_write,
    output_tokens: usage.output_tokens,
    searches: usage.searches,
    fetches: usage.fetches,
    cost_usd: providerId ? estimateCost(providerId, model, usage) : null,
  });
  const runMeta = { model, provider: providerId ?? (cfg.mock ? "mock" : undefined) };

  // 1. Resolve
  emit({ type: "step", stage: "resolve", status: "running" });
  let toolkit = input.toolkitSlug ? getToolkit(input.toolkitSlug) : null;
  if (!toolkit) {
    const r = resolveToolkit(query);
    if (r.kind === "toolkit") toolkit = r.toolkit;
  }
  const host = hostFromQuery(query);
  emit({
    type: "step",
    stage: "resolve",
    status: "done",
    detail: toolkit ? `Matched Composio toolkit "${toolkit.name}"` : host ? `Website ${host}` : `"${query}" is not in Composio's catalogue; researching it from scratch`,
  });

  // 2. Composio
  emit({ type: "step", stage: "composio", status: "running" });
  if (toolkit) {
    const kind = toolkitKind(toolkit);
    const what = { managed: "Composio has a managed OAuth app", byo: "No managed OAuth app: bring your own", dcr: "Uses dynamic client registration (MCP)", no_oauth: "Connects without OAuth" }[kind];
    const n = toolkit.oauth?.scopes.length ?? 0;
    emit({ type: "step", stage: "composio", status: "done", detail: n ? `${what}. ${plural(n, "default scope")}.` : `${what}.` });
  } else emit({ type: "step", stage: "composio", status: "done", detail: "Not in the catalogue: no managed app exists" });

  // 3. Early probes (only when we already know a domain)
  const probeEv: Evidence[] = [];
  const probeLines: string[] = [];
  let dcrFound = false;
  const recordDiscovery = (results: DiscoveryResult[]) => {
    for (const r of results) {
      if (probeEv.some((e) => e.url === r.probe.target)) continue;
      const id = `t${probeEv.length + 1}`;
      const kindLabel = r.probe.kind === "mcp_discovery" ? "MCP server discovery" : r.probe.kind === "oidc_discovery" ? "OpenID discovery" : "OAuth discovery";
      probeEv.push(probeEvidence(id, r.probe, `${kindLabel}: ${new URL(r.probe.target).hostname}`));
      probeLines.push(`${r.probe.target}: ${r.probe.summary}`);
      if (r.registrationEndpoint || r.cimd) dcrFound = true;
      emit({ type: "finding", text: `${new URL(r.probe.target).hostname}: ${r.probe.summary}`, label: "tested" });
    }
  };
  if (host) {
    emit({ type: "step", stage: "probe", status: "running", detail: `Checking ${host} for discovery documents` });
    recordDiscovery(await withTimeout(probeDiscovery(host), 12_000, [] as DiscoveryResult[]));
    emit({ type: "step", stage: "probe", status: "done", detail: probeEv.length ? `${plural(probeEv.length, "discovery document")} found` : "No discovery documents found" });
  } else emit({ type: "step", stage: "probe", status: "skipped", detail: "Domain unknown until research finds it; probing later" });

  if (!cfg.mock && !creds) {
    emit({ type: "error", message: "No API key. Add one under AI key, or set one on the server.", retryable: false });
    await run.finish("error", runMeta);
    return null;
  }
  const provider = cfg.mock ? null : (input.provider ?? createProvider(creds!));

  // 4. Research (LLM with web search)
  emit({ type: "step", stage: "research", status: "running", detail: `${cfg.mock ? "Mock model" : `${PROVIDERS[creds!.provider].vendor} ${creds!.model}`}: about ${cfg.maxSearches} searches` });
  let research: ResearchResult;
  let webSearch = true;
  const urls = [...(host ? [`https://${host}`] : []), ...(toolkit ? [`https://docs.composio.dev/toolkits/${toolkit.slug}`] : [])];
  const fail = async (e: unknown) => {
    console.error("live research failed:", redactKeys(errorText(e)).slice(0, 600));
    const err = e instanceof StageError ? { message: e.message, retryable: true } : describeProviderError(e, providerId);
    // A rejected key that is not even shaped like an API key: say what to use instead.
    const hint = providerId && creds?.apiKey && /key was rejected/.test(err.message) ? keyFormatHint(providerId, creds.apiKey) : null;
    if (hint) err.message = hint;
    emit({ type: "step", stage: "research", status: "failed", detail: err.message });
    emit({ type: "error", ...err });
    await run.finish("error", { ...runMeta, usage: usageOut() });
    return null;
  };
  try {
    research = cfg.mock
      ? await mockResearch(query, emit)
      : await provider!.research({
          system: RESEARCH_SYSTEM,
          prompt: researchPrompt({ query, context: composioContext(toolkit, query), urls, maxSearches: cfg.maxSearches, maxFetches: cfg.maxFetches }),
          maxSearches: cfg.maxSearches,
          maxFetches: cfg.maxFetches,
          // Leave time for reading pages (30 s), writing the guide and the checks after it.
          timeoutMs: Math.max(30_000, Math.min(cfg.researchTimeoutMs, left() - 120_000)),
          effort: cfg.researchEffort,
          emit,
        });
  } catch (e) {
    if (!(e instanceof SearchUnavailableError)) return fail(e);
    // The key cannot use web search (e.g. Gemini free tier). Same guide, built from pages read by URL.
    console.warn("web search unavailable, reading pages by URL:", redactKeys(e.reason).slice(0, 400));
    webSearch = false;
    emit({ type: "step", stage: "research", status: "running", detail: `Web search is not available on this key's plan, so the agent reads the provider's official pages by URL instead` });
    try {
      research = await researchByUrl(provider!, { query, context: composioContext(toolkit, query), urls, timeoutMs: cfg.extractTimeoutMs, emit });
    } catch (e2) {
      return fail(e2);
    }
  }
  add(research.usage);

  // 4b. Read the sources ourselves, so evidence never depends on what a provider returns.
  // (Pages found without web search were read already.)
  if (!cfg.mock && webSearch && cfg.verifyFetches > 0) {
    emit({ type: "progress", stage: "research", detail: "Reading the pages the research relied on" });
    research.sources = await readSources(research.sources, research.notes, cfg.verifyFetches, emit);
  }
  const read = research.sources.filter((s) => s.fetched).length;
  emit({
    type: "step",
    stage: "research",
    status: research.refused ? "failed" : "done",
    detail: `${webSearch ? plural(research.searches.length, "search", "searches") : "No web search"}, ${plural(read, "page")} read${research.timedOut ? " (time limit reached; using what was found)" : ""}${research.refused ? "; the model declined" : ""}`,
  });

  const key = run.record.key;
  const ctxBase = { key, query, toolkit, sources: research.sources, probeEvidence: probeEv, dcrFound, runId: run.record.id, model };
  const savePartial = async (reason: string) => {
    const existing = await getGeneratedGuide(key).catch(() => null);
    if (existing && !existing.meta?.partial) {
      // A failed re-check must not replace a complete guide that other people may be using.
      emit({ type: "step", stage: "save", status: "skipped", detail: "Kept the existing complete guide" });
      emit({ type: "error", message: `This re-check did not finish: ${reason} The guide from ${existing.last_verified} was kept.`, retryable: true });
      await run.finish("error", { ...runMeta, guideKey: key, usage: usageOut() });
      return null;
    }
    const guide = partialGuide({ ...ctxBase, dcrFound, probeEvidence: probeEv, reason, notes: research.notes, oauthSupported: toolkit && hasOAuth(toolkit) ? "yes" : "unknown" });
    guide.meta = { ...guide.meta, provider: runMeta.provider, research: researchMeta(research, usageOut(), started) };
    await saveGeneratedGuide(guide);
    emit({ type: "step", stage: "save", status: "done", detail: "Partial guide saved" });
    emit({ type: "guide", key, url: `/apps/gen/${key}`, partial: true });
    emit({ type: "done", url: `/apps/gen/${key}` });
    await run.finish("partial", { ...runMeta, guideKey: key, usage: usageOut() });
    return guide;
  };
  if (research.refused) return savePartial("The model declined to research this request.");
  if (!research.notes && research.sources.length === 0) return savePartial("The research found nothing to work with.");
  if (!webSearch && read === 0) return savePartial("Web search is not available on this key's plan, and none of the provider pages the model named could be read.");

  // 5. Extract (LLM, no tools): structured output, else plain JSON; then checked in code, with one repair pass
  emit({ type: "step", stage: "extract", status: "running", detail: "Turning research into the guide format" });
  const today = new Date().toISOString().slice(0, 10);
  let draft: Draft | undefined;
  let failure: string | null = null;
  try {
    if (cfg.mock) draft = await mockDraft(query);
    else {
      const input2 = extractionInput({ query, notes: research.notes, sources: research.sources, context: composioContext(toolkit, query), probes: probeLines, today });
      // Leave time for the checks and saving after each call.
      const timeoutMs = () => Math.max(20_000, Math.min(cfg.extractTimeoutMs, left() - 25_000));
      let structured = true;
      let ex: ExtractResult;
      try {
        ex = await provider!.extract({ system: EXTRACT_SYSTEM, input: input2, schema: DRAFT_JSON_SCHEMA, timeoutMs: timeoutMs(), effort: cfg.extractEffort, emit });
      } catch (e) {
        if (!isSchemaRejected(e)) throw e;
        console.warn("structured output rejected the guide schema; writing plain JSON:", redactKeys(errorText(e)).slice(0, 300));
        emit({ type: "progress", stage: "extract", detail: "The model's structured output cannot take the full guide schema; writing plain JSON and checking it in code" });
        structured = false;
        ex = await provider!.extract({
          system: EXTRACT_SYSTEM,
          input: `${input2}\n\nJSON SCHEMA (reply with one JSON object that matches it exactly):\n${DRAFT_SCHEMA_TEXT}`,
          schema: null,
          timeoutMs: timeoutMs(),
          effort: cfg.extractEffort,
          emit,
        });
      }
      add(ex.usage);
      if (!ex.text) failure = ex.error ?? "Writing the guide failed.";
      else {
        const first = checkDraft(ex.text);
        if ("draft" in first) draft = first.draft;
        else if (left() < 45_000) failure = `The guide did not match the schema (${first.problems[0]}).`;
        else {
          // One repair pass: send the exact problems back. Content stays; only the shape is fixed.
          emit({ type: "progress", stage: "extract", detail: `Fixing ${plural(first.problems.length, "schema problem")} in the draft` });
          const fix = await provider!.extract({
            system: REPAIR_SYSTEM,
            input: `PROBLEMS:\n- ${first.problems.join("\n- ")}\n\nJSON SCHEMA:\n${DRAFT_SCHEMA_TEXT}\n\nJSON TO FIX:\n${ex.text}`,
            schema: structured ? DRAFT_JSON_SCHEMA : null,
            timeoutMs: timeoutMs(),
            effort: "low",
            emit,
          });
          add(fix.usage);
          const second = fix.text ? checkDraft(fix.text) : null;
          if (second && "draft" in second) draft = second.draft;
          else failure = `The guide did not match the schema (${second ? second.problems[0] : (fix.error ?? first.problems[0])}).`;
        }
      }
    }
  } catch (e) {
    console.error("writing the guide failed:", redactKeys(errorText(e)).slice(0, 600));
    failure = describeProviderError(e, providerId).message;
  }
  // Saved outside the try, so a storage error is not reported as a model error.
  if (failure || !draft) {
    emit({ type: "step", stage: "extract", status: "failed", detail: failure ?? "Writing the guide failed." });
    return savePartial(failure ?? "Writing the guide failed.");
  }
  emit({ type: "step", stage: "extract", status: "done", detail: `${plural(draft.paths.length, "path")}, ${plural(draft.steps.length, "step")}, ${plural(draft.evidence.length, "cited source")}` });

  // 6. Verify: probe what research found
  emit({ type: "step", stage: "verify", status: "running", detail: "Checking the portal, docs and discovery endpoints" });
  const discovered = [draft.app.developer_portal, draft.app.docs_url, draft.app.website].filter((u): u is string => !!u && /^https?:\/\//.test(u));
  if (!host && !cfg.mock) {
    const hosts = [...new Set(discovered.map((u) => hostFromQuery(u)).filter((h): h is string => !!h))].slice(0, 2);
    const results = await withTimeout(Promise.all(hosts.map((h) => probeDiscovery(h))), 9000, [] as DiscoveryResult[][]);
    recordDiscovery(results.flat());
  }
  const live = await withTimeout(Promise.all(discovered.slice(0, 2).map((u) => probeUrlLive(u))), 8000, []);
  for (const p of live) {
    const id = `t${probeEv.length + 1}`;
    probeEv.push(probeEvidence(id, p, `Link check: ${p.target}`));
    emit({ type: "finding", text: `${p.target} ${p.summary}`, label: "tested" });
  }
  emit({ type: "step", stage: "verify", status: "done", detail: `${plural(probeEv.length, "tested fact")}${dcrFound ? "; dynamic client registration available" : ""}` });

  // 7. Critic + coverage
  emit({ type: "step", stage: "critic", status: "running" });
  let guide = assembleGuide(draft, { ...ctxBase, probeEvidence: probeEv, dcrFound });
  const critic = runCritic(guide, research.sources);
  guide = critic.guide;
  const labelOf = new Map(guide.evidence.map((e) => [e.id, e.label]));
  const answered = guide.checks.filter((c) => c.answer !== "unknown");
  const confirmed = answered.filter((c) => c.evidence.some((id) => (labelOf.get(id) ?? "unverified") !== "unverified"));
  const coverage = { answered: answered.length, confirmed: confirmed.length, total: CORE_QUESTION_IDS.length };
  guide.meta = { ...guide.meta, provider: runMeta.provider, critic: critic.stats, coverage, research: researchMeta(research, usageOut(), started) };
  emit({
    type: "step",
    stage: "critic",
    status: "done",
    detail: `${critic.stats.checked - critic.stats.downgraded} of ${critic.stats.checked} quotes confirmed on their pages${critic.stats.downgraded ? `; ${critic.stats.downgraded} downgraded` : ""}${critic.stats.numbers_removed ? `; ${plural(critic.stats.numbers_removed, "unsupported timeline")} removed` : ""}. ${coverage.confirmed} of ${coverage.total} questions answered with a confirmed source.`,
  });

  const parsed = GuideSchema.safeParse(guide);
  const problems = parsed.success ? crossCheckGuide(parsed.data) : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  if (problems.length) {
    console.error("generated guide failed validation", problems.slice(0, 10));
    return savePartial(`The generated guide failed validation (${problems[0]}).`);
  }

  // 8. Save
  emit({ type: "step", stage: "save", status: "running" });
  await saveGeneratedGuide(parsed.data!);
  emit({ type: "step", stage: "save", status: "done", detail: `Saved for ${cfg.cacheDays} days` });
  emit({ type: "guide", key, url: `/apps/gen/${key}`, partial: false });
  emit({ type: "done", url: `/apps/gen/${key}` });
  await run.finish("done", { ...runMeta, guideKey: key, usage: usageOut() });
  return parsed.data!;
}

function researchMeta(r: ResearchResult, u: { input_tokens: number; output_tokens: number; cost_usd: number | null }, started: number) {
  return {
    web_search: r.stopReason !== URL_ONLY,
    model: r.model,
    searches: r.searches,
    pages_read: r.sources.filter((s) => s.fetched).length,
    duration_ms: Date.now() - started,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cost_usd: u.cost_usd ?? undefined,
  };
}
