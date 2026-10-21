import type { GoogleGenAI } from "@google/genai";
import { beforeAll, describe, expect, it } from "vitest";
import { slugify } from "@/lib/agent/assemble";
import { runCritic } from "@/lib/agent/critic";
import { mockDraft } from "@/lib/agent/mock";
import { describeProviderError, keyFormatHint } from "@/lib/llm";
import { googleProvider } from "@/lib/llm/google";
import { emptyUsage, type ExtractRequest, type LlmProvider } from "@/lib/llm/types";
import { store } from "@/lib/store";
import { ev, guide, path } from "./fixtures";

/** Fixes from the pre-release audit: each test pins one failure that could happen in production. */

beforeAll(async () => {
  process.env.VERCEL = "1"; // in-memory store
  process.env.VERIFY_FETCHES = "0";
  await import("@/lib/agent/pipeline"); // cold load outside the per-test time limit
}, 120_000);

describe("runs", () => {
  it("starts one paid run per app even when two requests arrive together", async () => {
    const { startRun } = await import("@/lib/agent/runs");
    const [a, b] = await Promise.all([startRun("Acme", "acme-twice"), startRun("Acme", "acme-twice")]);
    const started = [a, b].filter((r) => "run" in r);
    const attached = [a, b].filter((r) => "attach" in r) as { attach: string }[];
    expect(started).toHaveLength(1);
    expect(attached).toHaveLength(1);
    expect(attached[0].attach).toBe((started[0] as { run: { record: { id: string } } }).run.record.id);
  });

  it("reports a run cut off by the host's time limit instead of 'running' forever", async () => {
    const { getRun } = await import("@/lib/agent/runs");
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await store().set("run:stale-run-1", { id: "stale-run-1", key: "acme", query: "Acme", status: "running", events: [], startedAt }, 3600);
    const rec = await getRun("stale-run-1");
    expect(rec?.status).toBe("error");
    expect(rec?.events.at(-1)).toMatchObject({ type: "error", retryable: true });
  });
});

describe("re-check", () => {
  const provider = (text: string): LlmProvider => ({
    id: "google",
    model: "gemini-3.8-flash",
    research: async () => ({
      notes: "APP: Acme",
      sources: [{ id: "S1", url: "https://example.com/docs/oauth", title: "Acme OAuth", fetched: true, text: "Apps must be reviewed before they can be installed by other organisations.", cited: [], pageAge: null }],
      searches: ["acme oauth"],
      usage: emptyUsage(),
      stopReason: "completed",
      timedOut: false,
      refused: false,
    }),
    extract: async () => ({ text, usage: emptyUsage(), timedOut: false }),
  });

  it("keeps a complete guide when a later re-check fails", async () => {
    const { createRun, getGeneratedGuide } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const first = await createRun("Acme", "acme-recheck");
    const good = await runPipeline(first, { query: "Acme", creds: null, provider: provider(JSON.stringify(await mockDraft("Acme"))) });
    expect(good?.meta?.partial).toBeFalsy();

    const second = await createRun("Acme", "acme-recheck");
    expect(await runPipeline(second, { query: "Acme", creds: null, provider: provider("not json") })).toBeNull();
    expect(second.record.status).toBe("error");
    const err = second.record.events.find((e) => e.type === "error") as { message: string };
    expect(err.message).toMatch(/re-check did not finish.*was kept/);
    const stored = await getGeneratedGuide("acme-recheck");
    expect(stored?.meta?.partial).toBeFalsy();
    expect(stored?.meta?.run_id).toBe(first.record.id);
  }, 60_000);
});

describe("critic", () => {
  it("matches a quote whether or not the cited URL has a trailing slash", () => {
    const g = guide([path("p", [])], [ev("e1", "official", { url: "https://acme.com/", excerpt: "Apps must be reviewed" })]);
    const { guide: out, stats } = runCritic(g, [{ id: "S1", url: "https://acme.com", title: "Acme", fetched: true, text: "Apps must be reviewed before install.", cited: [], pageAge: null }]);
    expect(stats.downgraded).toBe(0);
    expect(out.evidence[0].label).toBe("official");
  });
});

