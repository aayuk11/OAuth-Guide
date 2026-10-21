import Anthropic from "@anthropic-ai/sdk";
import type { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { beforeAll, describe, expect, it } from "vitest";
import { mockDraft } from "@/lib/agent/mock";
import type { RunEventInput } from "@/lib/agent/events";
import { anthropicProvider } from "@/lib/llm/anthropic";
import { describeQuota, googleProvider } from "@/lib/llm/google";
import { openaiProvider } from "@/lib/llm/openai";
import { describeProviderError, envCredentials, estimateCost } from "@/lib/llm";
import { checkKeyShape, resolveCredentials, seal, unseal, KEY_COOKIE } from "@/lib/llm/credentials";
import { URLS_SYSTEM } from "@/lib/llm/prompts";
import { emptyUsage, redactKeys, SearchUnavailableError, type ExtractRequest, type LlmProvider, type ResearchRequest } from "@/lib/llm/types";

/**
 * Each provider runs against a simulated API: documented response shapes, no key, no network.
 * Anthropic and OpenAI go through the real SDK stream parsers via a fake fetch; Gemini through a fake client.
 */

beforeAll(() => {
  process.env.VERCEL = "1"; // in-memory store
  process.env.APP_SECRET = "test-secret-at-least-16-chars";
});

const PAGE = "Create an app in the developer console. Apps must be reviewed before they can be installed by other organisations. Review usually takes 5 to 10 business days.";
const research = (emit: (e: RunEventInput) => void): ResearchRequest => ({ system: "sys", prompt: "Research Acme", maxSearches: 6, maxFetches: 6, timeoutMs: 30_000, effort: "medium", emit });
const extract = (emit: (e: RunEventInput) => void = () => {}): ExtractRequest => ({ system: "sys", input: "x", schema: { type: "object" }, timeoutMs: 30_000, effort: "low", emit });

/* ---------- Anthropic ---------- */

type Ev = Record<string, unknown>;
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

function fakeFetch(responses: string[], seen: unknown[]) {
  let i = 0;
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(responses[Math.min(i++, responses.length - 1)], { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof globalThis.fetch;
}

const anthropicClient = (responses: string[], seen: unknown[] = []) => new Anthropic({ apiKey: "test-key", fetch: fakeFetch(responses, seen), maxRetries: 0 });

const start = (id: string) => ({ type: "message_start", message: { id, type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } });
const stop = (reason: string, out: number, searches = 0, fetches = 0) => [
  { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: out, server_tool_use: { web_search_requests: searches, web_fetch_requests: fetches } } },
  { type: "message_stop" },
];

const turn1 = sse([
  start("msg_1"),
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"acme oauth app review"}' } },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://docs.acme.com/oauth", title: "Acme OAuth", encrypted_content: "enc", page_age: "2026-09-01" }] },
  },
  { type: "content_block_stop", index: 1 },
  ...stop("pause_turn", 40, 1, 0),
]);

const turn2 = sse([
  start("msg_2"),
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_2", name: "web_fetch", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"url":"https://docs.acme.com/oauth"}' } },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_fetch_tool_result",
      tool_use_id: "srvtoolu_2",
      content: { type: "web_fetch_result", url: "https://docs.acme.com/oauth", retrieved_at: "2026-10-20T10:00:00Z", content: { type: "document", source: { type: "text", media_type: "text/plain", data: PAGE }, title: "Acme OAuth", citations: null } },
    },
  },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "server_tool_use", id: "srvtoolu_3", name: "web_fetch", input: {} } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"url":"https://blocked.acme.com/x"}' } },
  { type: "content_block_stop", index: 2 },
  { type: "content_block_start", index: 3, content_block: { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_3", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } } },
  { type: "content_block_stop", index: 3 },
  { type: "content_block_start", index: 4, content_block: { type: "text", text: "", citations: null } },
  { type: "content_block_delta", index: 4, delta: { type: "text_delta", text: 'APP: Acme | Acme Inc\nANSWERS: app_review: yes — "Apps must be reviewed before they can be installed by other organisations." (https://docs.acme.com/oauth)' } },
  { type: "content_block_stop", index: 4 },
  ...stop("end_turn", 300, 0, 2),
]);

