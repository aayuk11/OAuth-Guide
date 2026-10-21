import type { GoogleGenAI } from "@google/genai";
import { beforeAll, describe, expect, it } from "vitest";
import { slugify } from "@/lib/agent/assemble";
import { runCritic } from "@/lib/agent/critic";
import { mockDraft } from "@/lib/agent/mock";
import { describeProviderError } from "@/lib/llm";
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