describe("keys for apps", () => {
  it("gives names without Latin letters distinct keys", () => {
    expect(slugify("飞书")).toMatch(/^app-[0-9a-f]{10}$/);
    expect(slugify("飞书")).not.toBe(slugify("钉钉"));
    expect(slugify("Acme CRM")).toBe("acme-crm");
  });
});

describe("Gemini writing on a free-tier key", () => {
  const extractReq = (): ExtractRequest => ({ system: "s", input: "i", schema: { type: "object" }, timeoutMs: 30_000, effort: "low", emit: () => {} });

  it("writes with gemini-2.5-flash when the chosen model has no quota, without Gemini 3 settings", async () => {
    const calls: { model: string; cfg: Record<string, unknown> }[] = [];
    const client = {
      interactions: {
        create: async (p: { model: string; generation_config: Record<string, unknown> }) => {
          calls.push({ model: p.model, cfg: p.generation_config });
          if (p.model !== "gemini-2.5-flash") throw Object.assign(new Error("Quota exceeded for metric: x, limit: 0, model: gemini-3.8-flash"), { status: 429 });
          return (async function* () {
            yield { event_type: "step.delta", delta: { type: "text", text: '{"ok":true}' } };
            yield { event_type: "interaction.completed", interaction: { status: "completed" } };
          })();
        },
      },
    } as unknown as GoogleGenAI;
    const r = await googleProvider({ apiKey: "k", model: "gemini-3.8-flash", client }).extract(extractReq());
    expect(r.text).toBe('{"ok":true}');
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-2.5-flash"]);
    expect(calls[0].cfg.thinking_level).toBe("low");
    expect(calls[1].cfg.thinking_level).toBeUndefined();
  });

  it("falls back on search even when Google reports the refusal inside the stream", async () => {
    const models: string[] = [];
    const client = {
      interactions: {
        create: async (p: { model: string }) => {
          models.push(p.model);
          if (p.model === "gemini-2.5-flash")
            return (async function* () {
              yield { event_type: "step.delta", delta: { type: "text", text: "APP: Acme" } };
              yield { event_type: "interaction.completed", interaction: { status: "completed" } };
            })();
          return (async function* () {
            yield { event_type: "interaction.created", interaction: { id: "i" } };
            yield { event_type: "error", error: { code: 429, message: "Quota exceeded for metric: search_grounding, limit: 0" } };
          })();
        },
      },
    } as unknown as GoogleGenAI;
    const r = await googleProvider({ apiKey: "k", model: "gemini-3.8-flash", client }).research({ system: "s", prompt: "p", maxSearches: 6, maxFetches: 6, timeoutMs: 30_000, effort: "medium", emit: () => {} });
    expect(models).toEqual(["gemini-3.8-flash", "gemini-2.5-flash"]);
    expect(r.notes).toBe("APP: Acme");
  });
});

describe("provider errors", () => {
  it("does not describe an OpenAI stream failure as a Gemini error", () => {
    const e = Object.assign(new Error("The server had an error"), { provider: "openai", code: "server_error" });
    expect(describeProviderError(e, "openai").message).toMatch(/^OpenAI stopped the response/);
    expect(describeProviderError(Object.assign(new Error("x"), { provider: "openai", code: "rate_limit_exceeded" }), "openai").message).toMatch(/OpenAI is rate-limiting/);
  });
});

describe("rejected keys", () => {
  it("says what a real API key looks like when the pasted credential is something else", () => {
    expect(keyFormatHint("anthropic", "sk-ant-usr-0000")).toMatch(/^This is not an Anthropic API key\. Anthropic API keys start with sk-ant-api/);
    expect(keyFormatHint("anthropic", "sk-ant-api03-0000")).toBeNull();
    expect(keyFormatHint("google", "fake")).toMatch(/^This is not a Google API key/);
    expect(keyFormatHint("openai", "sk-proj-0000")).toBeNull();
  });
});