describe("Anthropic provider (simulated API)", () => {
  it("captures searches, fetched text and failures, and resumes pause_turn", async () => {
    const seen: unknown[] = [];
    const events: RunEventInput[] = [];
    const p = anthropicProvider({ apiKey: "k", model: "claude-sonnet-5-5", client: anthropicClient([turn1, turn2], seen) });
    const r = await p.research(research((e) => events.push(e)));
    expect(r.stopReason).toBe("end_turn");
    expect(r.searches).toEqual(["acme oauth app review"]);
    const src = r.sources.find((s) => s.url === "https://docs.acme.com/oauth")!;
    expect(src.fetched).toBe(true);
    expect(src.text).toContain("Apps must be reviewed");
    expect(src.pageAge).toBe("2026-09-01");
    expect(r.notes).toContain("APP: Acme");
    expect(r.usage).toMatchObject({ searches: 1, fetches: 2, input_tokens: 2000 });
    expect(events.some((e) => e.type === "read" && !e.ok && e.url === "https://blocked.acme.com/x" && e.error === "url_not_accessible")).toBe(true);
    // The second request resumed the paused turn: same user message plus the paused assistant content.
    const second = seen[1] as { messages: { role: string }[]; tools: { type: string }[]; fallbacks?: string; output_config?: { effort: string } };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(second.tools.map((t) => t.type)).toEqual(["web_search_20250305", "web_fetch_20250910"]);
    expect(second.fallbacks).toBe("default");
    expect(second.output_config?.effort).toBe("medium");
  });

  it("reports a refusal without throwing", async () => {
    const p = anthropicProvider({ apiKey: "k", model: "m", client: anthropicClient([sse([start("msg_r"), ...stop("refusal", 1)])]) });
    expect((await p.research(research(() => {}))).refused).toBe(true);
  });

  it("writes the guide with a JSON schema and no tools", async () => {
    const json = JSON.stringify(await mockDraft("Acme"));
    const body = sse([
      start("msg_e"),
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(0, 500) } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(500) } },
      { type: "content_block_stop", index: 0 },
      ...stop("end_turn", 2000),
    ]);
    const seen: unknown[] = [];
    const r = await anthropicProvider({ apiKey: "k", model: "m", client: anthropicClient([body], seen) }).extract(extract());
    expect(r.text).toBe(json);
    const req = seen[0] as { output_config: { format: { type: string } }; tools?: unknown };
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.tools).toBeUndefined();
  });
});

/* ---------- Gemini ---------- */

function fakeGemini(stream: Ev[], final: Ev, seen: unknown[]) {
  return {
    interactions: {
      create: async (params: Ev) => {
        seen.push(params);
        if (params.stream) return (async function* () { for (const e of stream) yield e; })();
        return final;
      },
    },
  } as unknown as GoogleGenAI;
}

