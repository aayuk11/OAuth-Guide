/**
 * What can this API key do? One tiny call per capability the agent needs, with the provider's own
 * error text when something is refused. The key is read from .env.local (or the environment) and
 * is never printed.
 *
 *   npm run check:key                          provider and model from LLM_PROVIDER / LLM_MODEL, else the first key set
 *   npm run check:key -- google gemini-3.8-flash
 */
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { envCredentials, isProviderId, PROVIDERS } from "../src/lib/llm";
import { FREE_SEARCH_MODEL } from "../src/lib/llm/google";
import { errorText, redactKeys } from "../src/lib/llm/types";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    /* file is optional */
  }
}

type Result = { ok: boolean; ms: number; note: string };

async function check(label: string, fn: () => Promise<string>): Promise<Result> {
  const t = Date.now();
  try {
    const note = await fn();
    const r = { ok: true, ms: Date.now() - t, note };
    console.log(`  ✓ ${label} (${(r.ms / 1000).toFixed(1)} s)${note ? `: ${note}` : ""}`);
    return r;
  } catch (e) {
    const status = (e as { status?: number }).status;
    const note = redactKeys(errorText(e)).replace(/\s+/g, " ").slice(0, 400);
    console.log(`  ✗ ${label} (${((Date.now() - t) / 1000).toFixed(1)} s): ${status ? `HTTP ${status} ` : ""}${note}`);
    return { ok: false, ms: Date.now() - t, note };
  }
}

const SEARCH_Q = "Search the web: what is the URL of Google's OAuth 2.0 documentation for web server apps? Reply with the URL only.";

async function google(apiKey: string, model: string) {
  const ai = new GoogleGenAI({ apiKey });
  const opts = { retries: { strategy: "none" as const }, fetch_options: { signal: AbortSignal.timeout(60_000) } };
  const text = (it: unknown) => String((it as { output_text?: string }).output_text ?? "").trim().slice(0, 80);
  const key = await check("key accepted (list models)", async () => {
    await ai.models.list({ config: { pageSize: 1 } });
    return "";
  });
  if (!key.ok) return;
  const plain = await check(`${model} answers`, async () => text(await ai.interactions.create({ model, input: "Reply with the word OK.", generation_config: { max_output_tokens: 256 }, store: false }, opts)));
  const json = await check(`${model} returns JSON (used to write the guide)`, async () =>
    text(await ai.interactions.create({ model, input: 'Return {"ok": true}.', response_format: { type: "text", mime_type: "application/json", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }, generation_config: { max_output_tokens: 256 }, store: false }, opts)),
  );
  const search = await check(`${model} with Google Search (used to research)`, async () => text(await ai.interactions.create({ model, input: SEARCH_Q, tools: [{ type: "google_search" }], generation_config: { max_output_tokens: 1024 }, store: false }, opts)));
  let freeSearch: Result | null = null;
  if (!search.ok && model !== FREE_SEARCH_MODEL)
    freeSearch = await check(`${FREE_SEARCH_MODEL} with Google Search (free-tier fallback)`, async () => text(await ai.interactions.create({ model: FREE_SEARCH_MODEL, input: SEARCH_Q, tools: [{ type: "google_search" }], generation_config: { max_output_tokens: 1024 }, store: false }, opts)));

  console.log("\nVerdict:");
  if (!plain.ok || !json.ok) console.log(`  Live research will fail: ${model} does not answer on this key. Try another model (e.g. gemini-3.5-flash-lite), or enable billing in Google AI Studio.`);
  else if (search.ok) console.log("  Full live research works with this key.");
  else if (freeSearch?.ok) console.log(`  Live research works: research runs on ${FREE_SEARCH_MODEL} (free-tier Search), the guide is written by ${model}.`);
  else console.log("  Limited live research: no Google Search on this key, so the agent reads official pages by URL only. Enable billing for the key's project in Google AI Studio for full research.");
}

async function anthropic(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 });
  const key = await check("key accepted (list models)", async () => {
    await client.models.list({ limit: 1 });
    return "";
  });
  if (!key.ok) return;
  const plain = await check(`${model} answers`, async () => {
    const m = await client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word OK." }] });
    return m.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  });
  const search = await check(`${model} with web search (used to research)`, async () => {
    const m = await client.messages.create({ model, max_tokens: 512, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }], messages: [{ role: "user", content: SEARCH_Q }] });
    return `${m.usage.server_tool_use?.web_search_requests ?? 0} search`;
  });
  console.log("\nVerdict:");
  console.log(!plain.ok ? `  Live research will fail: ${model} does not answer on this key.` : search.ok ? "  Full live research works with this key." : "  Web search is refused: an organisation admin may need to enable it in the Claude Console (Settings → Privacy).");
}

async function openai(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 60_000 });
  const key = await check("key accepted (list models)", async () => {
    await client.models.list();
    return "";
  });
  if (!key.ok) return;
  const plain = await check(`${model} answers`, async () => (await client.responses.create({ model, input: "Reply with the word OK.", max_output_tokens: 64, store: false })).output_text.trim());
  const search = await check(`${model} with web search (used to research)`, async () => (await client.responses.create({ model, input: SEARCH_Q, tools: [{ type: "web_search" }], max_output_tokens: 1024, store: false })).output_text.trim().slice(0, 80));
  console.log("\nVerdict:");
  console.log(!plain.ok ? `  Live research will fail: ${model} does not answer on this key.` : search.ok ? "  Full live research works with this key." : "  Web search is refused for this key or model; try another model.");
}

async function main() {
  const [p, m] = process.argv.slice(2);
  const env = envCredentials();
  const provider = isProviderId(p) ? p : env?.provider;
  if (!provider) {
    console.error("No key found. Put GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local.");
    process.exit(2);
  }
  const apiKey = PROVIDERS[provider].envKeys.map((k) => process.env[k]).find((v) => v && v.trim())?.trim();
  if (!apiKey) {
    console.error(`No ${PROVIDERS[provider].vendor} key found. Set ${PROVIDERS[provider].envKeys[0]} in .env.local.`);
    process.exit(2);
  }
  const model = m || (env?.provider === provider ? env.model : PROVIDERS[provider].defaultModel);
  console.log(`${PROVIDERS[provider].vendor} key …${apiKey.slice(-4)}, model ${model}\n`);
  if (provider === "google") await google(apiKey, model);
  else if (provider === "anthropic") await anthropic(apiKey, model);
  else await openai(apiKey, model);
}

main().catch((e) => {
  console.error(redactKeys(errorText(e)));
  process.exit(1);
});