describe("guide schema too complex for structured output", () => {
  const research = async () => ({
    notes: "APP: Acme",
    sources: [{ id: "S1", url: "https://example.com/docs/oauth", title: "Acme OAuth", fetched: true, text: "Apps must be reviewed before they can be installed by other organisations.", cited: [], pageAge: null }],
    searches: ["acme oauth"],
    usage: emptyUsage(),
    stopReason: "completed",
    timedOut: false,
    refused: false,
  });
  // What Anthropic returned on a real run (2026-10-22).
  const grammarError = () =>
    Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools."}}'), { status: 400 });

  it("writes plain JSON with the schema in the prompt, and keeps the result", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const calls: { schema: unknown; input: string }[] = [];
    const json = JSON.stringify(await mockDraft("Acme"));
    const provider: LlmProvider = {
      id: "anthropic",
      model: "claude-sonnet-5-5",
      research,
      extract: async (req) => {
        calls.push({ schema: req.schema, input: req.input });
        if (req.schema) throw grammarError();
        return { text: "```json\n" + json + "\n```", usage: emptyUsage(), timedOut: false };
      },
    };
    const run = await createRun("Acme", "acme-grammar");
    const guide = await runPipeline(run, { query: "Acme", creds: null, provider });
    expect(guide?.meta?.partial).toBeFalsy();
    expect(calls.map((c) => (c.schema ? "schema" : "plain"))).toEqual(["schema", "plain"]);
    expect(calls[1].input).toContain("JSON SCHEMA (reply with one JSON object");
  }, 60_000);

  it("fixes a draft that does not match the schema with one repair pass", async () => {
    const { createRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const good = await mockDraft("Acme");
    const bad = structuredClone(good) as unknown as { steps: { owner: string }[] };
    bad.steps[0].owner = "developer";
    const inputs: string[] = [];
    const provider: LlmProvider = {
      id: "anthropic",
      model: "claude-sonnet-5-5",
      research,
      extract: async (req) => {
        inputs.push(req.input);
        if (req.schema) throw grammarError();
        return { text: JSON.stringify(inputs.length === 2 ? bad : good), usage: emptyUsage(), timedOut: false };
      },
    };
    const run = await createRun("Acme", "acme-repair");
    const guide = await runPipeline(run, { query: "Acme", creds: null, provider });
    expect(guide?.meta?.partial).toBeFalsy();
    expect(inputs).toHaveLength(3);
    expect(inputs[2]).toMatch(/PROBLEMS:\n- steps\.0\.owner/);
  }, 60_000);

  it("sends no schema to the provider in plain JSON mode", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { anthropicProvider } = await import("@/lib/llm/anthropic");
    const seen: Record<string, unknown>[] = [];
    const body = [
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"ok":true}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    const fetch = (async (_u: unknown, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof globalThis.fetch;
    const client = new Anthropic({ apiKey: "k", fetch, maxRetries: 0 });
    const r = await anthropicProvider({ apiKey: "k", model: "m", client }).extract({ system: "s", input: "i", schema: null, timeoutMs: 30_000, effort: "low", emit: () => {} });
    expect(r.text).toBe('{"ok":true}');
    expect((seen[0].output_config as Record<string, unknown>).format).toBeUndefined();

    const calls: Record<string, unknown>[] = [];
    const gemini = {
      interactions: {
        create: async (p: Record<string, unknown>) => {
          calls.push(p);
          return (async function* () {
            yield { event_type: "step.delta", delta: { type: "text", text: '{"ok":true}' } };
            yield { event_type: "interaction.completed", interaction: { status: "completed" } };
          })();
        },
      },
    } as unknown as GoogleGenAI;
    await googleProvider({ apiKey: "k", model: "gemini-3.8-flash", client: gemini }).extract({ system: "s", input: "i", schema: null, timeoutMs: 30_000, effort: "low", emit: () => {} });
    expect(calls[0].response_format).toEqual({ type: "text", mime_type: "application/json" });
  });
});