describe("Gemini provider (simulated Interactions API)", () => {
  const stream: Ev[] = [
    { event_type: "interaction.created", interaction: { id: "i1", status: "in_progress" } },
    { event_type: "step.start", index: 0, step: { type: "google_search_call", arguments: { queries: ["acme oauth app review", "acme developer console"] } } },
    { event_type: "step.stop", index: 0 },
    { event_type: "step.start", index: 1, step: { type: "url_context_call", arguments: { urls: ["https://docs.acme.com/oauth"] } } },
    { event_type: "step.start", index: 2, step: { type: "url_context_result", result: [{ url: "https://docs.acme.com/oauth", status: "success" }, { url: "https://acme.com/private", status: "error" }] } },
    { event_type: "step.start", index: 3, step: { type: "model_output", content: [] } },
    { event_type: "step.delta", index: 3, delta: { type: "text", text: "APP: Acme | Acme Inc\n" } },
    { event_type: "step.delta", index: 3, delta: { type: "text_annotation_delta", annotations: [{ type: "url_citation", url: "https://docs.acme.com/review", title: "Review" }] } },
    { event_type: "step.delta", index: 3, delta: { type: "text", text: "ANSWERS: app_review: yes" } },
    { event_type: "interaction.completed", interaction: { id: "i1", status: "completed", usage: { total_input_tokens: 5000, total_output_tokens: 700, total_thought_tokens: 300, grounding_tool_count: [{ type: "google_search", count: 2 }] } } },
  ];

  it("reads searches, page reads, citations and usage from the stream", async () => {
    const seen: unknown[] = [];
    const events: RunEventInput[] = [];
    const r = await googleProvider({ apiKey: "k", model: "gemini-3.8-flash", client: fakeGemini(stream, {}, seen) }).research(research((e) => events.push(e)));
    expect(r.searches).toEqual(["acme oauth app review", "acme developer console"]);
    expect(r.notes).toBe("APP: Acme | Acme Inc\nANSWERS: app_review: yes");
    expect(r.sources.map((s) => s.url).sort()).toEqual(["https://acme.com/private", "https://docs.acme.com/oauth", "https://docs.acme.com/review"]);
    expect(r.usage).toMatchObject({ input_tokens: 5000, output_tokens: 1000, searches: 2, fetches: 2 });
    expect(events.some((e) => e.type === "read" && !e.ok && e.url === "https://acme.com/private")).toBe(true);
    const req = seen[0] as { tools: { type: string }[]; store: boolean; generation_config: { thinking_level: string } };
    expect(req.tools.map((t) => t.type)).toEqual(["google_search", "url_context"]);
    expect(req.store).toBe(false);
    expect(req.generation_config.thinking_level).toBe("medium");
  });

  it("streams the guide as JSON with a schema and no tools", async () => {
    const seen: unknown[] = [];
    const events: Ev[] = [
      { event_type: "interaction.created", interaction: { id: "i2", status: "in_progress" } },
      { event_type: "step.start", index: 0, step: { type: "model_output", content: [] } },
      { event_type: "step.delta", index: 0, delta: { type: "text", text: '{"ok":' } },
      { event_type: "step.delta", index: 0, delta: { type: "text", text: "true}" } },
      { event_type: "interaction.completed", interaction: { id: "i2", status: "completed", usage: { total_input_tokens: 10, total_output_tokens: 5 } } },
    ];
    const r = await googleProvider({ apiKey: "k", model: "m", client: fakeGemini(events, {}, seen) }).extract(extract());
    expect(r.text).toBe('{"ok":true}');
    expect(r.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
    const req = seen[0] as { response_format: { mime_type: string; schema: unknown }; tools?: unknown; stream: boolean };
    expect(req.response_format.mime_type).toBe("application/json");
    expect(req.stream).toBe(true);
    expect(req.tools).toBeUndefined();
  });

  it("says so when Gemini never starts answering", async () => {
    const client = {
      interactions: {
        create: (_p: Ev, o: { fetch_options: { signal: AbortSignal } }) =>
          new Promise((_, reject) => o.fetch_options.signal.addEventListener("abort", () => reject(new Error("aborted")))),
      },
    } as unknown as GoogleGenAI;
    const r = await googleProvider({ apiKey: "k", model: "m", client }).extract({ ...extract(), timeoutMs: 50 });
    expect(r.text).toBeNull();
    expect(r.error).toMatch(/did not start answering within 0 s/);
  });

  it("explains HTTP errors in plain words", () => {
    expect(describeProviderError(Object.assign(new Error("bad key"), { status: 403 })).message).toMatch(/Gemini API key was rejected/);
    expect(describeProviderError(Object.assign(new Error("slow down"), { status: 429 })).retryable).toBe(true);
    // What Google actually returns for a bad key (seen against the live API).
    const bad = Object.assign(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'), { status: 400 });
    expect(describeProviderError(bad).message).toBe("The Gemini API key was rejected.");
  });

  // Shaped like Google's RESOURCE_EXHAUSTED body (message text abridged).
  const quota429 = (detail: string) =>
    Object.assign(new Error(`{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.\\n* ${detail}\\nPlease retry in 41.6s.","status":"RESOURCE_EXHAUSTED"}}`), { status: 429 });

  it("retries research on gemini-2.5-flash when Search is refused for the chosen model", async () => {
    const models: string[] = [];
    const events: RunEventInput[] = [];
    const client = {
      interactions: {
        create: async (p: Ev) => {
          models.push(String(p.model));
          if (p.model !== "gemini-2.5-flash") throw quota429("Quota exceeded for metric: generativelanguage.googleapis.com/search_grounding_requests, limit: 0, model: gemini-3.8-flash");
          return (async function* () {
            yield { event_type: "step.start", index: 0, step: { type: "google_search_call", arguments: { queries: ["acme oauth"] } } };
            yield { event_type: "step.delta", index: 1, delta: { type: "text", text: "APP: Acme" } };
            yield { event_type: "interaction.completed", interaction: { status: "completed" } };
          })();
        },
      },
    } as unknown as GoogleGenAI;
    const r = await googleProvider({ apiKey: "k", model: "gemini-3.8-flash", client }).research(research((e) => events.push(e)));
    expect(models).toEqual(["gemini-3.8-flash", "gemini-2.5-flash"]);
    expect(r.model).toBe("gemini-2.5-flash");
    expect(r.searches).toEqual(["acme oauth"]);
    expect(events.some((e) => e.type === "step" && /researching with gemini-2\.5-flash/.test(e.detail ?? ""))).toBe(true);
  });

  it("reports 'no web search for this key' when both models refuse", async () => {
    const client = { interactions: { create: async () => { throw quota429("Quota exceeded for metric: generativelanguage.googleapis.com/search_grounding_requests, limit: 0, model: gemini-3.8-flash"); } } } as unknown as GoogleGenAI;
    const err = await googleProvider({ apiKey: "k", model: "gemini-3.8-flash", client }).research(research(() => {})).catch((e) => e);
    expect(err).toBeInstanceOf(SearchUnavailableError);
    expect((err as SearchUnavailableError).reason).toMatch(/limit: 0/);
  });

  it("does not retry quota errors inside the SDK", async () => {
    const seenOpts: unknown[] = [];
    const client = { interactions: { create: async (_p: Ev, o: unknown) => { seenOpts.push(o); throw quota429("x"); } } } as unknown as GoogleGenAI;
    await googleProvider({ apiKey: "k", model: "m", client }).research(research(() => {})).catch(() => {});
    const o = seenOpts[0] as { retry_codes: string[]; retries: { maxRetries: number } };
    expect(o.retry_codes).not.toContain("429");
    expect(o.retries.maxRetries).toBeLessThanOrEqual(2); // 5xx: two quick retries, not minutes of silent backoff
  });

  it("names the quota that ran out", () => {
    expect(describeQuota("Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-4-argon").message).toMatch(/plan has no quota for gemini-4-argon.*enable billing/);
    expect(describeQuota("Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 20, model: gemini-3.8-flash").message).toMatch(/used today's quota for gemini-3\.8-flash/);
    const rpm = describeQuota("Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model, limit: 10, model: gemini-3.8-flash Please retry in 41.6s.");
    expect(rpm.message).toMatch(/try again in 42 s/);
    expect(rpm.retryable).toBe(true);
  });

  it("keeps keys out of server logs", () => {
    expect(redactKeys("bad key AIzaFAKE_not_a_real_key_0000 at https://x?key=AIzaSecret&alt=sse")).toBe("bad key [key] at https://x?key=[key]&alt=sse");
    expect(redactKeys("sk-fake-test-key-0000 rejected")).toBe("[key] rejected");
  });
});

/* ---------- OpenAI ---------- */

describe("OpenAI provider (simulated Responses API)", () => {
  const ev = (e: Ev) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
  const search = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "acme oauth review", sources: [{ type: "url", url: "https://docs.acme.com/oauth" }] } };
  const open = { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "open_page", url: "https://docs.acme.com/review" } };
  const message = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "APP: Acme", annotations: [{ type: "url_citation", url: "https://docs.acme.com/limits", title: "Limits", start_index: 0, end_index: 3 }] }] };
  const body = [
    ev({ type: "response.created", sequence_number: 0, response: { id: "r1", status: "in_progress", output: [] } }),
    ev({ type: "response.output_item.done", sequence_number: 1, output_index: 0, item: search }),
    ev({ type: "response.output_item.done", sequence_number: 2, output_index: 1, item: open }),
    ev({ type: "response.output_text.delta", sequence_number: 3, output_index: 2, content_index: 0, item_id: "m1", delta: "APP: Acme" }),
    ev({ type: "response.output_item.done", sequence_number: 4, output_index: 2, item: message }),
    ev({ type: "response.completed", sequence_number: 5, response: { id: "r1", status: "completed", output: [search, open, message], usage: { input_tokens: 4000, output_tokens: 600, input_tokens_details: { cached_tokens: 0 } } } }),
  ].join("");

  it("reads searches, opened pages, citations and usage from the stream", async () => {
    const seen: unknown[] = [];
    const client = new OpenAI({ apiKey: "k", fetch: fakeFetch([body], seen), maxRetries: 0 });
    const r = await openaiProvider({ apiKey: "k", model: "gpt-6.1-sol", client }).research(research(() => {}));
    expect(r.searches).toEqual(["acme oauth review"]);
    expect(r.notes).toBe("APP: Acme");
    expect(r.sources.map((s) => s.url).sort()).toEqual(["https://docs.acme.com/limits", "https://docs.acme.com/oauth", "https://docs.acme.com/review"]);
    expect(r.usage).toMatchObject({ input_tokens: 4000, output_tokens: 600, searches: 1, fetches: 1 });
    const req = seen[0] as { tools: { type: string }[]; store: boolean; include: string[] };
    expect(req.tools.map((t) => t.type)).toEqual(["web_search"]);
    expect(req.store).toBe(false);
    expect(req.include).toContain("web_search_call.action.sources");
  });
});

/* ---------- Pipeline: code enforces the steps whatever the model returns ---------- */

function fakeProvider(extractText: string): LlmProvider {
  return {
    id: "google",
    model: "gemini-3.8-flash",
    research: async () => ({
      notes: `APP: Acme. "Apps must be reviewed before they can be installed by other organisations." (https://example.com/docs/oauth)`,
      sources: [{ id: "S1", url: "https://example.com/docs/oauth", title: "Acme OAuth", fetched: true, text: PAGE, cited: [], pageAge: null }],
      searches: ["acme oauth"],
      usage: { ...emptyUsage(), input_tokens: 1000, output_tokens: 100, searches: 1 },
      stopReason: "completed",
      timedOut: false,
      refused: false,
    }),
    extract: async () => ({ text: extractText, usage: emptyUsage(), timedOut: false }),
  };
}

describe("pipeline with any provider", () => {
  beforeAll(async () => {
    process.env.VERIFY_FETCHES = "0";
    await import("@/lib/agent/pipeline"); // cold load outside the per-test time limit
  }, 120_000);

  it("saves a partial guide, never a finished one, when the output breaks the schema", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const run = await createRun("Acme", "acme-bad");
    const guide = await runPipeline(run, { query: "Acme", creds: null, provider: fakeProvider('{"app_found": true}') });
    await run.flush();
    expect(guide?.meta?.partial).toBe(true);
    expect(guide?.meta?.partial_reason).toMatch(/did not match the schema/);
    expect(run.record.status).toBe("partial");
    expect(run.record.provider).toBe("google");
  });

  it("saves a partial guide when the output is not JSON", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const run = await createRun("Acme", "acme-text");
    const guide = await runPipeline(run, { query: "Acme", creds: null, provider: fakeProvider("Sure! Here is the guide:") });
    expect(guide?.meta?.partial_reason).toMatch(/not valid JSON/);
  });

  it("falls back to reading named pages when the key has no web search, and says so", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const calls: string[] = [];
    const provider: LlmProvider = {
      id: "google",
      model: "gemini-3.8-flash",
      research: async () => {
        throw new SearchUnavailableError("Quota exceeded for metric: search_grounding_requests, limit: 0");
      },
      extract: async (req) => {
        calls.push(req.system === URLS_SYSTEM ? "urls" : "guide");
        // Unresolvable hosts, so the test needs no network and every read fails fast.
        return { text: JSON.stringify({ urls: [{ url: "https://developer.acme.invalid/oauth", covers: "OAuth" }, { url: "not a url", covers: "junk" }] }), usage: emptyUsage(), timedOut: false };
      },
    };
    const run = await createRun("Acme", "acme-nosearch");
    const guide = await runPipeline(run, { query: "Acme", creds: null, provider });
    await run.flush();
    expect(calls).toEqual(["urls"]); // nothing was read, so no guide was written from nothing
    expect(guide?.meta?.partial).toBe(true);
    expect(guide?.meta?.partial_reason).toMatch(/Web search is not available/);
    const steps = run.record.events.filter((e) => e.type === "step" && e.stage === "research").map((e) => (e as { detail?: string }).detail ?? "");
    expect(steps.some((d) => /reads the provider's official pages by URL/.test(d))).toBe(true);
    expect(steps.some((d) => /^No web search, 0 pages read/.test(d))).toBe(true);
    expect(run.record.events.some((e) => e.type === "read" && e.url === "https://developer.acme.invalid/oauth" && !e.ok)).toBe(true);
  }, 30_000);

  it("explains when the model names no pages to read", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const provider: LlmProvider = {
      id: "google",
      model: "gemini-3.8-flash",
      research: async () => {
        throw new SearchUnavailableError("429");
      },
      extract: async () => ({ text: null, usage: emptyUsage(), error: "Gemini did not start answering within 45 s.", timedOut: true }),
    };
    const run = await createRun("Acme", "acme-silent");
    expect(await runPipeline(run, { query: "Acme", creds: null, provider })).toBeNull();
    const err = run.record.events.find((e) => e.type === "error") as { message: string } | undefined;
    expect(err?.message).toMatch(/did not name any pages to read\. Gemini did not start answering within 45 s/);
  });

  it("reports the real reason when the model itself is out of quota", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const provider: LlmProvider = {
      id: "google",
      model: "gemini-3.8-flash",
      research: async () => {
        throw new SearchUnavailableError("429");
      },
      extract: async () => {
        throw Object.assign(new Error("Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 20, model: gemini-3.8-flash"), { status: 429 });
      },
    };
    const run = await createRun("Acme", "acme-noquota");
    expect(await runPipeline(run, { query: "Acme", creds: null, provider })).toBeNull();
    const err = run.record.events.find((e) => e.type === "error") as { message: string } | undefined;
    expect(err?.message).toMatch(/used today's quota for gemini-3\.8-flash/);
    expect(run.record.status).toBe("error");
  });

  it("records coverage, provider and an unknown cost for a valid guide", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const run = await createRun("Acme", "acme-good");
    const guide = await runPipeline(run, { query: "Acme", creds: null, provider: fakeProvider(JSON.stringify(await mockDraft("Acme"))) });
    await run.flush();
    expect(guide?.meta?.partial).toBeFalsy();
    expect(guide?.meta?.provider).toBe("google");
    expect(guide?.meta?.coverage?.total).toBe(11);
    expect(guide!.meta!.coverage!.confirmed).toBeLessThanOrEqual(guide!.meta!.coverage!.answered);
    expect(guide?.meta?.research?.cost_usd).toBeUndefined(); // Gemini prices are not estimated here
    expect(run.record.usage?.cost_usd).toBeNull();
  }, 30_000);
});

/* ---------- Keys ---------- */

describe("API keys", () => {
  const creds = { provider: "google" as const, apiKey: "fake-gemini-key-for-tests-0000000000", model: "gemini-3.8-flash" };

  it("encrypts the key so the cookie value reveals nothing", () => {
    const token = seal(creds);
    expect(token.startsWith("v1.")).toBe(true);
    expect(token).not.toContain(creds.apiKey);
    expect(Buffer.from(token.slice(3), "base64url").toString("latin1")).not.toContain("fake-gemini");
    expect(unseal(token)).toEqual(creds);
  });

  it("rejects tampered or foreign tokens", () => {
    const token = seal(creds);
    const flipped = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A") + token.slice(-1);
    expect(unseal(flipped)).toBeNull();
    expect(unseal("v1.not-a-token")).toBeNull();
    expect(unseal(JSON.stringify(creds))).toBeNull();
  });

  it("prefers the browser key over the server key", () => {
    process.env.OPENAI_API_KEY = "sk-server-key-000000000000000000";
    const jar = (v?: string) => ({ get: (n: string) => (n === KEY_COOKIE && v ? { value: v } : undefined) });
    expect(resolveCredentials(jar(seal(creds)))?.source).toBe("browser");
    expect(resolveCredentials(jar())?.creds.provider).toBe("openai");
    expect(resolveCredentials(jar("v1.garbage"))?.source).toBe("server");
    delete process.env.OPENAI_API_KEY;
    expect(resolveCredentials(jar())).toBeNull();
  });

  it("picks the server provider from LLM_PROVIDER, else the first key set", () => {
    process.env.GEMINI_API_KEY = "gem-key-0000000000000000000000";
    process.env.ANTHROPIC_API_KEY = "sk-ant-0000000000000000000000";
    expect(envCredentials()?.provider).toBe("anthropic");
    process.env.LLM_PROVIDER = "google";
    expect(envCredentials()).toMatchObject({ provider: "google", model: "gemini-3.8-flash" });
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  it("checks key shape before calling the provider", () => {
    expect(checkKeyShape("google", "short", "gemini-3.8-flash")).toMatch(/API key/);
    expect(checkKeyShape("mistral", creds.apiKey, "x")).toMatch(/provider/);
    expect(checkKeyShape("google", creds.apiKey, "bad model name!")).toMatch(/Model/);
    expect(checkKeyShape("google", creds.apiKey, "gemini-3.8-flash")).toBeNull();
  });

  it("estimates cost only where prices are known", () => {
    const u = { ...emptyUsage(), input_tokens: 1_000_000, output_tokens: 100_000 };
    expect(estimateCost("anthropic", "claude-sonnet-5-5", u)).toBe(3);
    expect(estimateCost("google", "gemini-3.8-flash", u)).toBeNull();
    expect(estimateCost("openai", "some-new-model", u)).toBeNull();
  });
});
